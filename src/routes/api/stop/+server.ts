import { json } from "@sveltejs/kit";
import { hub } from "#lib/server/hub.ts";
import { viewerOf } from "#lib/server/session.ts";
import { observationFor } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const { key } = (await request.json().catch(() => ({}))) as { key?: string };
  const viewer = viewerOf(cookies, locals);
  const o = await observationFor(key ?? null, viewer);
  hub.stopObservation(o, null);
  return json({ ok: true });
};
