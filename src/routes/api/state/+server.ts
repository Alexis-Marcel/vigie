import { json } from "@sveltejs/kit";
import { viewerOf } from "#lib/server/session.ts";
import { observationFor } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const viewer = viewerOf(cookies, locals);
  const o = await observationFor(url.searchParams.get("key"), viewer);
  return json(o.state(viewer.account, await o.canAct(viewer.account)));
};
