import { json, error } from "@sveltejs/kit";
import { currentAccount } from "#lib/server/session.ts";
import { watcher } from "#lib/server/watcher.ts";
import { moderatedChannels } from "#lib/server/twitch-actions.ts";
import type { Mode } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

const MODES: Mode[] = ["observe", "assist", "moderate"];

/** Change le mode de l'observation en cours. Assister et Modérer demandent un compte modérateur de la chaîne. */
export const POST: RequestHandler = async ({ request, cookies }) => {
  const { mode } = (await request.json()) as { mode?: Mode };
  if (!mode || !MODES.includes(mode)) error(400, "Mode invalide");
  if (mode !== "observe") {
    const account = currentAccount(cookies);
    if (!account) error(401, "Connectez un compte Twitch modérateur pour assister ou modérer.");
    if (watcher.channel) {
      const allowed = await moderatedChannels(watcher.db, account);
      if (!allowed.some((c) => c.login === watcher.channel)) error(403, `${account.displayName} n'est pas modérateur de ${watcher.channel}.`);
    }
    watcher.setActor(account);
  }
  try {
    watcher.setMode(mode);
  } catch (e) {
    error(400, (e as Error).message);
  }
  return json({ mode: watcher.mode });
};
