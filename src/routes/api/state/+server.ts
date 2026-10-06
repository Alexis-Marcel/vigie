import { json } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
export const GET = () => json(watcher.state());
