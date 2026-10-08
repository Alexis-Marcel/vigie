import type { Mode, UiChannel, UiEvent, UiMessage, UiState } from "./types.ts";
import type { RuleSet } from "#lib/core/types.ts";

const empty: UiState = {
  account: null,
  mode: "observe",
  channel: null,
  running: false,
  startedAt: null,
  stream: null,
  context: "",
  stats: { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 },
  rules: [],
  ruleSet: { channel: "", context: "", reviewIfMentionsBot: true, rules: [] },
  ruleHits: {},
  recent: [],
  queue: [],
};

/** État de la page, alimenté par le flux SSE du serveur. */
export class Live {
  state = $state<UiState>(empty);
  connected = $state(false);
  busy = $state(false);
  error = $state<string | null>(null);
  /** Chaînes où le compte connecté peut agir. Chargées une fois le compte connu. */
  channels = $state<UiChannel[]>([]);
  private es: EventSource | null = null;

  connect() {
    this.es?.close();
    this.es = new EventSource("/api/events");
    this.es.onopen = () => (this.connected = true);
    this.es.onerror = () => (this.connected = false);
    this.es.onmessage = (e) => this.apply(JSON.parse(e.data) as UiEvent);
  }

  async loadChannels() {
    if (!this.state.account) {
      this.channels = [];
      return;
    }
    const res = await fetch("/api/channels");
    this.channels = res.ok ? ((await res.json()) as UiChannel[]) : [];
  }

  disconnect() {
    this.es?.close();
    this.es = null;
  }

  private apply(ev: UiEvent) {
    switch (ev.type) {
      case "state": {
        const hadAccount = !!this.state.account;
        this.state = ev.state;
        if (!!ev.state.account !== hadAccount || (ev.state.account && this.channels.length === 0)) void this.loadChannels();
        break;
      }
      case "message":
        upsert(this.state.recent, ev.message, 300);
        if (ev.message.decision && ev.message.decision.kind !== "pass") upsert(this.state.queue, ev.message, 200);
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

  /** Démarre ou redémarre l'observation d'une chaîne dans un mode. */
  async watch(channel: string, mode: Mode) {
    this.busy = true;
    this.error = null;
    try {
      const res = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, mode }) });
      if (!res.ok) this.error = (await res.json().catch(() => ({ message: res.statusText }))).message;
    } finally {
      this.busy = false;
    }
  }

  /** Change le mode de l'observation en cours. Renvoie null, ou le message d'erreur. */
  async setMode(mode: Mode): Promise<string | null> {
    const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({ message: res.statusText }))).message as string;
  }

  async stop() {
    await fetch("/api/stop", { method: "POST" });
  }

  /** Enregistre le jeu de règles. Renvoie null si tout va bien, sinon le message d'erreur. */
  async saveRules(ruleSet: RuleSet): Promise<string | null> {
    const body = {
      channel: ruleSet.channel,
      context: ruleSet.context,
      review_if_mentions_bot: ruleSet.reviewIfMentionsBot,
      rules: ruleSet.rules,
    };
    const res = await fetch("/api/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({ message: res.statusText }))).message as string;
  }

  async logout() {
    await fetch("/auth/logout", { method: "POST" });
    this.state.account = null;
    this.state.mode = "observe";
    this.channels = [];
  }

  /** Agit sur Twitch depuis la file. Le message mis à jour revient par le flux. */
  async act(id: string, kind: "delete" | "timeout" | "warn"): Promise<string | null> {
    const res = await fetch("/api/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, kind }) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({ message: res.statusText }))).message as string;
  }

  async annotate(id: string, verdict: "confirmed" | "dismissed") {
    await fetch("/api/annotate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, verdict }) });
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
