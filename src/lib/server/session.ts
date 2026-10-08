import type { Cookies } from "@sveltejs/kit";
import type { Account } from "#lib/core/store.ts";
import { watcher } from "./watcher.ts";

export const COOKIE = "vigie_session";

/** Compte Twitch associé au cookie de session de ce navigateur, s'il existe encore. */
export function currentAccount(cookies: Cookies): Account | null {
  const id = cookies.get(COOKIE);
  return id ? watcher.db.sessionAccount(id) : null;
}
