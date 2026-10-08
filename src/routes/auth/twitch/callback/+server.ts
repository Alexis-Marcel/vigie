import { redirect, error } from "@sveltejs/kit";
import { completeLogin } from "#lib/server/twitch-auth.ts";
import { watcher } from "#lib/server/watcher.ts";
import { COOKIE } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types.js";

/** Retour de Twitch après autorisation : échange du code, création de la session. */
export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) error(400, url.searchParams.get("error_description") ?? "Connexion refusée");
  if (!code || !state || state !== cookies.get("vigie_oauth_state")) error(400, "Réponse OAuth invalide, recommencez la connexion");
  cookies.delete("vigie_oauth_state", { path: "/" });

  const account = await completeLogin(watcher.db, code, `${url.origin}/auth/twitch/callback`);
  const session = watcher.db.createSession(account.userId);
  cookies.set(COOKIE, session, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 90 });
  watcher.setActor(account);
  redirect(302, "/");
};
