import { json, error } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
import { currentAccount } from "#lib/server/session.ts";
import { moderatedChannels } from "#lib/server/twitch-actions.ts";
import type { Mode } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

const MODES: Mode[] = ["observe", "assist", "moderate"];

/** Démarre (ou redémarre) l'observation d'une chaîne dans un mode donné. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = (await request.json()) as { channel?: string; mode?: Mode };
  const channel = body.channel?.replace(/^#/, "").toLowerCase();
  const mode = body.mode ?? "observe";
  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel)) error(400, "Nom de chaîne invalide");
  if (!MODES.includes(mode)) error(400, "Mode invalide");

  const account = currentAccount(cookies);
  if (mode !== "observe") {
    if (!account) error(401, "Connectez un compte Twitch modérateur pour assister ou modérer.");
    const allowed = await moderatedChannels(watcher.db, account);
    if (!allowed.some((c) => c.login === channel)) error(403, `${account.displayName} n'est pas modérateur de ${channel}.`);
    watcher.setActor(account);
  }

  try {
    if (mode === "observe" && watcher.mode !== "observe") watcher.setMode("observe");
    await watcher.start(channel);
    if (mode !== "observe") watcher.setMode(mode);
  } catch (e) {
    error(500, (e as Error).message);
  }
  return json(watcher.state(account));
};
