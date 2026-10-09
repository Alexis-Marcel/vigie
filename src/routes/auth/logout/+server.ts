import { json } from "@sveltejs/kit";
import { hub, store } from "#lib/server/hub.ts";
import { COOKIE, currentAccount } from "#lib/server/session.ts";
import { revoke } from "#lib/server/twitch-auth.ts";
import type { RequestHandler } from "./$types.js";

/** Déconnexion : session supprimée, jeton révoqué chez Twitch, compte oublié, observations repassées en Observer. */
export const POST: RequestHandler = async ({ cookies }) => {
  const account = currentAccount(cookies);
  const id = cookies.get(COOKIE);
  if (id) store.deleteSession(id);
  cookies.delete(COOKIE, { path: "/" });
  if (account) {
    hub.dropActor(account.userId);
    await revoke(account);
    store.deleteAccount(account.userId);
  }
  return json({ ok: true });
};
