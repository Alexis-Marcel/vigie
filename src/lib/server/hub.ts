import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { readTwitchChat } from "#lib/core/sources/twitch.ts";
import { fetchStreamInfo, type StreamInfo } from "#lib/core/sources/twitch-info.ts";
import { Store, type Account } from "#lib/core/store.ts";
import { parseRuleSet } from "#lib/core/rules.ts";
import { Pipeline, type PipelineStats } from "#lib/core/pipeline.ts";
import type { ChatMessage, RuleSet } from "#lib/core/types.ts";
import type { Mode, UiEvent, UiMessage, UiState } from "#lib/ui/types.ts";
import { toUiMessage } from "#lib/ui/types.ts";
import { deleteMessage, timeoutUser, warnUser, moderatedChannels, type ActionKind } from "./twitch-actions.ts";

// Vite ne charge pas .env dans process.env : on le fait ici, une fois.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* pas de .env : les clés peuvent venir de l'environnement */
}

// ---------- limites d'un service ouvert à tous
export const LIMITS = {
  /** Observations simultanées sur ce serveur, toutes personnes confondues. */
  maxConcurrent: Number(process.env.VIGIE_MAX_CONCURRENT ?? 20),
  /** Durée maximale d'une observation sans compte. */
  anonymousMs: Number(process.env.VIGIE_ANON_HOURS ?? 2) * 3_600_000,
  /** Durée maximale d'une observation par un modérateur connecté. */
  connectedMs: Number(process.env.VIGIE_CONNECTED_HOURS ?? 12) * 3_600_000,
  /** Arrêt automatique quand la chaîne est restée hors ligne aussi longtemps (observations connectées). */
  offlineGraceMs: 15 * 60_000,
  /** Dépense Jev maximale par jour, en dollars. */
  dailyBudgetUsd: Number(process.env.VIGIE_DAILY_BUDGET_USD ?? 3),
  /** Rétention des messages bruts. */
  retentionMs: 7 * 24 * 3_600_000,
};

const RECENT = 300;
const QUEUE = 500;
const DEFAULT_RULES_PATH = process.env.VIGIE_DEFAULT_RULES ?? "rules.example.yaml";

export const store = new Store();

function emptyStats(): PipelineStats {
  return { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 };
}

export function defaultRules(channel: string): RuleSet {
  const rs = parseRuleSet(parse(readFileSync(DEFAULT_RULES_PATH, "utf8")));
  return { ...rs, channel };
}

function rulesToYaml(rules: RuleSet): string {
  return stringify(
    {
      channel: rules.channel,
      context: rules.context,
      review_if_mentions_bot: rules.reviewIfMentionsBot,
      rules: rules.rules.map((r) => ({ id: r.id, label: r.label, question: r.question, action: r.action, threshold: r.threshold })),
    },
    { lineWidth: 100 },
  );
}

/** Ce qu'une observation transporte d'une version du code à la suivante (rechargement à chaud en dev). */
interface Snapshot {
  key: string;
  channel: string;
  ownerSid: string;
  actor: Account | null;
  mode: Mode;
  session: string;
  startedAt: number;
  deadline: number;
  stream: StreamInfo | null;
  stats: PipelineStats;
  recent: UiMessage[];
  queue: UiMessage[];
  ruleHits: Record<string, number>;
}

/**
 * Une observation : le chat d'une chaîne, un pipeline, une file, et un flux
 * d'événements. Partagée par les modérateurs d'une même chaîne, privée pour un anonyme.
 */
export class Observation extends EventEmitter {
  readonly key: string;
  readonly channel: string;
  readonly ownerSid: string;
  readonly rulesKey: string;
  rules: RuleSet;
  actor: Account | null = null;
  mode: Mode = "observe";
  session = "";
  startedAt = 0;
  deadline = 0;
  stream: StreamInfo | null = null;
  stoppedReason: string | null = null;
  recent: UiMessage[] = [];
  queue: UiMessage[] = [];
  ruleHits: Record<string, number> = {};

