import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { RuleSet } from "./types.js";

export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "id : lettres minuscules, chiffres, underscore"),
  label: z.string().min(1, "Le nom de la règle est vide"),
  question: z.string().min(10, "La question est trop courte"),
  action: z.enum(["delete", "flag", "log"]).default("flag"),
  threshold: z.number().min(0.5).max(1).default(0.85),
});

export const ruleSetSchema = z.object({
  channel: z.string().default(""),
  context: z.string().optional(),
  review_if_mentions_bot: z.boolean().default(true),
  rules: z.array(ruleSchema).min(1, "Il faut au moins une règle"),
});

/** Valide un objet brut (fichier YAML ou corps de requête) et le normalise. */
export function parseRuleSet(raw: unknown): RuleSet {
  const parsed = ruleSetSchema.parse(raw);
  const ids = new Set<string>();
  for (const r of parsed.rules) {
    if (ids.has(r.id)) throw new Error(`Deux règles portent l'identifiant « ${r.id} »`);
    ids.add(r.id);
  }
  return {
    channel: parsed.channel,
    context: parsed.context ?? "",
    reviewIfMentionsBot: parsed.review_if_mentions_bot,
    rules: parsed.rules,
  };
}

export function loadRules(path: string): RuleSet {
  return parseRuleSet(parse(readFileSync(path, "utf8")));
}

export function saveRules(path: string, rules: RuleSet): void {
  const doc = {
    channel: rules.channel,
    context: rules.context,
    review_if_mentions_bot: rules.reviewIfMentionsBot,
    rules: rules.rules.map((r) => ({ id: r.id, label: r.label, question: r.question, action: r.action, threshold: r.threshold })),
  };
  const header = "# Règles de la chaîne. Chaque règle devient une question oui/non posée au modèle.\n# Modifiable ici ou depuis l'interface.\n\n";
  writeFileSync(path, header + stringify(doc, { lineWidth: 100 }), "utf8");
}

/** Identifiant stable à partir d'un libellé : « Pas de spoilers ! » → pas_de_spoilers. */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "regle";
}
