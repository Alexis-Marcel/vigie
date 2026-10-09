import { json } from "@sveltejs/kit";
import { hub } from "#lib/server/hub.ts";
import { viewerOf } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types.js";

/** Les observations que ce navigateur peut retrouver : les siennes, et celles des chaînes qu'il modère. */
export const GET: RequestHandler = async ({ cookies, locals }) => {
  const viewer = viewerOf(cookies, locals);
  const list = await hub.mine(viewer);
  return json(list.map((o) => ({ key: o.key, channel: o.channel, mode: o.mode, running: o.running, shared: o.key === o.channel })));
};
