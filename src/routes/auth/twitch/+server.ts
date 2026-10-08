import { redirect } from "@sveltejs/kit";
import { authorizeUrl } from "#lib/server/twitch-auth.ts";
import type { RequestHandler } from "./$types.js";

/** Départ de la connexion Twitch : on envoie l'utilisateur sur la page d'autorisation. */
export const GET: RequestHandler = ({ url, cookies }) => {
  const state = crypto.randomUUID();
  cookies.set("vigie_oauth_state", state, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 600 });
  redirect(302, authorizeUrl(`${url.origin}/auth/twitch/callback`, state), { external: true });
};
