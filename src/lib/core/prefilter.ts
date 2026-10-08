import type { ChatMessage } from "./types.js";

/**
 * Filtre rapide, sans modèle : spam évident, liens, copier-coller.
 * Tout ce qui est attrapé ici n'est jamais envoyé au juge, ce qui protège
 * le plafond de requêtes et le budget.
 */
export type PrefilterResult = { skip: false } | { skip: true; reason: string };

const URL_RE = /https?:\/\/|www\.|\.(com|fr|gg|tv|net|org)\b/i;
/** Rires et interjections seuls : mdr, lol, jpp, haha, ptdr, xd, gg, oskour, et leurs étirements. */
const LAUGH_RE = /^(?:(?:m+d+r+|p+t+d+r+|l+o+l+|x+d+|j+p+p+|g+g+|o+s+k+o+u+r+|(?:a*h+a+)+|(?:b*a*h+a+)+|o+h+|a+h+|n+o+|w+o+w+|r+i+p+|f+)[\s!?.,:;]*)+$/i;

export function prefilter(msg: ChatMessage, recent: ChatMessage[]): PrefilterResult {
  const text = msg.text.trim();
  if (text.length < 3) return { skip: true, reason: "trop court" };
  if (msg.emoteOnly || /^[\p{Emoji}\s]+$/u.test(text)) return { skip: true, reason: "emotes seules" };
  if (LAUGH_RE.test(text)) return { skip: true, reason: "rire ou interjection" };
  if (/^[\s\p{P}\p{S}]+$/u.test(text)) return { skip: true, reason: "ponctuation seule" };
  if (URL_RE.test(text) && !msg.isMod) return { skip: true, reason: "lien" };
  const dup = recent.filter((m) => m.text === text).length;
  if (dup >= 3) return { skip: true, reason: "copier-coller répété" };
  return { skip: false };
}
