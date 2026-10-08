<script lang="ts">
  import { live } from "./live.svelte.ts";
  import { time, pct } from "./format.ts";
  import type { UiMessage } from "./types.ts";

  type Sort = "recent" | "confidence";
  let ruleFilter = $state<string | null>(null);
  let showHandled = $state(false);
  let sort = $state<Sort>("recent");
  // Masqués par le modérateur sans annotation (file trop longue, cas sans intérêt). Côté client seulement.
  let hidden = $state(new Set<string>());

  const rules = $derived(Object.fromEntries(live.state.rules.map((r) => [r.id, r])));
  const all = $derived(live.state.queue);
  const pending = $derived(all.filter((m) => !m.annotation && !hidden.has(m.id)));

  const countsByRule = $derived.by(() => {
    const c: Record<string, number> = {};
    for (const m of pending) if (m.decision?.kind !== "pass") c[m.decision!.ruleId] = (c[m.decision!.ruleId] ?? 0) + 1;
    return c;
  });

  const shown = $derived.by(() => {
    let list = showHandled ? all.filter((m) => !hidden.has(m.id)) : pending;
    if (ruleFilter) list = list.filter((m) => m.decision?.kind !== "pass" && m.decision!.ruleId === ruleFilter);
    list = [...list];
    if (sort === "confidence") list.sort((a, b) => conf(b) - conf(a) || b.sentAt - a.sentAt);
    else list.sort((a, b) => b.sentAt - a.sentAt);
    return list;
  });

  function conf(m: UiMessage) {
    return m.decision && m.decision.kind !== "pass" ? m.decision.confidence : 0;
  }

  function hideAllShown() {
    const next = new Set(hidden);
    for (const m of shown) if (!m.annotation) next.add(m.id);
    hidden = next;
  }

  function whyLabel(m: UiMessage) {
    const d = m.decision!;
    if (d.kind === "delete") return live.state.mode === "moderate" ? "suppression auto" : "supprimerait";
    if (d.kind === "review") {
      if (d.reason === "zone grise") return "zone grise";
      if (d.reason === "s'adresse au bot") return "s'adresse au bot";
      if (d.reason === "modérateur ou streamer") return "modérateur ou streamer, Twitch ne laisse pas supprimer";
      return "à vérifier";
    }
    return "";
  }

  const canAct = $derived(!!live.state.account && live.state.mode !== "observe");
  const title = $derived(live.state.mode === "observe" ? "À vérifier" : "À traiter");
  let actErrors = $state<Record<string, string>>({});
  async function act(m: UiMessage, kind: "delete" | "timeout" | "warn") {
    const err = await live.act(m.id, kind);
    if (err) actErrors[m.id] = err;
  }
  const actionLabel = { delete: "Supprimé", timeout: "Timeout 10 min", warn: "Averti" } as const;
</script>

