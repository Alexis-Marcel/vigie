<script lang="ts">
  import { live } from "./live.svelte.js";
  import { int } from "./format.js";

  let channel = $state("");
  const s = $derived(live.state);
  $effect(() => {
    if (s.channel && !channel) channel = s.channel;
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (channel.trim()) live.watch(channel.trim());
  }
</script>

<header>
  <div class="brand">
    <span class="beacon" class:on={s.running && live.connected} aria-hidden="true"></span>
    <span class="name">Vigie</span>
  </div>

  <form onsubmit={submit}>
    <label class="field">
      <span class="at">twitch.tv/</span>
      <input
        bind:value={channel}
        placeholder="nom de la chaîne"
        spellcheck="false"
        autocomplete="off"
        disabled={live.busy}
      />
    </label>
    {#if s.running && s.channel === channel.trim().toLowerCase()}
      <button type="button" class="ghost" onclick={() => live.stop()}>Arrêter</button>
    {:else}
      <button type="submit" class="primary" disabled={live.busy || !channel.trim()}>
        {live.busy ? "Connexion" : s.running ? "Changer de chaîne" : "Observer"}
      </button>
    {/if}
  </form>

  <div class="status">
    {#if live.error}
      <span class="err">{live.error}</span>
    {:else if s.stream}
      {#if s.stream.live}
        <span class="live">en live</span>
        <span>{s.stream.game || "sans catégorie"}</span>
        <span class="muted">{int(s.stream.viewers)} spectateurs</span>
      {:else}
        <span class="muted">hors ligne, le chat reste lisible</span>
      {/if}
    {:else if !s.running}
      <span class="muted">Rien n'est supprimé. Vigie lit, juge et vous montre.</span>
    {/if}
  </div>
</header>

<style>
  header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .name { font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
  .beacon {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-3);
    transition: background 300ms, box-shadow 300ms;
  }
  .beacon.on {
    background: var(--accent);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 22%, transparent);
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent); }
    50% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--accent) 8%, transparent); }
  }
  form { display: flex; gap: 8px; max-width: 520px; }
  .field {
    flex: 1;
    display: flex; align-items: center;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0 12px;
    transition: border-color 150ms;
  }
  .field:focus-within { border-color: var(--accent); }
  .at { color: var(--text-3); }
  input {
    flex: 1; min-width: 0;
    background: none; border: 0; outline: 0;
    padding: 9px 0 9px 2px;
  }
  input::placeholder { color: var(--text-3); }
  button {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 9px 16px;
    font-weight: 500;
    background: var(--panel);
    transition: background 150ms, border-color 150ms;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:not(:disabled):hover { filter: brightness(1.08); }
  .ghost:hover { border-color: var(--text-3); }
  .status { display: flex; gap: 14px; align-items: center; justify-content: end; white-space: nowrap; }
  .live { color: var(--accent); font-weight: 600; }
  .muted { color: var(--text-2); }
  .err { color: var(--delete); }
  @media (max-width: 900px) {
    header { grid-template-columns: 1fr; gap: 12px; }
    .status { justify-content: start; white-space: normal; }
  }
</style>
