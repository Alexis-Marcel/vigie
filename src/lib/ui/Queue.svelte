<script lang="ts">
  import { live } from "./live.svelte.js";
  import { time, pct } from "./format.js";

  const queue = $derived([...live.state.queue].reverse());
  const pending = $derived(queue.filter((m) => !m.annotation));
  const rules = $derived(Object.fromEntries(live.state.rules.map((r) => [r.id, r])));
</script>

<section>
  <h2>À vérifier <span class="count">{pending.length}</span></h2>
  <div class="scroll">
    {#if queue.length === 0}
      <p class="empty">Les messages que Vigie signalerait apparaîtront ici, avec la règle et sa certitude. Vous confirmez ou vous ignorez, et chaque réponse sert à mesurer Jev.</p>
    {/if}
    {#each queue as m (m.id)}
      {@const d = m.decision!}
      {@const rule = d.kind !== "pass" ? rules[d.ruleId] : null}
      <article class={d.kind} class:done={m.annotation}>
        <header>
          <span class="rule">{rule?.label ?? (d.kind !== "pass" ? d.ruleId : "")}</span>
          {#if d.kind !== "pass"}
            <span class="p">{pct(d.confidence)}</span>
            <span class="why">{d.kind === "delete" ? "supprimerait" : d.reason === "zone grise" ? "zone grise" : d.reason === "s'adresse au bot" ? "s'adresse au bot" : "à vérifier"}</span>
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
          {#if m.annotation === "confirmed"}
            <span class="verdict ok">Confirmé</span>
          {:else if m.annotation === "dismissed"}
            <span class="verdict">Ignoré</span>
          {:else}
            <button class="confirm" onclick={() => live.annotate(m.id, "confirmed")}>Confirmer</button>
            <button onclick={() => live.annotate(m.id, "dismissed")}>Ignorer</button>
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
    display: flex; justify-content: space-between;
  }
  .count { font-weight: 400; color: var(--text-3); }
  .scroll { overflow-y: auto; padding: 0 12px 12px; flex: 1; display: flex; flex-direction: column; gap: 10px; }
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
  button {
    border: 1px solid var(--line); background: var(--panel-2);
    border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 500;
  }
  button:hover { border-color: var(--text-3); }
  .confirm { border-color: var(--accent); color: var(--accent); background: color-mix(in oklab, var(--accent) 10%, transparent); }
  .verdict { font-size: 13px; color: var(--text-3); }
  .verdict.ok { color: var(--accent); }
</style>
