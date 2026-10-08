import { json } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
import { currentAccount } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = ({ cookies }) => json(watcher.state(currentAccount(cookies)));
