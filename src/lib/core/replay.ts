import { Store } from "./store.js";
import { loadRules } from "./rules.js";
import { Pipeline, formatEvent, formatStats } from "./pipeline.js";
import type { PipelineEvent } from "./pipeline.js";

export interface ReplayOptions {
  channel: string;
  rulesPath: string;
  limit?: number;
  context?: number;
  concurrency?: number;
}

export async function replay(opts: ReplayOptions) {
  const store = new Store();
  const rules = loadRules(opts.rulesPath);
  const pipeline = new Pipeline(rules, store, { contextSize: opts.context });
  const all = store.messages(opts.channel);
  const msgs = opts.limit ? all.slice(0, opts.limit) : all;

  // Le pipeline est séquentiel pour la fenêtre glissante, mais l'appel à Jev
  // peut être parallélisé : on prépare les événements et on limite la concurrence.
  const events: PipelineEvent[] = [];
  let lastCtx = "";
  const queue = msgs.map((m) => async () => {
    pipeline.setStreamInfo(store.contextAt(opts.channel, m.sentAt));
    const ctx = pipeline.currentContext();
    if (ctx !== lastCtx) {
      lastCtx = ctx;
      console.error(`[vigie] contexte : ${ctx.slice(0, 160)}${ctx.length > 160 ? "…" : ""}`);
    }
    events.push(await pipeline.handle(m));
  });
  await runPool(queue, opts.concurrency ?? 8);
  store.close();

  for (const ev of events.sort((a, b) => a.message.sentAt - b.message.sentAt)) {
    const line = formatEvent(ev, rules);
    if (line) console.log(line);
  }
  console.log("\n" + formatStats(pipeline.stats));
}

async function runPool(tasks: Array<() => Promise<void>>, size: number) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < tasks.length) await tasks[i++]();
    }),
  );
}
