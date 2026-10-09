import type { Mode, UiChannel, UiEvent, UiMessage, UiState } from "./types.ts";
import type { RuleSet } from "#lib/core/types.ts";

const empty: UiState = {
  key: null,
  account: null,
  canAct: false,
  mode: "observe",
  channel: null,
  running: false,
  startedAt: null,
  deadline: null,
  stoppedReason: null,
  stream: null,
  context: "",
  stats: { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 },
  rules: [],
  ruleSet: { channel: "", context: "", reviewIfMentionsBot: true, rules: [] },
  ruleHits: {},
  recent: [],
  queue: [],
};

/** État de la page : une observation, alimentée par le flux SSE du serveur. */
export class Live {
  state = $state<UiState>(empty);
  connected = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);
  /** Chaînes où le compte connecté peut agir. */
  channels = $state<UiChannel[]>([]);
  private es: EventSource | null = null;

  /** Au chargement : on retrouve l'observation de ce navigateur s'il y en a une. */
  async boot() {
    const res = await fetch("/api/mine");
    const mine = res.ok ? ((await res.json()) as { key: string; running: boolean }[]) : [];
    const current = mine.find((m) => m.running) ?? mine[0];
    this.connect(current?.key ?? null);
  }

  connect(key: string | null) {
    this.es?.close();
    this.es = new EventSource(key ? `/api/events?key=${encodeURIComponent(key)}` : "/api/events");
    this.es.onopen = () => (this.connected = true);
    this.es.onerror = () => (this.connected = false);
    this.es.onmessage = (e) => this.apply(JSON.parse(e.data) as UiEvent);
  }

  disconnect() {
    this.es?.close();
    this.es = null;
  }

  async loadChannels() {
    if (!this.state.account) {
      this.channels = [];
      return;
    }
    const res = await fetch("/api/channels");
    this.channels = res.ok ? ((await res.json()) as UiChannel[]) : [];
  }

  private apply(ev: UiEvent) {
    switch (ev.type) {
      case "state": {
        const hadAccount = !!this.state.account;
        this.state = ev.state;
        if (!!ev.state.account !== hadAccount || (ev.state.account && this.channels.length === 0)) void this.loadChannels();
        // Sans observation, on affiche quand même le jeu de règles par défaut.
        if (!ev.state.key && ev.state.rules.length === 0) void this.loadDefaultRules();
        break;
      }
      case "message":
        upsert(this.state.recent, ev.message, 300);
        if (ev.message.decision && ev.message.decision.kind !== "pass") upsert(this.state.queue, ev.message, 500);
        break;
      case "stats":
        this.state.stats = ev.stats;
        this.state.ruleHits = ev.ruleHits;
        break;
      case "stream":
        this.state.stream = ev.stream;
        this.state.context = ev.context;
        break;
      case "mode":
        this.state.mode = ev.mode;
        break;
      case "stopped":
        this.state.running = false;
        this.state.stoppedReason = ev.reason;
        break;
      case "rules":
        this.state.ruleSet = ev.ruleSet;
        this.state.rules = ev.ruleSet.rules;
        this.state.context = ev.context;
        break;
      case "annotation": {
        for (const list of [this.state.recent, this.state.queue]) {
          const m = list.find((x) => x.id === ev.id);
          if (m) m.annotation = ev.annotation;
        }
        break;
      }
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown; message: string | null }> {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, data, message: res.ok ? null : ((data as { message?: string } | null)?.message ?? res.statusText) };
  }

  /** Démarre ou rejoint l'observation d'une chaîne dans un mode, puis s'y abonne. */
  async watch(channel: string, mode: Mode) {
    this.busy = true;
    this.error = null;
    try {
      const r = await this.post("/api/watch", { channel, mode });
      if (!r.ok) {
        this.error = r.message;
        return;
      }
      const state = r.data as UiState;
      this.state = state;
      this.connect(state.key);
    } finally {
      this.busy = false;
    }
  }

  async setMode(mode: Mode): Promise<string | null> {
    return (await this.post("/api/mode", { key: this.state.key, mode })).message;
  }

  async stop() {
    await this.post("/api/stop", { key: this.state.key });
  }

  async logout() {
    await fetch("/auth/logout", { method: "POST" });
    this.state.account = null;
    this.state.canAct = false;
    this.state.mode = "observe";
    this.channels = [];
  }

  async saveRules(ruleSet: RuleSet): Promise<string | null> {
    if (!this.state.key) return "Lancez d'abord une observation : les règles appartiennent à une chaîne.";
    const body = { channel: ruleSet.channel, context: ruleSet.context, review_if_mentions_bot: ruleSet.reviewIfMentionsBot, rules: ruleSet.rules };
    const res = await fetch(`/api/rules?key=${encodeURIComponent(this.state.key)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({ message: res.statusText }))).message as string;
  }

  /** Règles affichées avant tout démarrage : le jeu par défaut. */
  async loadDefaultRules() {
    if (this.state.key || this.state.rules.length) return;
    const res = await fetch("/api/rules");
    if (res.ok) {
      const rs = (await res.json()) as RuleSet;
      this.state.ruleSet = rs;
      this.state.rules = rs.rules;
    }
  }

  async act(id: string, kind: "delete" | "timeout" | "warn"): Promise<string | null> {
    return (await this.post("/api/act", { key: this.state.key, id, kind })).message;
  }

  async annotate(id: string, verdict: "confirmed" | "dismissed") {
    await this.post("/api/annotate", { key: this.state.key, id, verdict });
  }
}

function upsert(list: UiMessage[], m: UiMessage, max: number) {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) list[i] = m;
  else {
    list.push(m);
    if (list.length > max) list.splice(0, list.length - max);
  }
}

export const live = new Live();
