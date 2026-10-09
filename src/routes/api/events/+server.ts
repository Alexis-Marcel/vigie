import { hub, subscribe, type Observation } from "#lib/server/hub.ts";
import { viewerOf } from "#lib/server/session.ts";
import type { UiEvent, UiState } from "#lib/ui/types.ts";
import type { RequestHandler } from "./$types.js";

function emptyState(viewer: { account: { userId: string; login: string; displayName: string; avatar: string } | null }): UiState {
  return {
    key: null,
    account: viewer.account ? { userId: viewer.account.userId, login: viewer.account.login, displayName: viewer.account.displayName, avatar: viewer.account.avatar } : null,
    canAct: false,
    mode: "observe",
    channel: null,
    running: false,
    startedAt: null,
    deadline: null,
    stoppedReason: null,
    stream: null,
    context: "",
    stats: { total: 0, prefiltered: 0, judged: 0, pass: 0, review: 0, delete: 0, errors: 0, cost: 0, latency: 0, p50: 0, p95: 0 },
    rules: [],
    ruleSet: { channel: "", context: "", reviewIfMentionsBot: true, rules: [] },
    ruleHits: {},
    recent: [],
    queue: [],
  };
}

/** Flux SSE d'une observation : son état complet à la connexion, puis chaque événement. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
  const viewer = viewerOf(cookies, locals);
  const key = url.searchParams.get("key");
  let o: Observation | null = key ? hub.get(key) : null;
  if (o && !(await hub.mayView(o, viewer))) o = null;
  const canAct = o ? await o.canAct(viewer.account) : false;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const detach = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
  };

  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          detach();
        }
      };
      const send = (ev: UiEvent) => write(`data: ${JSON.stringify(ev)}\n\n`);
      send({ type: "state", state: o ? o.state(viewer.account, canAct) : emptyState(viewer) });
      if (o) unsubscribe = subscribe(o.key, send);
      keepAlive = setInterval(() => write(": ping\n\n"), 20_000);
    },
    cancel: detach,
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
};
