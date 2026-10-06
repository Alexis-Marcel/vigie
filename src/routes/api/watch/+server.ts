import { json, error } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

export const POST: RequestHandler = async ({ request }) => {
  const { channel } = (await request.json()) as { channel?: string };
  if (!channel || !/^[a-z0-9_]{3,25}$/i.test(channel.replace(/^#/, ""))) error(400, "Nom de chaîne invalide");
  try {
    await watcher.start(channel);
  } catch (e) {
    error(500, (e as Error).message);
  }
  return json(watcher.state());
};
