<script lang="ts">
  import { live } from "./live.svelte.js";
  import { int, money } from "./format.js";

  const s = $derived(live.state);
  const st = $derived(s.stats);
  const latency = $derived(st.p50);
  const per10k = $derived(st.judged ? (st.cost / st.judged) * 10_000 : 0);
  const elapsed = $derived.by(() => {
    if (!s.startedAt) return null;
    const min = Math.round((Date.now() - s.startedAt) / 60_000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  });
  const actionLabel = { delete: "supprimer", flag: "vérifier", log: "noter" } as const;
  let { onEditRules }: { onEditRules: () => void } = $props();
</script>

<aside>
  <section>
    <h2>Bilan {#if elapsed}<span class="count">{elapsed}</span>{/if}</h2>
    <dl>
      <div><dt>Messages lus</dt><dd>{int(st.total)}</dd></div>
      <div><dt>Écartés avant Jev</dt><dd>{int(st.prefiltered)}</dd></div>
      <div><dt>Jugés par Jev</dt><dd>{int(st.judged)}</dd></div>
      <div class="sep"><dt>Laissés passer</dt><dd>{int(st.pass)}</dd></div>
      <div><dt class="review">À vérifier</dt><dd>{int(st.review)}</dd></div>
      <div><dt class="delete">{s.mode === "moderate" ? "Supprimés" : "Supprimerait"}</dt><dd>{int(st.delete)}</dd></div>
      <div class="sep"><dt>Latence médiane</dt><dd>{latency ? `${latency} ms` : "–"}</dd></div>
      <div><dt>Latence p95</dt><dd>{st.p95 ? `${st.p95} ms` : "–"}</dd></div>
      <div><dt>Coût</dt><dd>{st.judged ? money(st.cost) : "–"}</dd></div>
      <div><dt>Pour 10 000 messages</dt><dd>{st.judged ? money(per10k) : "–"}</dd></div>
      {#if st.errors}<div><dt class="delete">Erreurs</dt><dd>{int(st.errors)}</dd></div>{/if}
    </dl>
  </section>

  {#if s.stream}
    <section>
      <h2>Contexte envoyé à Jev</h2>
      <p class="ctx">{s.context}</p>
    </section>
  {/if}

  <section>
    <h2>Règles <button class="edit" onclick={onEditRules}>Modifier</button></h2>
    <ul class="rules">
      {#each s.rules as r (r.id)}
        <li>
          <span class="label">{r.label}</span>
          <span class="meta">
            <span class={r.action}>{actionLabel[r.action]}</span>
            <span>dès {Math.round(r.threshold * 100)} %</span>
          </span>
          {#if s.ruleHits[r.id]}<span class="hits">{s.ruleHits[r.id]}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if s.ruleSet.context}<p class="hint">{s.ruleSet.context}</p>{/if}
  </section>
</aside>

<style>
  aside { overflow-y: auto; min-height: 0; padding-bottom: 16px; }
  section + section { border-top: 1px solid var(--line); }
  h2 {
    margin: 0; padding: 14px 16px 10px;
    font-size: 13px; font-weight: 600; color: var(--text-2);
    display: flex; justify-content: space-between;
  }
  .count { font-weight: 400; color: var(--text-3); }
  dl { margin: 0; padding: 0 16px 14px; }
  dl div { display: flex; justify-content: space-between; padding: 3px 0; }
  dl div.sep { margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--line); }
  dt { color: var(--text-2); }
  dd { margin: 0; font-weight: 500; }
  .review { color: var(--review); }
  .delete { color: var(--delete); }
  .ctx { margin: 0; padding: 0 16px 14px; color: var(--text-2); font-size: 13px; line-height: 1.5; }
  .rules { list-style: none; margin: 0; padding: 0 16px; }
  .rules li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 6px 0; align-items: center; }
  .label { font-weight: 500; }
  .meta { grid-column: 1; display: flex; gap: 8px; font-size: 12px; color: var(--text-3); }
  .meta .delete { color: var(--delete); }
  .meta .flag { color: var(--review); }
  .meta .log { color: var(--text-3); }
  .hits {
    grid-column: 2; grid-row: 1 / span 2;
    background: var(--panel-2); border-radius: 999px; padding: 2px 9px; font-size: 12px; font-weight: 600;
  }
  .hint { margin: 10px 0 0; padding: 0 16px; font-size: 12px; color: var(--text-3); }
  .edit { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 2px 10px; font-size: 12px; color: var(--text-2); }
  .edit:hover { border-color: var(--accent); color: var(--accent); }
</style>
