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
}

export interface UiState {
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
  | { type: "annotation"; id: string; annotation: "confirmed" | "dismissed" };

export function toUiMessage(m: ChatMessage): UiMessage {
  return { id: m.id, userName: m.userName, text: m.text, sentAt: m.sentAt };
}