  private pipeline: Pipeline;
  private stop: (() => void) | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private generation = 0;
  private offlineSince: number | null = null;
  private raw = new Map<string, ChatMessage>();

  constructor(key: string, channel: string, ownerSid: string) {
    super();
    this.key = key;
    this.channel = channel;
    this.ownerSid = ownerSid;
    this.rulesKey = key;
    const saved = store.channelRulesYaml(this.rulesKey);
    this.rules = saved ? parseRuleSet(parse(saved)) : defaultRules(channel);
    this.pipeline = new Pipeline(this.rules, store);
    this.ruleHits = Object.fromEntries(this.rules.rules.map((r) => [r.id, 0]));
  }

  get running() {
    return this.stop !== null;
  }

  /** Vrai si ce compte peut agir sur la chaîne de cette observation. */
  async canAct(account: Account | null): Promise<boolean> {
    if (!account) return false;
    if (this.actor?.userId === account.userId) return true;
    const list = await moderatedChannels(store, account).catch(() => []);
    return list.some((c) => c.login === this.channel);
  }

  state(account: Account | null, canAct: boolean): UiState {
    return {
      key: this.key,
      account: account ? { userId: account.userId, login: account.login, displayName: account.displayName, avatar: account.avatar } : null,
      canAct,
      mode: this.mode,
      channel: this.channel,
      running: this.running,
      startedAt: this.startedAt || null,
      deadline: this.deadline || null,
      stoppedReason: this.stoppedReason,
      stream: this.stream,
      context: this.pipeline.currentContext(),
      stats: this.pipeline.stats,
      rules: this.rules.rules,
      ruleSet: this.rules,
      ruleHits: this.ruleHits,
      recent: this.recent,
      queue: this.queue,
    };
  }

  private emitEvent(ev: UiEvent) {
    for (const l of this.listeners("event") as Array<(ev: UiEvent) => void>) {
      try {
        l(ev);
      } catch {
        this.off("event", l);
      }
    }
  }

