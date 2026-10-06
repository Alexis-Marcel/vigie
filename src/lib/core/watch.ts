import { readTwitchChat } from "./sources/twitch.js";
import { fetchStreamInfo } from "./sources/twitch-info.js";
import { Store } from "./store.js";
import { loadRules } from "./rules.js";
import { Pipeline, formatEvent, formatStats } from "./pipeline.js";

/**
 * Mode observateur en direct : chaque message est enregistré, préfiltré, jugé
 * et décidé au fil de l'eau. Rien n'est supprimé : les décisions s'affichent
 * et sont stockées pour l'annotation et les stats.
 */
export async function watch(opts: { channel: string; rulesPath: string; minutes?: number; context?: number }) {
  const store = new Store();
  const rules = loadRules(opts.rulesPath);
  const pipeline = new Pipeline(rules, store, { contextSize: opts.context });
  const session = new Date().toISOString();
  const log = (t: string) => console.error(`\x1b[2m[vigie ${new Date().toLocaleTimeString("fr-FR")}]\x1b[0m ${t}`);

  const refreshContext = async () => {
    try {
      const info = await fetchStreamInfo(opts.channel);
      store.insertContext(info);
      pipeline.setStreamInfo(info);
      log(`contexte : ${info.live ? "en live" : "hors ligne"} · ${info.game || "sans catégorie"} · « ${info.title} » · ${info.viewers} spectateurs`);
    } catch (e) {
      log(`contexte indisponible : ${(e as Error).message}`);
    }
  };
  await refreshContext();
  const ctxTimer = setInterval(refreshContext, 5 * 60_000);
  const statsTimer = setInterval(() => log(formatStats(pipeline.stats).replace(/\n/g, " · ")), 10 * 60_000);

  let inFlight = 0;
  const stop = readTwitchChat({
    channels: [opts.channel],
    onStatus: log,
    onMessage: (m) => {
      store.insertMessage(m, session);
      inFlight++;
      pipeline
        .handle(m)
        .then((ev) => {
          const line = formatEvent(ev, rules);
          if (line) console.log(`\x1b[2m${new Date(m.sentAt).toLocaleTimeString("fr-FR")}\x1b[0m ${line}`);
        })
        .finally(() => inFlight--);
    },
  });

  const finish = async () => {
    clearInterval(ctxTimer);
    clearInterval(statsTimer);
    stop();
    // laisse finir les appels Jev en cours (au plus 10 s)
    const deadline = Date.now() + 10_000;
    while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    store.close();
    console.log("\n" + formatStats(pipeline.stats));
    log(`terminé (session ${session})`);
    process.exit(0);
  };
  process.on("SIGINT", finish);
  if (opts.minutes) setTimeout(finish, opts.minutes * 60_000);
}
