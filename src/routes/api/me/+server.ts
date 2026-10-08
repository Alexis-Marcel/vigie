import { json } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ cookies }) => {
  const a = currentAccount(cookies);
  if (a && !watcher.actor) watcher.setActor(a);
  return json(a ? { userId: a.userId, login: a.login, displayName: a.displayName, avatar: a.avatar } : null);
};
