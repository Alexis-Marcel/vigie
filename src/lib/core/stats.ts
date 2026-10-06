import { Store } from "./store.js";
import { loadRules } from "./rules.js";

/** Précision, rappel et faux positifs par règle, au seuil de la règle et à quelques seuils voisins. */
export function stats(opts: { channel: string; rulesPath: string }) {
  const store = new Store();
  const rules = loadRules(opts.rulesPath);
  const rows = store.annotatedWithJudgements(opts.channel);
  store.close();

  const nMessages = new Set(rows.map((r) => r.messageId)).size;
  if (nMessages === 0) {
    console.log("Aucune annotation. Lance d'abord `vigie annotate <chaine>`.");
    return;
  }
  console.log(`${nMessages} messages annotés sur #${opts.channel}\n`);

  for (const rule of rules.rules) {
    const rs = rows.filter((r) => r.ruleId === rule.id && r.confidence !== null);
    const positives = rs.filter((r) => r.label).length;
    console.log(`\x1b[1m${rule.label}\x1b[0m  (${rule.id}, seuil ${rule.threshold}, ${positives} vrais cas sur ${rs.length})`);
    const thresholds = [...new Set([0.5, 0.7, 0.8, rule.threshold, 0.9, 0.95])].sort();
    console.log("  seuil   préc.  rappel  VP  FP  FN");
    for (const t of thresholds) {
      let tp = 0, fp = 0, fn = 0;
      for (const r of rs) {
        const pred = (r.confidence ?? 0) >= t;
        if (pred && r.label) tp++;
        else if (pred && !r.label) fp++;
        else if (!pred && r.label) fn++;
      }
      const prec = tp + fp ? tp / (tp + fp) : NaN;
      const rec = tp + fn ? tp / (tp + fn) : NaN;
      const mark = t === rule.threshold ? "◀" : " ";
      console.log(`  ${t.toFixed(2)} ${mark}  ${pct(prec)}  ${pct(rec)}   ${String(tp).padStart(2)}  ${String(fp).padStart(2)}  ${String(fn).padStart(2)}`);
    }
    const fps = rs.filter((r) => !r.label && (r.confidence ?? 0) >= rule.threshold).slice(0, 5);
    const fns = rs.filter((r) => r.label && (r.confidence ?? 0) < rule.threshold).slice(0, 5);
    if (fps.length) console.log(`  faux positifs : ${fps.map((r) => `« ${r.text.slice(0, 50)} » (${r.confidence!.toFixed(2)})`).join(" · ")}`);
    if (fns.length) console.log(`  ratés         : ${fns.map((r) => `« ${r.text.slice(0, 50)} » (${r.confidence!.toFixed(2)})`).join(" · ")}`);
    console.log();
  }
}

function pct(x: number): string {
  return Number.isNaN(x) ? "   –  " : `${(x * 100).toFixed(0).padStart(4)} %`;
}
