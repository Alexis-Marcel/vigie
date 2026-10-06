import type { Decision, Judgement, RuleSet, ChatMessage } from "./types.js";

/**
 * Tentatives de manipulation du bot : on ne vise plus tout message qui parle des modos
 * (« W les modos » est un compliment), seulement ceux qui s'adressent au bot par son nom
 * ou qui ressemblent à une instruction glissée dans le message.
 */
const BOT_MENTION = /\bvigie\b|ignore[sz]? (les|tes|ces) (r[èe]gles|consignes|instructions)|ce message est (ok|valide|autoris[ée]|safe)|en tant qu(?:e |['’])(ia|bot|mod[ée]rateur)|nouvelle[s]? (r[èe]gle|consigne)s?\s*:/i;

/**
 * Transforme les probabilités en décision selon les seuils par règle.
 * Priorité : suppression > vérification > rien. Un message qui parle du bot
 * part toujours en vérification, même si aucune règle ne dépasse son seuil.
 */
export function decide(msg: ChatMessage, j: Judgement, rules: RuleSet): Decision {
  let best: Decision = { kind: "pass" };

  for (const v of j.verdicts) {
    const rule = rules.rules.find((r) => r.id === v.ruleId);
    if (!rule) continue;

    if (v.confidence >= rule.threshold) {
      if (rule.action === "delete") {
        if (best.kind !== "delete" || v.confidence > best.confidence) {
          best = { kind: "delete", ruleId: rule.id, confidence: v.confidence };
        }
      } else if (rule.action === "flag" && best.kind !== "delete") {
        if (best.kind !== "review" || v.confidence > best.confidence) {
          best = { kind: "review", ruleId: rule.id, confidence: v.confidence, reason: "au-dessus du seuil" };
        }
      }
      continue;
    }

    // Zone grise : à moins de 0,15 sous le seuil, on demande un avis humain.
    if (v.confidence >= rule.threshold - 0.15 && best.kind === "pass" && rule.action !== "log") {
      best = { kind: "review", ruleId: rule.id, confidence: v.confidence, reason: "zone grise" };
    }
  }

  if (best.kind === "pass" && rules.reviewIfMentionsBot && BOT_MENTION.test(msg.text)) {
    const top = [...j.verdicts].sort((a, b) => b.confidence - a.confidence)[0];
    best = { kind: "review", ruleId: top?.ruleId ?? "", confidence: top?.confidence ?? 0, reason: "s'adresse au bot" };
  }

  return best;
}
