import { watcher } from "#lib/server/watcher.ts";
import { currentAccount } from "#lib/server/session.ts";
import type { UiEvent } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

/** Flux SSE : l'état complet à la connexion, puis chaque événement. */
export const GET: RequestHandler = ({ cookies }) => {
  const account = currentAccount(cookies);
  const encoder = new TextEncoder();
  let onEvent: ((ev: UiEvent) => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const detach = () => {
    if (onEvent) watcher.off("event", onEvent);
    if (keepAlive) clearInterval(keepAlive);
    onEvent = null;
    keepAlive = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      // Un navigateur parti sans prévenir laisse un contrôleur fermé : la première
      // écriture échoue, on se détache alors au lieu de faire échouer l'émetteur.
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          detach();
        }
      };
      const send = (ev: UiEvent) => write(`data: ${JSON.stringify(ev)}\n\n`);
      send({ type: "state", state: watcher.state(account) });
      onEvent = send;
      watcher.on("event", onEvent);
      keepAlive = setInterval(() => write(": ping\n\n"), 20_000);
    },
    cancel: detach,
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
};