  async start(resume?: Snapshot) {
    if (this.running) this.halt(null, true);
    const gen = ++this.generation;
    this.session = resume?.session ?? new Date().toISOString();
    this.startedAt = resume?.startedAt ?? Date.now();
    this.deadline = resume?.deadline ?? this.startedAt + (this.actor ? LIMITS.connectedMs : LIMITS.anonymousMs);
    this.stoppedReason = null;
    if (resume) {
      this.recent = resume.recent;
      this.queue = resume.queue;
      this.stream = resume.stream;
      this.ruleHits = resume.ruleHits;
      Object.assign(this.pipeline.stats, resume.stats);
      if (this.stream) this.pipeline.setStreamInfo(this.stream);
    }

    await this.refreshStream();
    if (gen !== this.generation) return;
    this.timers.push(setInterval(() => this.refreshStream(), 5 * 60_000));

    this.stop = readTwitchChat({
      channels: [this.channel],
      onStatus: (t) => console.error(`[vigie ${this.channel}] ${t}`),
      onMessage: (m) => {
        store.insertMessage(m, this.session);
        this.raw.set(m.id, m);
        if (this.raw.size > 5000) this.raw.delete(this.raw.keys().next().value!);
        const ui = toUiMessage(m);
        this.push(this.recent, ui, RECENT);
        this.emitEvent({ type: "message", message: ui });
        this.pipeline.handle(m).then((ev) => {
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
            if (ev.decision.kind === "delete" && this.mode === "moderate" && this.actor) {
              void this.act(ui.id, "delete", this.actor, true);
            }
          }
          this.emitEvent({ type: "message", message: ui });
          this.emitEvent({ type: "stats", stats: this.pipeline.stats, ruleHits: this.ruleHits });
        });
      },
    });
    this.emitEvent({ type: "state", state: this.state(this.actor, !!this.actor) });
  }

  halt(reason: string | null = null, silent = false) {
    this.generation++;
    this.stop?.();
    this.stop = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.stoppedReason = reason;
    if (!silent) this.emitEvent({ type: "stopped", reason });
  }

  /** Appelé chaque minute par le hub : limites de durée et de live. */
  enforce(now: number): string | null {
    if (!this.running) return null;
    if (now >= this.deadline) {
      const h = Math.round((this.deadline - this.startedAt) / 3_600_000);
      return `Durée maximale atteinte (${h} h). Relancez l'observation si besoin.`;
    }
    if (this.actor && this.stream && !this.stream.live) {
      this.offlineSince ??= now;
      if (now - this.offlineSince > LIMITS.offlineGraceMs) return "Le live est terminé depuis plus de 15 minutes.";
    } else {
      this.offlineSince = null;
    }
    return null;
  }

  snapshot(): Snapshot {
    return {
      key: this.key,
      channel: this.channel,
      ownerSid: this.ownerSid,
      actor: this.actor,
      mode: this.mode,
      session: this.session,
      startedAt: this.startedAt,
      deadline: this.deadline,
      stream: this.stream,
      stats: { ...this.pipeline.stats },
      recent: this.recent,
      queue: this.queue,
      ruleHits: this.ruleHits,
    };
  }

  setActor(account: Account | null) {
    this.actor = account;
    if (!account && this.mode !== "observe") this.setMode("observe");
  }

  setMode(mode: Mode) {
    if (mode !== "observe" && !this.actor) throw new Error("Connectez un compte Twitch modérateur pour assister ou modérer.");
    if (this.mode === mode) return;
    this.mode = mode;
    this.emitEvent({ type: "mode", mode });
  }

  updateRules(raw: unknown): RuleSet {
    const next = parseRuleSet(raw);
    next.channel = this.channel;
    store.saveChannelRulesYaml(this.rulesKey, this.channel, rulesToYaml(next));
    this.rules = next;
    for (const r of next.rules) this.ruleHits[r.id] ??= 0;
    this.pipeline.setRules(next);
    this.emitEvent({ type: "rules", ruleSet: next, context: this.pipeline.currentContext() });
    return next;
  }

  async act(id: string, kind: ActionKind, account: Account, automatic = false): Promise<UiMessage> {
    const ui = this.queue.find((m) => m.id === id) ?? this.recent.find((m) => m.id === id);
    const m = this.raw.get(id);
    if (!ui || !m) throw new Error("Message introuvable dans cette observation");
    const d = ui.decision;
    const rule = d && d.kind !== "pass" ? this.rules.rules.find((r) => r.id === d.ruleId) : null;
    const reason = `Vigie : ${rule?.label ?? "modération"}`;
    try {
      if (kind === "delete") await deleteMessage(store, account, this.channel, id);
      else if (kind === "timeout") await timeoutUser(store, account, this.channel, m.userId, 600, reason);
      else await warnUser(store, account, this.channel, m.userId, reason);
      ui.action = { kind, ok: true, automatic };
      store.insertAction({ messageId: id, kind, byUserId: account.userId, automatic, ok: true });
      if (d && d.kind !== "pass" && !ui.annotation) this.annotate(id, "confirmed");
    } catch (e) {
      ui.action = { kind, ok: false, automatic, error: (e as Error).message };
      store.insertAction({ messageId: id, kind, byUserId: account.userId, automatic, ok: false, error: (e as Error).message });
    }
    this.emitEvent({ type: "message", message: ui });
    return ui;
  }

  annotate(id: string, verdict: "confirmed" | "dismissed") {
    const msg = this.queue.find((m) => m.id === id) ?? this.recent.find((m) => m.id === id);
    const d = msg?.decision;
    if (!msg || !d || d.kind === "pass") return false;
    const labels = Object.fromEntries(this.rules.rules.map((r) => [r.id, verdict === "confirmed" && r.id === d.ruleId]));
    store.setAnnotations(id, labels);
    msg.annotation = verdict;
    this.emitEvent({ type: "annotation", id, annotation: verdict });
    return true;
  }

  private async refreshStream() {
    try {
      this.stream = await fetchStreamInfo(this.channel);
      store.insertContext(this.stream);
      this.pipeline.setStreamInfo(this.stream);
    } catch (e) {
      console.error(`[vigie ${this.channel}] contexte indisponible : ${(e as Error).message}`);
    }
    this.emitEvent({ type: "stream", stream: this.stream, context: this.pipeline.currentContext() });
  }

  private push<T>(arr: T[], item: T, max: number) {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }

  private pushQueue(item: UiMessage) {
    this.queue.push(item);
    while (this.queue.length > QUEUE) {
      const i = this.queue.findIndex((m) => m.annotation);
      this.queue.splice(i >= 0 ? i : 0, 1);
    }
  }
}

