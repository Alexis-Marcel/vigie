import { JevJudge, jevOptionsFromEnv } from "./judges/jev.js";
import type { Judge } from "./judges/judge.js";
import { prefilter } from "./prefilter.js";
import { decide } from "./decide.js";
import { buildContext } from "./context.js";
import type { Store } from "./store.js";
import type { StreamInfo } from "./sources/twitch-info.js";
import type { ChatMessage, Decision, Judgement, RuleSet } from "./types.js";

export interface PipelineEvent {
  message: ChatMessage;
  skipped?: string; // raison du préfiltre
  judgement?: Judgement;
  decision?: Decision;
  error?: string;
}

export interface PipelineStats {
  total: number;
  prefiltered: number;
  judged: number;
  pass: number;
  review: number;
  delete: number;
  errors: number;
  cost: number;
  latency: number;
  /** Médiane et 95e centile sur les derniers appels (la moyenne est faussée par les rares appels qui décrochent). */
  p50: number;
  p95: number;
}

/**
 * Un message entre, une décision sort. Le pipeline garde une fenêtre glissante
 * des derniers messages pour le préfiltre (copier-coller) et pour le contexte
 * envoyé à Jev. Le contexte du live (titre, catégorie) est fourni de l'extérieur
 * et peut changer en cours de route.
 */
export class Pipeline {
  readonly stats: PipelineStats = { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 };
  private latencies: number[] = [];
  private recent: ChatMessage[] = [];
  private streamInfo: StreamInfo | null = null;
  private readonly judge: Judge;

  constructor(
    private rules: RuleSet,
    private readonly store: Store,
    private readonly opts: { contextSize?: number; judge?: Judge } = {},
  ) {
    this.judge = opts.judge ?? new JevJudge(jevOptionsFromEnv());
  }

  setRules(rules: RuleSet) {
    this.rules = rules;
  }

  setStreamInfo(info: StreamInfo | null) {
    this.streamInfo = info;
  }

  currentContext(): string {
    return buildContext(this.streamInfo, this.rules.context);
  }

  async handle(m: ChatMessage): Promise<PipelineEvent> {
    this.stats.total++;
    const window = this.recent.slice(-50);
    const ctx = this.recent.slice(-(this.opts.contextSize ?? 5));
    this.recent.push(m);
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);

    const pf = prefilter(m, window);
    if (pf.skip) {
      this.stats.prefiltered++;
      return { message: m, skipped: pf.reason };
    }

    const rulesHere = { ...this.rules, context: this.currentContext() };
    try {
      const judgement = await this.judge.judge(m, rulesHere, ctx);
      this.store.insertJudgement(judgement);
      this.stats.judged++;
      this.stats.cost += judgement.costUsd ?? 0;
      this.stats.latency += judgement.latencyMs;
      this.latencies.push(judgement.latencyMs);
      if (this.latencies.length > 2000) this.latencies.shift();
      if (this.stats.judged % 10 === 0 || this.stats.judged < 10) {
        const sorted = [...this.latencies].sort((a, b) => a - b);
        this.stats.p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        this.stats.p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      }
      const decision = decide(m, judgement, this.rules);
      this.stats[decision.kind]++;
      return { message: m, judgement, decision };
    } catch (e) {
      this.stats.errors++;
      return { message: m, error: (e as Error).message };
    }
  }
}

export function formatEvent(ev: PipelineEvent, rules: RuleSet): string | null {
  const { message: m, decision: d, judgement: j } = ev;
  if (ev.error) return `\x1b[31mERREUR\x1b[0m ${m.userName}: ${m.text}\n        ${ev.error}`;
  if (!d || !j || d.kind === "pass") return null;
  const tag = d.kind === "delete" ? "\x1b[41m SUPPR \x1b[0m" : "\x1b[43m\x1b[30m VERIF \x1b[0m";
  const label = rules.rules.find((r) => r.id === d.ruleId)?.label ?? d.ruleId;
  const reason = d.kind === "review" ? ` (${d.reason})` : "";
  const probs = j.verdicts
    .filter((v) => v.confidence >= 0.2)
    .sort((a, b) => b.confidence - a.confidence)
    .map((v) => `${v.ruleId}=${v.confidence.toFixed(2)}`)
    .join(" ");
  return `${tag} ${label} ${d.confidence.toFixed(2)}${reason}  ${j.latencyMs} ms\n        ${m.userName}: ${m.text}\n        \x1b[2m${probs}\x1b[0m`;
}

export function formatStats(s: PipelineStats): string {
  const per10k = s.judged ? ((s.cost / s.judged) * 10_000).toFixed(2) : "?";
  return `${s.total} messages, ${s.prefiltered} écartés par le préfiltre, ${s.judged} jugés par Jev, ${s.errors} erreurs
laisser passer ${s.pass} · vérification ${s.review} · suppression ${s.delete}
latence médiane ${s.p50} ms (p95 ${s.p95} ms) · coût ${s.cost.toFixed(4)} $ (${per10k} $ / 10 000 messages jugés)`;
}
