import { json, error } from "@sveltejs/kit";
import { hub } from "#lib/server/hub.ts";
import { viewerOf } from "#lib/server/session.ts";
import { fail } from "#lib/server/api.ts";
import type { Mode } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

const MODES: Mode[] = ["observe", "assist", "moderate"];

/** Démarre (ou rejoint) l'observation d'une chaîne dans un mode donné. */
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const body = (await request.json()) as { channel?: string; mode?: Mode };
  const channel = body.channel?.replace(/^#/, "").toLowerCase();
  const mode = body.mode ?? "observe";
  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) error(400, "Nom de chaîne invalide");
  if (!MODES.includes(mode)) error(400, "Mode invalide");
  const viewer = viewerOf(cookies, locals);
  try {
    const o = await hub.start(channel, mode, viewer);
    return json(o.state(viewer.account, await o.canAct(viewer.account)));
  } catch (e) {
    fail(e);
  }
};
