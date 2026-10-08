import type { ChatMessage, Decision, Rule, RuleSet } from "#lib/core/types.ts";
import type { StreamInfo } from "#lib/core/sources/twitch-info.ts";
import type { PipelineStats } from "#lib/core/pipeline.ts";

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

export interface UiState {
  /** Compte Twitch connecté dans ce navigateur, s'il y en a un. */
  account: UiAccount | null;
  /** Suppression automatique des messages au-dessus du seuil d'une règle « supprimer ». */
  autoDelete: boolean;
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
  | { type: "mode"; autoDelete: boolean }
  | { type: "annotation"; id: string; annotation: "confirmed" | "dismissed" };

export function toUiMessage(m: ChatMessage): UiMessage {
  return { id: m.id, userName: m.userName, text: m.text, sentAt: m.sentAt };
}
