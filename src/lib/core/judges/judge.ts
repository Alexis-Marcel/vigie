import type { ChatMessage, Judgement, RuleSet } from "../types.js";

/**
 * Un juge prend un message et un jeu de règles, renvoie un verdict par règle.
 * Toutes les règles sont posées dans un seul appel : c'est ce qui rend
 * un modèle de décision (Jev, Laya) économique par rapport à un LLM.
 *
 * Implémentations prévues : jev.ts, laya.ts, llm.ts (référence), replay.ts (rejoue un enregistrement).
 */
export interface Judge {
  readonly name: string;
  judge(message: ChatMessage, rules: RuleSet, recent?: ChatMessage[]): Promise<Judgement>;
}
