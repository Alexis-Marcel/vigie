import { json, error } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const { id, verdict } = (await request.json()) as { id?: string; verdict?: "confirmed" | "dismissed" };
  if (!id || (verdict !== "confirmed" && verdict !== "dismissed")) error(400, "Requête invalide");
  if (!watcher.annotate(id, verdict)) error(404, "Message introuvable ou sans signalement");
  return json({ ok: true });
};