/** Qui demande quoi : navigateur, compte éventuel. */
export interface Viewer {
  sid: string;
  account: Account | null;
}

/**
 * Toutes les observations du serveur, les limites, et l'entretien.
 * Clé d'observation : la chaîne seule pour un modérateur de cette chaîne (partagée
 * par l'équipe), « chaîne@navigateur » pour un anonyme (privée).
 */
export class Hub {
  readonly observations = new Map<string, Observation>();
  private tick: ReturnType<typeof setInterval>;
  private lastPurge = 0;

  constructor() {
    this.tick = setInterval(() => this.maintain(), 60_000);
  }

  dispose() {
    clearInterval(this.tick);
  }

  private async keyFor(channel: string, viewer: Viewer): Promise<{ key: string; isMod: boolean }> {
    if (viewer.account) {
      const list = await moderatedChannels(store, viewer.account).catch(() => []);
      if (list.some((c) => c.login === channel)) return { key: channel, isMod: true };
    }
    return { key: `${channel}@${viewer.sid}`, isMod: false };
  }

  get(key: string): Observation | null {
    return this.observations.get(key) ?? null;
  }

  /** L'observation que ce navigateur regardait : la sienne, ou celle d'une chaîne qu'il modère. */
  async mine(viewer: Viewer): Promise<Observation[]> {
    const out: Observation[] = [];
    for (const o of this.observations.values()) {
      if (o.ownerSid === viewer.sid) out.push(o);
      else if (viewer.account && o.key === o.channel && (await o.canAct(viewer.account))) out.push(o);
    }
    return out;
  }

  /** Vrai si ce navigateur peut regarder cette observation (la sienne, ou partagée et il en est modérateur). */
  async mayView(o: Observation, viewer: Viewer): Promise<boolean> {
    if (o.ownerSid === viewer.sid) return true;
    if (o.key !== o.channel) return false; // privée à un autre navigateur
    return o.canAct(viewer.account);
  }

  budgetLeft(): number {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return LIMITS.dailyBudgetUsd - store.costSince(midnight.getTime());
  }

  async start(channel: string, mode: Mode, viewer: Viewer): Promise<Observation> {
    const { key, isMod } = await this.keyFor(channel, viewer);
    if (mode !== "observe" && !isMod) {
      throw Object.assign(new Error(viewer.account ? `${viewer.account.displayName} n'est pas modérateur de ${channel}.` : "Connectez un compte Twitch modérateur pour assister ou modérer."), { status: viewer.account ? 403 : 401 });
    }
    if (this.budgetLeft() <= 0) {
      throw Object.assign(new Error("Le budget du jour est épuisé, Vigie reprend demain. Vous pouvez quand même rejouer les enregistrements."), { status: 429 });
    }

    let o = this.observations.get(key);
    if (!o) {
      // Un anonyme n'a qu'une observation à la fois : la précédente s'arrête.
      if (!isMod) for (const other of await this.mine(viewer)) if (other.key !== other.channel) this.stopObservation(other, null);
      const running = [...this.observations.values()].filter((x) => x.running).length;
      if (running >= LIMITS.maxConcurrent) {
        throw Object.assign(new Error(`Vigie suit déjà ${running} chats en même temps, c'est le maximum pour ce serveur. Réessayez un peu plus tard.`), { status: 429 });
      }
      o = new Observation(key, channel, viewer.sid);
      this.observations.set(key, o);
    }
    if (isMod && viewer.account) o.setActor(viewer.account);
    if (!o.running) await o.start();
    if (mode !== "observe") o.setMode(mode);
    else if (o.mode !== "observe" && o.actor?.userId === viewer.account?.userId) o.setMode("observe");
    return o;
  }

