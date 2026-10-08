import { json, error } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

/** Action manuelle depuis la file : suppression, timeout ou avertissement, au nom du compte connecté. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const account = currentAccount(cookies);
  if (!account) error(401, "Connectez un compte Twitch");
  const { id, kind } = (await request.json()) as { id?: string; kind?: "delete" | "timeout" | "warn" };
  if (!id || !kind || !["delete", "timeout", "warn"].includes(kind)) error(400, "Requête invalide");
  try {
    return json(await watcher.act(id, kind, account));
  } catch (e) {
    error(404, (e as Error).message);
  }
};
