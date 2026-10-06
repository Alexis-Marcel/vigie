import type { UiMessage } from "./types.js";

export const time = (ts: number) => new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const pct = (x: number) => `${Math.round(x * 100)} %`;
export const money = (usd: number) => (usd < 0.01 ? `${(usd * 100).toFixed(2)} ¢` : `${usd.toFixed(2)} $`);
export const int = (n: number) => n.toLocaleString("fr-FR");

/** Probabilité la plus forte d'un message, et la règle concernée. */
export function top(m: UiMessage): { ruleId: string; p: number } | null {
  if (!m.probs) return null;
  let best: { ruleId: string; p: number } | null = null;
  for (const [ruleId, p] of Object.entries(m.probs)) if (!best || p > best.p) best = { ruleId, p };
  return best;
}

/** Couleur de la jauge : du gris au-dessous de 0,3, ambre jusqu'au seuil de suppression, corail au-delà. */
export function gaugeColor(p: number, kind?: "pass" | "review" | "delete"): string {
  if (kind === "delete") return "var(--delete)";
  if (kind === "review") return "var(--review)";
  if (p < 0.3) return "var(--pass)";
  return `color-mix(in oklab, var(--pass), var(--review) ${Math.round(((p - 0.3) / 0.5) * 100)}%)`;
}
