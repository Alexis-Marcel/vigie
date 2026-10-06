import { json, error } from "@sveltejs/kit";
import { ZodError } from "zod";
import { watcher } from "#lib/server/watcher.ts";
import type { RequestHandler } from "./$types.js";

export const GET = () => json(watcher.getRules());

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) error(400, "Corps de requête invalide");
  try {
    return json(watcher.updateRules(body));
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const where = first.path.length ? `${first.path.join(".")} : ` : "";
      error(400, `${where}${first.message}`);
    }
    error(400, (e as Error).message);
  }
};
