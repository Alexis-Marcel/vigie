import { json, error } from "@sveltejs/kit";
import { viewerOf } from "#lib/server/session.ts";
import { observationFor } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const { key, id, verdict } = (await request.json()) as { key?: string; id?: string; verdict?: "confirmed" | "dismissed" };
  if (!id || (verdict !== "confirmed" && verdict !== "dismissed")) error(400, "Requête invalide");
  const o = await observationFor(key ?? null, viewerOf(cookies, locals));
  if (!o.annotate(id, verdict)) error(404, "Message introuvable ou sans signalement");
  return json({ ok: true });
};
