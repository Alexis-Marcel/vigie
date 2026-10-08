import { json } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
import { COOKIE, currentAccount } from "#lib/server/session.ts";
import { revoke } from "#lib/server/twitch-auth.ts";
import type { RequestHandler } from "./$types.js";

/** Déconnexion : session supprimée, jeton révoqué chez Twitch, compte oublié. */
export const POST: RequestHandler = async ({ cookies }) => {
  const account = currentAccount(cookies);
  const id = cookies.get(COOKIE);
  if (id) watcher.db.deleteSession(id);
  cookies.delete(COOKIE, { path: "/" });
  if (account) {
    await revoke(account);
    watcher.db.deleteAccount(account.userId);
    if (watcher.actor?.userId === account.userId) watcher.setActor(null);
  }
  return json({ ok: true });
};
