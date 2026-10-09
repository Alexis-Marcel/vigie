import { json, error } from "@sveltejs/kit";
import { viewerOf } from "#lib/server/session.ts";
import { observationFor, actingOn } from "#lib/server/api.ts";
import type { Mode } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

const MODES: Mode[] = ["observe", "assist", "moderate"];

/** Change le mode d'une observation. Assister et Modérer demandent d'en être modérateur. */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const { key, mode } = (await request.json()) as { key?: string; mode?: Mode };
  if (!mode || !MODES.includes(mode)) error(400, "Mode invalide");
  const viewer = viewerOf(cookies, locals);
  const o = mode === "observe" ? await observationFor(key ?? null, viewer) : await actingOn(key ?? null, viewer);
  if (mode !== "observe") o.setActor(viewer.account);
  try {
    o.setMode(mode);
  } catch (e) {
    error(400, (e as Error).message);
  }
  return json({ mode: o.mode });
};
