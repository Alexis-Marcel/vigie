import type { Cookies } from "@sveltejs/kit";
import type { Account } from "#lib/core/store.ts";
import { store, type Viewer } from "./hub.ts";

export const COOKIE = "vigie_session";

/** Compte Twitch associé au cookie de session de ce navigateur, s'il existe encore. */
export function currentAccount(cookies: Cookies): Account | null {
  const id = cookies.get(COOKIE);
  return id ? store.sessionAccount(id) : null;
}

export function viewerOf(cookies: Cookies, locals: App.Locals): Viewer {
  return { sid: locals.sid, account: currentAccount(cookies) };
}
