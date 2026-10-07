import { EventEmitter } from "node:events";
import { readTwitchChat } from "#lib/core/sources/twitch.ts";
import { fetchStreamInfo, type StreamInfo } from "#lib/core/sources/twitch-info.ts";
import { Store } from "#lib/core/store.ts";
import { loadRules, saveRules, parseRuleSet } from "#lib/core/rules.ts";
import { Pipeline, type PipelineStats } from "#lib/core/pipeline.ts";
import type { RuleSet } from "#lib/core/types.ts";
import type { UiEvent, UiMessage, UiState } from "#lib/ui/types.ts";
import { toUiMessage } from "#lib/ui/types.ts";

// Vite ne charge pas .env dans process.env : on le fait ici, une fois, pour la clé Jev.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* pas de .env : la clé peut venir de l'environnement */
}

const RECENT = 300;
const QUEUE = 500;

/** Ce qu'une observation en cours transporte d'une version du code à la suivante (rechargement à chaud en dev). */
interface Snapshot {
  channel: string;
  session: string;
  startedAt: number;
  stream: StreamInfo | null;
  stats: PipelineStats;
  recent: UiMessage[];
  queue: UiMessage[];
  ruleHits: Record<string, number>;
}

/**
 * Une seule session d'observation à la fois dans ce processus : le chat d'une
 * chaîne, le pipeline, et un flux d'événements que les pages écoutent en SSE.
 */
class Watcher extends EventEmitter {
  private store = new Store();
  private rulesPath = process.env.VIGIE_RULES ?? "rules.yaml";
  private rules: RuleSet = loadRules(this.rulesPath);
  private pipeline: Pipeline | null = null;
  private stop: (() => void) | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private session = "";

  channel: string | null = null;
  startedAt: number | null = null;
  stream: StreamInfo | null = null;
  recent: UiMessage[] = [];
  queue: UiMessage[] = [];
  ruleHits: Record<string, number> = {};

  get running() {
    return this.stop !== null;
  }

  state(): UiState {
    return {
      channel: this.channel,
      running: this.running,
      startedAt: this.startedAt,
      stream: this.stream,
      context: this.pipeline?.currentContext() ?? "",
      stats: this.pipeline?.stats ?? emptyStats(),
      rules: this.rules.rules,
      ruleSet: this.rules,
      ruleHits: this.ruleHits,
      recent: this.recent,
      queue: this.queue,
    };
  }

  private emitEvent(ev: UiEvent) {
    this.emit("event", ev);
  }

