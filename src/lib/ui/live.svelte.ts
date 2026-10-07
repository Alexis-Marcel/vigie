import type { UiEvent, UiMessage, UiState } from "./types.ts";
import type { RuleSet } from "#lib/core/types.ts";

const empty: UiState = {
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
  private es: EventSource | null = null;

  connect() {
    this.es?.close();
    this.es = new EventSource("/api/events");
    this.es.onopen = () => (this.connected = true);
    this.es.onerror = () => (this.connected = false);
    this.es.onmessage = (e) => this.apply(JSON.parse(e.data) as UiEvent);
  }

  disconnect() {
    this.es?.close();
    this.es = null;
  }

  private apply(ev: UiEvent) {
    switch (ev.type) {
      case "state":
        this.state = ev.state;
        break;
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

  async watch(channel: string) {
    this.busy = true;
    this.error = null;
    try {
      const res = await fetch("/api/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
      if (!res.ok) this.error = (await res.json().catch(() => ({ message: res.statusText }))).message;
    } finally {
      this.busy = false;
    }
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
