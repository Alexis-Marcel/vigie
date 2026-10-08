import { json, error } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

/** Interrupteur de suppression automatique. Demande un compte connecté. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const account = currentAccount(cookies);
  if (!account) error(401, "Connectez un compte Twitch");
  const { autoDelete } = (await request.json()) as { autoDelete?: boolean };
  watcher.setActor(account);
  try {
    watcher.setAutoDelete(!!autoDelete);
  } catch (e) {
    error(400, (e as Error).message);
  }
  return json({ autoDelete: watcher.autoDelete });
};
