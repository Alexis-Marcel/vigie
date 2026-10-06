import { json } from "@sveltejs/kit";
import { watcher } from "#lib/server/watcher.ts";
export const POST = () => {
  watcher.halt();
  return json(watcher.state());
};
