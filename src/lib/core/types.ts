export interface ChatMessage {
  id: string;
  channel: string;
  userId: string;
  userName: string;
  text: string;
  sentAt: number; // epoch ms
  isMod: boolean;
  isSub: boolean;
  /** Vrai si le message n'est composé que d'emotes Twitch (d'après le tag IRC `emotes`). */
  emoteOnly: boolean;
}

export type RuleAction = "delete" | "flag" | "log";

export interface Rule {
  id: string;
  label: string;
  question: string;
  action: RuleAction;
  threshold: number;
}

export interface RuleSet {
  channel: string;
  context: string;
  rules: Rule[];
  reviewIfMentionsBot: boolean;
}

/** Réponse d'un juge pour une règle : oui/non + confiance dans [0, 1]. */
export interface RuleVerdict {
  ruleId: string;
  triggered: boolean;
  confidence: number;
}

export interface Judgement {
  messageId: string;
  judge: string;
  verdicts: RuleVerdict[];
  latencyMs: number;
  inputTokens?: number;
  costUsd?: number;
}

export type Decision =
  | { kind: "pass" }
  | { kind: "review"; ruleId: string; confidence: number; reason: string }
  | { kind: "delete"; ruleId: string; confidence: number };
