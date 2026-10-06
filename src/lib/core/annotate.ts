import { emitKeypressEvents } from "node:readline";
import { Store } from "./store.js";
import { loadRules } from "./rules.js";
import type { Rule } from "./types.js";

/**
 * Annotation à la main, au clavier, une touche par règle.
 * L'échantillon mélange tout ce que Jev a trouvé un peu suspect (proba ≥ 0,30)
 * et des messages pris au hasard parmi les autres, pour mesurer aussi ce qu'il rate.
 */
export async function annotate(opts: { channel: string; rulesPath: string; sample: number }) {
  const store = new Store();
  const rules = loadRules(opts.rulesPath);
  const keys = assignKeys(rules.rules);

  const all = store.judgedMessages(opts.channel).filter((m) => !store.isAnnotated(m.id));
  const suspicious = all.filter((m) => m.maxConfidence >= 0.3);
  const rest = shuffle(all.filter((m) => m.maxConfidence < 0.3));
  const sample = [...suspicious, ...rest].slice(0, opts.sample);
  sample.sort((a, b) => a.sentAt - b.sentAt);

  if (sample.length === 0) {
    console.log("Rien à annoter : tous les messages jugés sont déjà annotés, ou aucun rejeu n'a été fait.");
    store.close();
    return;
  }

  const nSusp = Math.min(suspicious.length, sample.length);
  console.log(`\n${sample.length} messages à annoter (${nSusp} suspects + ${sample.length - nSusp} au hasard).`);
  console.log(`Touches : ${rules.rules.map((r) => `[${keys[r.id]}] ${r.label}`).join("   ")}`);
  console.log(`Entrée = aucune règle · Retour arrière = annuler la sélection · x = passer · q = quitter\n`);

  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error("L'annotation se fait au clavier : lance la commande dans un vrai terminal.");
    store.close();
    process.exit(2);
  }
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  let done = 0;
  for (const m of sample) {
    const probs = store.judgementsFor(m.id);
    const probStr = rules.rules.map((r) => `${r.id}=${(probs[r.id] ?? 0).toFixed(2)}`).join("  ");
    const hour = new Date(m.sentAt).toLocaleTimeString("fr-FR");
    console.log(`\x1b[2m${hour}  ${probStr}\x1b[0m`);
    console.log(`\x1b[1m${m.userName}\x1b[0m: ${m.text}`);

    const result = await askRules(stdin, rules.rules, keys);
    if (result === "quit") break;
    if (result === "skip") {
      console.log("  → passé\n");
      continue;
    }
    const labels = Object.fromEntries(rules.rules.map((r) => [r.id, result.has(r.id)]));
    store.setAnnotations(m.id, labels);
    done++;
    const picked = rules.rules.filter((r) => result.has(r.id)).map((r) => r.label);
    console.log(`  → ${picked.length ? picked.join(", ") : "aucune"}\n`);
  }

  stdin.setRawMode(false);
  stdin.pause();
  store.close();
  console.log(`${done} messages annotés. Lance \`vigie stats ${opts.channel}\` pour les mesures.`);
}

function assignKeys(rules: Rule[]): Record<string, string> {
  const used = new Set(["x", "q"]);
  const keys: Record<string, string> = {};
  for (const r of rules) {
    const candidates = [...r.id.replace(/[^a-z]/g, ""), ..."abcdefghijklmnopqrstuvwxyz"];
    const k = candidates.find((c) => !used.has(c))!;
    used.add(k);
    keys[r.id] = k;
  }
  return keys;
}

function askRules(stdin: NodeJS.ReadStream, rules: Rule[], keys: Record<string, string>): Promise<Set<string> | "quit" | "skip"> {
  const byKey = Object.fromEntries(Object.entries(keys).map(([id, k]) => [k, id]));
  const selected = new Set<string>();
  const render = () => {
    const picked = rules.filter((r) => selected.has(r.id)).map((r) => r.label);
    process.stdout.write(`\r\x1b[K  sélection : ${picked.length ? picked.join(", ") : "(aucune)"} `);
  };
  render();
  return new Promise((resolve) => {
    const onKey = (_str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        stdin.setRawMode(false);
        process.exit(130);
      }
      const name = key.name ?? key.sequence ?? "";
      if (name === "return") {
        stdin.off("keypress", onKey);
        process.stdout.write("\r\x1b[K");
        resolve(selected);
      } else if (name === "q") {
        stdin.off("keypress", onKey);
        process.stdout.write("\r\x1b[K");
        resolve("quit");
      } else if (name === "x") {
        stdin.off("keypress", onKey);
        process.stdout.write("\r\x1b[K");
        resolve("skip");
      } else if (name === "backspace") {
        selected.clear();
        render();
      } else if (byKey[name]) {
        if (selected.has(byKey[name])) selected.delete(byKey[name]);
        else selected.add(byKey[name]);
        render();
      }
    };
    stdin.on("keypress", onKey);
  });
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
