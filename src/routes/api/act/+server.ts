import { json, error } from "@sveltejs/kit";
import { viewerOf } from "#lib/server/session.ts";
import { actingOn } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types.js";

/** Action manuelle depuis la file, au nom du compte connecté. */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const { key, id, kind } = (await request.json()) as { key?: string; id?: string; kind?: "delete" | "timeout" | "warn" };
  if (!id || !kind || !["delete", "timeout", "warn"].includes(kind)) error(400, "Requête invalide");
  const viewer = viewerOf(cookies, locals);
  const o = await actingOn(key ?? null, viewer);
  try {
    return json(await o.act(id, kind, viewer.account!));
  } catch (e) {
    error(404, (e as Error).message);
  }
};
