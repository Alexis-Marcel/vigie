#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readTwitchChat } from "./lib/core/sources/twitch.js";
import { fetchStreamInfo } from "./lib/core/sources/twitch-info.js";
import { buildContext } from "./lib/core/context.js";
import { Store } from "./lib/core/store.js";
import { replay } from "./lib/core/replay.js";
import { watch } from "./lib/core/watch.js";
import { annotate } from "./lib/core/annotate.js";
import { stats } from "./lib/core/stats.js";

const [cmd, ...args] = process.argv.slice(2);

const usage = `vigie <commande>

  observe <chaine> [--minutes N]      lit le chat en direct, relève le contexte du live toutes les 5 min,
                                      enregistre tout dans data/vigie.sqlite (rien n'est supprimé)
  watch <chaine> [--minutes N] [--rules f]
                                      mode observateur en direct : enregistre, juge et affiche les signalements
                                      au fil de l'eau. Rien n'est supprimé.
  replay <chaine> [--rules f] [--limit N] [--context N]
                                      rejoue un chat enregistré contre les règles, affiche ce que Vigie aurait fait
  annotate <chaine> [--sample N]      annotation à la main d'un échantillon (défaut 300)
  stats <chaine>                      précision, rappel et faux positifs par règle, d'après les annotations
  info <chaine>                       affiche le contexte du live tel que Jev le recevra
`;

const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const channelArg = () => {
  const c = args[0]?.replace(/^#/, "").toLowerCase();
  if (!c || c.startsWith("--")) {
    console.error(`usage : vigie ${cmd} <chaine> …`);
    process.exit(2);
  }
  return c;
};

switch (cmd) {
  case "observe":
    observe(channelArg(), opt("minutes") ? Number(opt("minutes")) : undefined);
    break;
  case "watch":
    watch({
      channel: channelArg(),
      rulesPath: opt("rules") ?? defaultRulesPath(),
      minutes: opt("minutes") ? Number(opt("minutes")) : undefined,
      context: opt("context") ? Number(opt("context")) : undefined,
    });
    break;
  case "replay":
    runReplay(channelArg());
    break;
  case "annotate":
    annotate({ channel: channelArg(), rulesPath: opt("rules") ?? defaultRulesPath(), sample: Number(opt("sample") ?? 300) });
    break;
  case "stats":
    stats({ channel: channelArg(), rulesPath: opt("rules") ?? defaultRulesPath() });
    break;
  case "info": {
    const c = channelArg();
    fetchStreamInfo(c).then((i) => {
      console.log(i);
      console.log("\nContexte envoyé à Jev :\n" + buildContext(i, undefined));
    });
    break;
  }
  default:
    console.log(usage);
}

async function observe(channel: string, minutes?: number) {
  const store = new Store();
  const session = new Date().toISOString();
  let n = 0;

  const refreshContext = async () => {
    try {
      const info = await fetchStreamInfo(channel);
      store.insertContext(info);
      console.error(`[vigie] contexte : ${info.live ? "en live" : "hors ligne"} · ${info.game || "sans catégorie"} · « ${info.title} » · ${info.viewers} spectateurs`);
    } catch (e) {
      console.error(`[vigie] contexte indisponible : ${(e as Error).message}`);
    }
  };
  await refreshContext();
  const ctxTimer = setInterval(refreshContext, 5 * 60_000);

  const stop = readTwitchChat({
    channels: [channel],
    onStatus: (t) => console.error(`[vigie] ${t}`),
    onMessage: (m) => {
      store.insertMessage(m, session);
      n++;
      if (n % 100 === 0) console.error(`[vigie] ${n} messages enregistrés`);
    },
  });

  const finish = () => {
    clearInterval(ctxTimer);
    stop();
    store.close();
    console.error(`[vigie] terminé : ${n} messages enregistrés pour #${channel} (session ${session})`);
    process.exit(0);
  };
  process.on("SIGINT", finish);
  if (minutes) setTimeout(finish, minutes * 60_000);
}

async function runReplay(channel: string) {
  await replay({
    channel,
    rulesPath: opt("rules") ?? defaultRulesPath(),
    limit: opt("limit") ? Number(opt("limit")) : undefined,
    context: opt("context") ? Number(opt("context")) : undefined,
  });
}

/** `rules.yaml` s'il existe à côté (réglages locaux), sinon le jeu par défaut livré avec Vigie. */
function defaultRulesPath(): string {
  return existsSync("rules.yaml") ? "rules.yaml" : "rules.example.yaml";
}
