import { json, error } from "@sveltejs/kit";
import { fetchStreamInfo } from "#lib/core/sources/twitch-info.ts";
import type { RequestHandler } from "./$types.js";

export const GET: RequestHandler = async ({ url }) => {
  const channel = url.searchParams.get("channel");
  if (!channel) error(400, "channel manquant");
  try {
    return json(await fetchStreamInfo(channel));
  } catch (e) {
    error(404, (e as Error).message);
  }
};