  stopObservation(o: Observation, reason: string | null) {
    o.halt(reason);
    // On garde l'observation arrêtée quelques minutes pour que la page affiche la raison, puis on la libère.
    setTimeout(() => {
      if (!o.running && this.observations.get(o.key) === o) {
        this.observations.delete(o.key);
        o.removeAllListeners();
      }
    }, 10 * 60_000).unref?.();
  }

  /** Déconnexion d'un compte : ses observations repassent en Observer. */
  dropActor(userId: string) {
    for (const o of this.observations.values()) if (o.actor?.userId === userId) o.setActor(null);
  }

  private maintain() {
    const now = Date.now();
    for (const o of this.observations.values()) {
      const reason = o.enforce(now);
      if (reason) this.stopObservation(o, reason);
    }
    if (this.budgetLeft() <= 0) {
      for (const o of this.observations.values()) if (o.running) this.stopObservation(o, "Budget du jour épuisé, Vigie reprend demain.");
    }
    if (now - this.lastPurge > 3_600_000) {
      this.lastPurge = now;
      const n = store.purgeMessagesBefore(now - LIMITS.retentionMs);
      if (n) console.error(`[vigie] ${n} messages de plus de 7 jours effacés`);
    }
  }

  snapshots(): Snapshot[] {
    return [...this.observations.values()].filter((o) => o.running).map((o) => o.snapshot());
  }
}

/*
 * Rechargement à chaud (dev) : les observations en cours passent à la nouvelle version du code,
 * et les pages connectées en SSE sont rebranchées. En production, ce bloc est inerte.
 */
type Global = { __vigieHub?: Hub; __vigieListeners?: Map<string, Array<(ev: UiEvent) => void>> };
const g = globalThis as unknown as Global;

const previous = g.__vigieHub;
export const hub = new Hub();
g.__vigieHub = hub;
g.__vigieListeners ??= new Map();

/** Abonnement d'une page à une observation, mémorisé pour survivre au rechargement. */
export function subscribe(key: string, l: (ev: UiEvent) => void): () => void {
  const list = g.__vigieListeners!.get(key) ?? [];
  list.push(l);
  g.__vigieListeners!.set(key, list);
  hub.get(key)?.on("event", l);
  return () => {
    g.__vigieListeners!.set(key, (g.__vigieListeners!.get(key) ?? []).filter((x) => x !== l));
    hub.get(key)?.off("event", l);
  };
}

if (previous) {
  previous.dispose();
  const snaps = previous.snapshots();
  for (const o of previous.observations.values()) {
    o.halt(null, true);
    o.removeAllListeners();
  }
  for (const snap of snaps) {
    const o = new Observation(snap.key, snap.channel, snap.ownerSid);
    o.actor = snap.actor;
    o.mode = snap.mode;
    hub.observations.set(snap.key, o);
    for (const l of g.__vigieListeners.get(snap.key) ?? []) o.on("event", l);
    console.error(`[vigie ${snap.channel}] code rechargé, reprise de l'observation`);
    o.start(snap).catch((e) => console.error(`[vigie ${snap.channel}] reprise impossible : ${(e as Error).message}`));
  }
}