<section>
  <h2>
    {title} <span class="count">{pending.length}</span>
    {#if shown.length > 0 && !showHandled}
      <button class="link" onclick={hideAllShown} title="Retire ces entrées de la file sans les annoter">Masquer {ruleFilter ? "ces" : "tout"}</button>
    {/if}
  </h2>

  {#if all.length > 0}
    <div class="bar">
      <div class="chips" role="group" aria-label="Filtrer par règle">
        <button class:on={ruleFilter === null} onclick={() => (ruleFilter = null)}>Toutes <span>{pending.length}</span></button>
        {#each live.state.rules as r (r.id)}
          {#if countsByRule[r.id] || ruleFilter === r.id}
            <button class:on={ruleFilter === r.id} class={r.action} onclick={() => (ruleFilter = ruleFilter === r.id ? null : r.id)}>
              {r.label} <span>{countsByRule[r.id] ?? 0}</span>
            </button>
          {/if}
        {/each}
      </div>
      <div class="opts">
        <label><input type="checkbox" bind:checked={showHandled} /> traités</label>
        <select bind:value={sort} aria-label="Tri">
          <option value="recent">plus récents</option>
          <option value="confidence">plus sûrs</option>
        </select>
      </div>
    </div>
  {/if}

  <div class="scroll">
    {#if all.length === 0}
      <p class="empty">Les messages que Vigie signale apparaîtront ici, avec la règle et sa certitude. Vous agissez si besoin, et vous dites si le signalement était juste ou à tort : chaque réponse sert à régler Jev.</p>
    {:else if shown.length === 0}
      <p class="empty">Rien en attente{ruleFilter ? ` pour « ${rules[ruleFilter]?.label} »` : ""}.</p>
    {/if}
    {#each shown as m (m.id)}
      {@const d = m.decision!}
      {@const rule = d.kind !== "pass" ? rules[d.ruleId] : null}
      <article class={d.kind} class:done={m.annotation}>
        <header>
          <span class="rule">{rule?.label ?? (d.kind !== "pass" ? d.ruleId : "")}</span>
          {#if d.kind !== "pass"}
            <span class="p">{pct(d.confidence)}</span>
            <span class="why">{whyLabel(m)}</span>
          {/if}
          <span class="time">{time(m.sentAt)}</span>
        </header>
        <p><b>{m.userName}</b> {m.text}</p>
        {#if m.probs}
          <ul class="probs">
            {#each Object.entries(m.probs).sort((a, b) => b[1] - a[1]).filter(([, p]) => p >= 0.15) as [id, p] (id)}
              <li><span>{rules[id]?.label ?? id}</span><span>{pct(p)}</span></li>
            {/each}
          </ul>
        {/if}
        <footer>
          {#if m.action?.ok}
            <span class="verdict acted">{actionLabel[m.action.kind]}{m.action.automatic ? " automatiquement" : ""}</span>
            {#if m.action.kind !== "timeout" && canAct}
              <button class="danger" onclick={() => act(m, "timeout")}>Timeout 10 min</button>
            {/if}
          {:else if canAct && !m.annotation}
            <button class="danger" onclick={() => act(m, "delete")}>Supprimer</button>
            <button class="danger" onclick={() => act(m, "timeout")}>Timeout 10 min</button>
          {/if}

          <span class="opinion" title="Votre avis sur le signalement de Vigie. Il ne touche pas à Twitch, il sert à mesurer et régler Jev.">
            <span class="q">Signalement</span>
            {#if m.annotation === "confirmed"}
              <span class="verdict ok">juste</span>
            {:else if m.annotation === "dismissed"}
              <span class="verdict">à tort</span>
            {:else}
              <button class="yes" onclick={() => live.annotate(m.id, "confirmed")}>Juste</button>
              <button onclick={() => live.annotate(m.id, "dismissed")}>À tort</button>
            {/if}
          </span>

          {#if m.action && !m.action.ok}
            <span class="acterr">{m.action.error}</span>
          {:else if actErrors[m.id]}
            <span class="acterr">{actErrors[m.id]}</span>
          {/if}
        </footer>
      </article>
    {/each}
  </div>
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; }
  h2 {
    margin: 0; padding: 14px 16px 10px;
    font-size: 13px; font-weight: 600; color: var(--text-2);
    display: flex; align-items: baseline; gap: 8px;
  }
  .count { font-weight: 400; color: var(--text-3); }
  .link { margin-left: auto; background: none; border: 0; color: var(--text-3); font-size: 12px; padding: 0; }
  .link:hover { color: var(--text); }
  .bar { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 10px; border-bottom: 1px solid var(--line); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button {
    background: none; border: 1px solid var(--line); border-radius: 999px;
    padding: 3px 10px; font-size: 12px; color: var(--text-2);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .chips button span { color: var(--text-3); font-weight: 500; }
  .chips button.on { background: var(--panel-2); color: var(--text); border-color: var(--text-3); }
  .chips button.on.delete { color: var(--delete); }
  .chips button.on.flag { color: var(--review); }
  .opts { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--text-3); }
  .opts label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .opts input { accent-color: var(--accent); margin: 0; }
  .opts select { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px; font-size: 12px; color: var(--text-2); }
  .scroll { overflow-y: auto; padding: 10px 12px 12px; flex: 1; display: flex; flex-direction: column; gap: 10px; }
  .empty { color: var(--text-3); padding: 24px 4px; margin: 0; max-width: 42ch; }
  article {
    background: var(--panel);
    border: 1px solid var(--line);
    border-left-width: 3px;
    border-radius: var(--radius);
    padding: 12px 14px;
    transition: opacity 200ms;
  }
  article.review { border-left-color: var(--review); }
  article.delete { border-left-color: var(--delete); }
  article.done { opacity: 0.55; }
  header { display: flex; gap: 10px; align-items: baseline; font-size: 13px; }
  .rule { font-weight: 600; }
  .review .rule { color: var(--review); }
  .delete .rule { color: var(--delete); }
  .p { color: var(--text); }
  .why { color: var(--text-3); }
  .time { margin-left: auto; color: var(--text-3); font-size: 12px; }
  p { margin: 8px 0 0; overflow-wrap: anywhere; }
  b { font-weight: 600; color: var(--text-2); margin-right: 2px; }
  .probs { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--text-3); }
  .probs li { display: flex; gap: 6px; }
  .probs li span:last-child { color: var(--text-2); }
  footer { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
  footer button {
    border: 1px solid var(--line); background: var(--panel-2);
    border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 500;
  }
  footer button:hover { border-color: var(--text-3); }
  .confirm { border-color: var(--accent); color: var(--accent); background: color-mix(in oklab, var(--accent) 10%, transparent); }
  .verdict { font-size: 13px; color: var(--text-3); }
  .verdict.ok { color: var(--accent); }
  .verdict.acted { color: var(--delete); font-weight: 600; }
  footer { flex-wrap: wrap; }
  .opinion { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
  .q { font-size: 12px; color: var(--text-3); margin-right: 2px; }
  .opinion button { padding: 4px 10px; font-size: 12px; color: var(--text-2); background: none; }
  .opinion .yes { border-color: color-mix(in oklab, var(--accent) 50%, var(--line)); color: var(--accent); }
  .opinion .yes:hover { background: color-mix(in oklab, var(--accent) 10%, transparent); }
  footer .danger { border-color: color-mix(in oklab, var(--delete) 50%, var(--line)); color: var(--delete); }
  footer .danger:hover { background: color-mix(in oklab, var(--delete) 12%, transparent); }
  .acterr { flex-basis: 100%; font-size: 12px; color: var(--delete); }
</style>
