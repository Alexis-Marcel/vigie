import { json } from "@sveltejs/kit";
import { hub, LIMITS } from "#lib/server/hub.ts";

/** Pour les sondes de santé et un coup d'œil rapide sur la charge. */
export const GET = () => {
  const running = [...hub.observations.values()].filter((o) => o.running).length;
  return json({ ok: true, running, maxConcurrent: LIMITS.maxConcurrent, budgetLeftUsd: Math.max(0, Math.round(hub.budgetLeft() * 100) / 100) });
};
