import { json } from "@sveltejs/kit";
import { searchChannels } from "#lib/core/sources/twitch-info.ts";
import type { RequestHandler } from "./$types.js";

/** Recherche de chaînes Twitch par nom. Renvoie une liste vide sans identifiants d'application. */
export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get("q") ?? "";
  try {
    return json(await searchChannels(q));
  } catch {
    return json([]);
  }
};
