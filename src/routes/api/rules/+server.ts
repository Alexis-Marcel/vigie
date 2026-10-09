import { json, error } from "@sveltejs/kit";
import { ZodError } from "zod";
import { defaultRules } from "#lib/server/hub.ts";
import { viewerOf } from "#lib/server/session.ts";
import { observationFor } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types.js";

/** Règles d'une observation ; sans clé, le jeu par défaut. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const key = url.searchParams.get("key");
  if (!key) return json(defaultRules(""));
  const o = await observationFor(key, viewerOf(cookies, locals));
  return json(o.rules);
};

/** Modifie les règles d'une observation : un anonyme sa copie, un modérateur celles de sa chaîne. */
export const PUT: RequestHandler = async ({ request, url, cookies, locals }) => {
  const body = await request.json().catch(() => null);
  if (!body) error(400, "Corps de requête invalide");
  const o = await observationFor(url.searchParams.get("key"), viewerOf(cookies, locals));
  try {
    return json(o.updateRules(body));
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const where = first.path.length ? `${first.path.join(".")} : ` : "";
      error(400, `${where}${first.message}`);
    }
    error(400, (e as Error).message);
  }
};