  async start(channel: string, resume?: Snapshot) {
    if (this.running) this.halt(true);
    this.channel = channel.toLowerCase().replace(/^#/, "");
    this.session = resume?.session ?? new Date().toISOString();
    this.startedAt = resume?.startedAt ?? Date.now();
    this.recent = resume?.recent ?? [];
    this.queue = resume?.queue ?? [];
    this.stream = resume?.stream ?? null;
    this.ruleHits = resume?.ruleHits ?? Object.fromEntries(this.rules.rules.map((r) => [r.id, 0]));
    this.pipeline = new Pipeline(this.rules, this.store);
    if (resume) Object.assign(this.pipeline.stats, resume.stats);
    if (this.stream) this.pipeline.setStreamInfo(this.stream);

    await this.refreshStream();
    this.timers.push(setInterval(() => this.refreshStream(), 5 * 60_000));

    this.stop = readTwitchChat({
      channels: [this.channel],
      onStatus: (t) => console.error(`[vigie] ${t}`),
      onMessage: (m) => {
        this.store.insertMessage(m, this.session);
        const ui = toUiMessage(m);
        this.push(this.recent, ui, RECENT);
        this.emitEvent({ type: "message", message: ui });
        this.pipeline!.handle(m).then((ev) => {
          ui.skipped = ev.skipped;
          ui.error = ev.error;
          if (ev.judgement) {
            ui.probs = Object.fromEntries(ev.judgement.verdicts.map((v) => [v.ruleId, v.confidence]));
            ui.latencyMs = ev.judgement.latencyMs;
          }
          ui.decision = ev.decision;
          if (ev.decision && ev.decision.kind !== "pass") {
            this.ruleHits[ev.decision.ruleId] = (this.ruleHits[ev.decision.ruleId] ?? 0) + 1;
            this.pushQueue(ui);
          }
          this.emitEvent({ type: "message", message: ui });
          this.emitEvent({ type: "stats", stats: this.pipeline!.stats, ruleHits: this.ruleHits });
        });
      },
    });
    this.emitEvent({ type: "state", state: this.state() });
  }

  halt(silent = false) {
    this.stop?.();
    this.stop = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (!silent) this.emitEvent({ type: "state", state: this.state() });
  }

  /** Relance la lecture sur la même chaîne en gardant chat, file et bilan. Utilisé quand le code change. */
  async reload() {
    if (!this.running || !this.channel) return;
    await this.start(this.channel, this.snapshot());
  }

  snapshot(): Snapshot {
    return {
      channel: this.channel!,
      session: this.session,
      startedAt: this.startedAt ?? Date.now(),
      stream: this.stream,
      stats: { ...(this.pipeline?.stats ?? emptyStats()) },
      recent: this.recent,
      queue: this.queue,
      ruleHits: this.ruleHits,
    };
  }

  getRules(): RuleSet {
    return this.rules;
  }

  /** Valide, écrit le fichier, applique à l'observation en cours. Lève une erreur lisible si le jeu est invalide. */
  updateRules(raw: unknown): RuleSet {
    const next = parseRuleSet(raw);
    saveRules(this.rulesPath, next);
    this.rules = next;
    for (const r of next.rules) this.ruleHits[r.id] ??= 0;
    this.pipeline?.setRules(next);
    this.emitEvent({ type: "rules", ruleSet: next, context: this.pipeline?.currentContext() ?? "" });
    return next;
  }

  /** Valider = la règle s'appliquait ; ignorer = aucune règle ne s'appliquait. Les deux sont des annotations. */
  annotate(id: string, verdict: "confirmed" | "dismissed") {
    const msg = this.queue.find((m) => m.id === id) ?? this.recent.find((m) => m.id === id);
    const d = msg?.decision;
    if (!msg || !d || d.kind === "pass") return false;
    const labels = Object.fromEntries(this.rules.rules.map((r) => [r.id, verdict === "confirmed" && r.id === d.ruleId]));
    this.store.setAnnotations(id, labels);
    msg.annotation = verdict;
    this.emitEvent({ type: "annotation", id, annotation: verdict });
    return true;
  }

  private async refreshStream() {
    if (!this.channel) return;
    try {
      this.stream = await fetchStreamInfo(this.channel);
      this.store.insertContext(this.stream);
      this.pipeline?.setStreamInfo(this.stream);
    } catch (e) {
      console.error(`[vigie] contexte indisponible : ${(e as Error).message}`);
    }
    this.emitEvent({ type: "stream", stream: this.stream, context: this.pipeline?.currentContext() ?? "" });
  }

  private push<T>(arr: T[], item: T, max: number) {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  /** La file garde au plus QUEUE entrées : on évince d'abord les plus anciennes déjà traitées. */
  private pushQueue(item: UiMessage) {
    this.queue.push(item);
    while (this.queue.length > QUEUE) {
      const i = this.queue.findIndex((m) => m.annotation);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
  }
}

function emptyStats(): PipelineStats {
  return { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 };
}

/*
 * Rechargement à chaud (dev) : quand ce module ou un de ses imports change, Vite le
 * ré-évalue. L'ancienne instance arrête sa lecture et confie son état à la nouvelle,
 * qui reprend la même chaîne avec le nouveau code. En production, ce bloc est inerte.
 */
type Global = { __vigieWatcher?: Watcher; __vigieResume?: Snapshot; __vigieListeners?: Array<(ev: UiEvent) => void> };
const g = globalThis as unknown as Global;

const previous = g.__vigieWatcher;
export const watcher = new Watcher();
g.__vigieWatcher = watcher;

// Les pages connectées en SSE écoutaient l'ancienne instance : on les rebranche.
g.__vigieListeners ??= [];
for (const l of g.__vigieListeners) watcher.on("event", l);
const originalOn = watcher.on.bind(watcher);
const originalOff = watcher.off.bind(watcher);
watcher.on = ((name: string, l: (ev: UiEvent) => void) => {
  if (name === "event") g.__vigieListeners!.push(l);
  return originalOn(name, l);
}) as typeof watcher.on;
watcher.off = ((name: string, l: (ev: UiEvent) => void) => {
  if (name === "event") g.__vigieListeners = g.__vigieListeners!.filter((x) => x !== l);
  return originalOff(name, l);
}) as typeof watcher.off;

if (previous?.running) {
  const snap = previous.snapshot();
  previous.halt(true);
  previous.removeAllListeners();
  console.error("[vigie] code rechargé, reprise de l'observation sur #" + snap.channel);
  watcher.start(snap.channel, snap).catch((e) => console.error(`[vigie] reprise impossible : ${(e as Error).message}`));
} else if (previous) {
  previous.removeAllListeners();
}
