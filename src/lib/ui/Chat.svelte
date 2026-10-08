<script lang="ts">
  import { live } from "./live.svelte.js";
  import { time, top, gaugeColor } from "./format.js";
  import type { UiMessage } from "./types.js";
  import { tick } from "svelte";

  let el: HTMLElement;
  let pinned = $state(true);
  const msgs = $derived(live.state.recent);

  $effect(() => {
    msgs.length;
    if (pinned) tick().then(() => el?.scrollTo({ top: el.scrollHeight }));
  });

  function onScroll() {
    pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function gauge(m: UiMessage) {
    if (m.skipped) return { h: 0, color: "transparent", title: `écarté : ${m.skipped}` };
    const t = top(m);
    if (!t) return { h: 0, color: "transparent", title: "en attente de Jev" };
    const kind = m.decision?.kind;
    return { h: Math.max(6, Math.round(t.p * 100)), color: gaugeColor(t.p, kind), title: `${t.ruleId} ${Math.round(t.p * 100)} %` };
  }
</script>

<section>
  <h2>Chat <span class="count">{msgs.length}</span></h2>
  <div class="scroll" bind:this={el} onscroll={onScroll}>
    {#if msgs.length === 0}
      <p class="empty">
        {live.state.running ? "En attente des premiers messages." : "Entrez une chaîne pour commencer à lire son chat."}
      </p>
    {/if}
    {#each msgs as m (m.id)}
      {@const g = gauge(m)}
      <article class:skipped={m.skipped} class:flag={m.decision && m.decision.kind !== "pass"} class:deleted={m.action?.ok && m.action.kind !== "warn"}>
        <span class="gauge" title={g.title} aria-hidden="true">
          <span class="fill" style:height="{g.h}%" style:background={g.color}></span>
        </span>
        <span class="time">{time(m.sentAt)}</span>
        <span class="body"><b>{m.userName}</b> {m.text}</span>
      </article>
    {/each}
  </div>
  {#if !pinned}
    <button class="jump" onclick={() => { pinned = true; el.scrollTo({ top: el.scrollHeight }); }}>Revenir en bas</button>
  {/if}
</section>

<style>
  section { display: flex; flex-direction: column; min-height: 0; position: relative; }
  h2 {
    margin: 0; padding: 14px 16px 10px;
    font-size: 13px; font-weight: 600; color: var(--text-2);
    display: flex; justify-content: space-between;
  }
  .count { font-weight: 400; color: var(--text-3); }
  .scroll { overflow-y: auto; padding: 0 8px 12px; flex: 1; }
  .empty { color: var(--text-3); padding: 24px 12px; margin: 0; }
  article {
    display: grid;
    grid-template-columns: 5px 58px 1fr;
    gap: 10px;
    align-items: start;
    padding: 4px 6px;
    border-radius: 6px;
  }
  article.flag { background: color-mix(in oklab, var(--panel-2) 70%, transparent); }
  article.skipped { opacity: 0.45; }
  article.deleted .body { text-decoration: line-through; color: var(--text-3); }
  .gauge {
    position: relative; height: 18px; margin-top: 1px;
    background: color-mix(in oklab, var(--line) 60%, transparent);
    border-radius: 2px; overflow: hidden;
  }
  .fill {
    position: absolute; bottom: 0; left: 0; right: 0;
    border-radius: 2px;
    transition: height 300ms ease-out, background 300ms;
  }
  .time { color: var(--text-3); font-size: 12px; padding-top: 1px; }
  .body { overflow-wrap: anywhere; }
  b { font-weight: 600; color: var(--text-2); margin-right: 2px; }
  .jump {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: var(--panel-2); border: 1px solid var(--line); border-radius: 999px;
    padding: 6px 14px; font-size: 12px;
  }
</style>
