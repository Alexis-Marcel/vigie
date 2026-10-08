import { json, error } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import { watcher } from "#lib/server/watcher.ts";
import { moderatedChannels } from "#lib/server/twitch-actions.ts";
import type { RequestHandler } from "./$types.js";

/** Chaînes où le compte connecté peut agir. Vide sans compte. */
export const GET: RequestHandler = async ({ cookies }) => {
  const account = currentAccount(cookies);
  if (!account) return json([]);
  try {
    return json(await moderatedChannels(watcher.db, account));
  } catch (e) {
    error(502, (e as Error).message);
  }
};
