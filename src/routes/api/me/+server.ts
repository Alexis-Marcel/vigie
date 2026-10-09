import { json } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ cookies }) => {
  const a = currentAccount(cookies);
  return json(a ? { userId: a.userId, login: a.login, displayName: a.displayName, avatar: a.avatar } : null);
};
