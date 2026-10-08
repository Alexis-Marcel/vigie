import type { ChatMessage, Decision, Rule, RuleSet } from "#lib/core/types.ts";
import type { StreamInfo } from "#lib/core/sources/twitch-info.ts";
import type { PipelineStats } from "#lib/core/pipeline.ts";

/**
 * Jusqu'où Vigie a le droit d'aller.
 *  - observe  : lecture anonyme, aucun compte, rien ne touche Twitch ;
 *  - assist   : Vigie signale, les humains agissent depuis la file ;
 *  - moderate : Vigie supprime seule au-dessus des seuils, les humains traitent la zone grise.
 */
export type Mode = "observe" | "assist" | "moderate";

/** Un message tel que l'interface le reçoit : le texte, et ce que Vigie en a fait. */
export interface UiMessage {
  id: string;
  userName: string;
  text: string;
  sentAt: number;
  skipped?: string;
  probs?: Record<string, number>;
  latencyMs?: number;
  decision?: Decision;
  annotation?: "confirmed" | "dismissed";
  error?: string;
  /** Action réellement effectuée sur Twitch (ou tentée). */
  action?: { kind: "delete" | "timeout" | "warn"; ok: boolean; automatic: boolean; error?: string };
}

export interface UiAccount {
  userId: string;
  login: string;
  displayName: string;
  avatar: string;
}

/** Une chaîne sur laquelle le compte connecté peut agir : la sienne, ou une qu'il modère. */
export interface UiChannel {
  login: string;
  displayName: string;
  isOwn: boolean;
}

export interface UiState {
  /** Compte Twitch connecté dans ce navigateur, s'il y en a un. */
  account: UiAccount | null;
  mode: Mode;
  channel: string | null;
  running: boolean;
  startedAt: number | null;
  stream: StreamInfo | null;
  context: string;
  stats: PipelineStats;
  rules: Rule[];
  ruleSet: RuleSet;
  ruleHits: Record<string, number>;
  recent: UiMessage[];
  queue: UiMessage[];
}

export type UiEvent =
  | { type: "state"; state: UiState }
  | { type: "message"; message: UiMessage }
  | { type: "stats"; stats: PipelineStats; ruleHits: Record<string, number> }
  | { type: "stream"; stream: StreamInfo | null; context: string }
  | { type: "rules"; ruleSet: RuleSet; context: string }
  | { type: "mode"; mode: Mode }
  | { type: "annotation"; id: string; annotation: "confirmed" | "dismissed" };

export function toUiMessage(m: ChatMessage): UiMessage {
  return { id: m.id, userName: m.userName, text: m.text, sentAt: m.sentAt };
}
