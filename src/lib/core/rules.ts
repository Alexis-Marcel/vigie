import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { RuleSet } from "./types.js";

const schema = z.object({
  channel: z.string(),
  context: z.string().optional(),
  review_if_mentions_bot: z.boolean().default(true),
  rules: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]+$/, "id : lettres minuscules, chiffres, underscore"),
        label: z.string(),
        question: z.string().min(10),
        action: z.enum(["delete", "flag", "log"]).default("flag"),
        threshold: z.number().min(0.5).max(1).default(0.85),
      }),
    )
    .min(1),
});

export function loadRules(path: string): RuleSet {
  const parsed = schema.parse(parse(readFileSync(path, "utf8")));
  return {
    channel: parsed.channel,
    context: parsed.context ?? "",
    reviewIfMentionsBot: parsed.review_if_mentions_bot,
    rules: parsed.rules,
  };
}
