<script lang="ts">
  import { onMount } from "svelte";
  import { live } from "#lib/ui/live.svelte.ts";
  import Header from "#lib/ui/Header.svelte";
  import Chat from "#lib/ui/Chat.svelte";
  import Queue from "#lib/ui/Queue.svelte";
  import Summary from "#lib/ui/Summary.svelte";
  import RulesEditor from "#lib/ui/RulesEditor.svelte";

  let editing = $state(false);

  onMount(() => {
    void live.boot().then(() => live.loadDefaultRules());
    return () => live.disconnect();
  });
</script>

<div class="app">
  <Header />
  <main>
    <Chat />
    <Queue />
    <Summary onEditRules={() => (editing = true)} />
  </main>
  {#if editing}
    <RulesEditor onclose={() => (editing = false)} />
  {/if}
</div>

<style>
  .app { height: 100vh; display: flex; flex-direction: column; }
  main {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: minmax(320px, 1.1fr) minmax(320px, 1fr) 300px;
  }
  main > :global(*) { border-right: 1px solid var(--line); }
  main > :global(*:last-child) { border-right: 0; }
  @media (max-width: 1100px) {
    main { grid-template-columns: 1fr 1fr; }
    main > :global(aside) { grid-column: 1 / -1; border-top: 1px solid var(--line); }
  }
  @media (max-width: 720px) {
    .app { height: auto; }
    main { grid-template-columns: 1fr; }
    main > :global(*) { border-right: 0; border-top: 1px solid var(--line); max-height: 70vh; }
  }
</style>
