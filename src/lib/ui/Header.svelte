<script lang="ts">
  import { live } from "./live.svelte.ts";
  import { int } from "./format.ts";
  import type { Mode } from "./types.ts";

  const s = $derived(live.state);
  let channel = $state("");
  let error = $state<string | null>(null);
  /** Connecté, on propose la liste de ses chaînes ; l'utilisateur peut repasser en champ libre pour observer n'importe qui. */
  let freeChannel = $state(false);
  let input: HTMLInputElement | undefined = $state();

  function useFreeChannel() {
    freeChannel = true;
    channel = "";
    queueMicrotask(() => input?.focus());
  }

  function useMyChannels() {
    freeChannel = false;
    if (!live.channels.some((c) => c.login === typed)) channel = live.channels[0]?.login ?? "";
  }

  function onSelect(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === "__free__") useFreeChannel();
    else channel = v;
  }

  // Le champ suit la chaîne en cours tant que l'utilisateur ne l'a pas modifié.
  $effect(() => {
    if (s.channel && !channel) channel = s.channel;
  });
  // Un compte connecté avec une seule chaîne possible : on la propose d'office.
  $effect(() => {
    if (!channel && live.channels.length === 1) channel = live.channels[0].login;
  });

  const modes: Array<{ id: Mode; label: string; needsAccount: boolean }> = [
    { id: "observe", label: "Observer", needsAccount: false },
    { id: "assist", label: "Assister", needsAccount: true },
    { id: "moderate", label: "Modérer", needsAccount: true },
  ];

  let pendingMode = $state<Mode | null>(null);

  const typed = $derived(channel.trim().toLowerCase().replace(/^#/, ""));
  const sameChannel = $derived(s.running && s.channel === typed);
  const allowed = $derived((m: Mode) => m === "observe" || (!!s.account && (!typed || live.channels.some((c) => c.login === typed))));

  const sentence = $derived.by(() => {
    const who = s.account?.displayName ?? "";
    if (!s.running) {
      if (!s.account) return "Observer lit n'importe quel chat sans y toucher. Assister et Modérer agissent sur Twitch et vous demanderont un compte modérateur.";
      return `Connecté comme ${who}. Observer ne touche à rien ; Assister et Modérer agissent sur vos chaînes.`;
    }
    const deleteThreshold = Math.min(...s.rules.filter((r) => r.action === "delete").map((r) => Math.round(r.threshold * 100)));
    const offline = s.stream && !s.stream.live ? ` ${s.channel} est hors ligne : le chat reste ouvert, mais il y aura peu de messages.` : "";
    if (s.mode === "observe") return `Vigie lit le chat de ${s.channel} et ne touche à rien. Elle montre ce qu'elle ferait.${offline}`;
    if (s.mode === "assist") return `Vigie signale, vous agissez au nom de ${who}. Rien n'est supprimé sans votre clic.${offline}`;
    return `Vigie supprime seule dès ${Number.isFinite(deleteThreshold) ? deleteThreshold : 90} % au nom de ${who}. Vous traitez la zone grise.${offline}`;
  });

  // Après la connexion Twitch, on reprend ce que l'utilisateur voulait faire.
  const RESUME = "vigie_resume";
  $effect(() => {
    if (!s.account || live.channels.length === 0) return;
    let saved: { channel: string; mode: Mode } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME) ?? "null");
      sessionStorage.removeItem(RESUME);
    } catch {
      /* rien à reprendre */
    }
    if (!saved) return;
    channel = live.channels.some((c) => c.login === saved!.channel) ? saved.channel : (live.channels[0]?.login ?? saved.channel);
    void choose(saved.mode);
  });

  async function choose(mode: Mode) {
    error = null;
    if (mode !== "observe" && !s.account) {
      // Assister et Modérer agissent sur Twitch : on passe par la connexion, puis on reprend ici.
      try {
        sessionStorage.setItem(RESUME, JSON.stringify({ channel: typed, mode }));
      } catch {
        /* sans stockage, l'utilisateur recliquera */
      }
      location.href = "/auth/twitch";
      return;
    }
    if (!typed) {
      error = "Choisissez d'abord une chaîne.";
      return;
    }
    if (mode !== "observe" && !live.channels.some((c) => c.login === typed)) {
      error = `${s.account!.displayName} n'est pas modérateur de ${typed}. Choisissez une de vos chaînes.`;
      return;
    }
    if (mode === "moderate" && s.mode !== "moderate") {
      const ok = confirm(`Vigie supprimera seule, au nom de ${s.account!.displayName}, les messages qui dépassent le seuil d'une règle « supprimer » sur ${typed}. Activer ?`);
      if (!ok) return;
    }
    pendingMode = mode;
    if (sameChannel) error = await live.setMode(mode);
    else await live.watch(typed, mode);
    if (live.error) error = live.error;
    pendingMode = null;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void choose(s.running ? s.mode : "observe");
  }

  async function stop() {
    await live.stop();
  }
</script>

<header>
  <div class="brand">
    <span class="beacon" class:on={s.running && live.connected} class:acting={s.running && s.mode !== "observe"} aria-hidden="true"></span>
    <span class="name">Vigie</span>
  </div>

  <form onsubmit={submit} class="controls">
    {#if s.account && live.channels.length > 0 && !freeChannel}
      <label class="field">
        <span class="at">twitch.tv/</span>
        <select value={live.channels.some((c) => c.login === typed) ? typed : "__other__"} onchange={onSelect} disabled={live.busy} aria-label="Chaîne">
          {#if typed && !live.channels.some((c) => c.login === typed)}
            <option value="__other__">{typed} (lecture seule)</option>
          {/if}
          {#each live.channels as c (c.login)}
            <option value={c.login}>{c.displayName}{c.isOwn ? " (ma chaîne)" : ""}</option>
          {/each}
          <option value="__free__">autre chaîne, en lecture seule…</option>
        </select>
      </label>
    {:else}
      <label class="field">
        <span class="at">twitch.tv/</span>
        <input bind:this={input} bind:value={channel} placeholder="nom de la chaîne" spellcheck="false" autocomplete="off" disabled={live.busy} />
        {#if s.account && live.channels.length > 0}
          <button type="button" class="link" onclick={useMyChannels}>mes chaînes</button>
        {/if}
      </label>
    {/if}

    <div class="modes" role="radiogroup" aria-label="Mode">
      {#each modes as m (m.id)}
        <button
          type="button"
          class={m.id}
          class:on={s.running && sameChannel && s.mode === m.id}
          class:locked={!allowed(m.id)}
          aria-checked={s.running && sameChannel && s.mode === m.id}
          role="radio"
          disabled={live.busy}
          title={m.needsAccount && !s.account ? "Demande un compte modérateur" : ""}
          onclick={() => choose(m.id)}
        >
          {pendingMode === m.id ? "…" : m.label}
        </button>
      {/each}
    </div>

    {#if s.running}
      <button type="button" class="ghost" onclick={stop}>Arrêter</button>
      {#if s.stream}
        <span class="livebadge" class:live={s.stream.live}>
          {#if s.stream.live}
            en live, {s.stream.game || "sans catégorie"}, {int(s.stream.viewers)} spectateurs
          {:else}
            hors ligne
          {/if}
        </span>
      {/if}
    {/if}
  </form>

  <p class="sentence" class:err={!!error}>
    {#if error}
      {error}
    {:else}
      {sentence}
    {/if}
  </p>

  {#if s.account}
    <div class="account">
      <img src={s.account.avatar} alt="" width="26" height="26" />
      <span class="who">{s.account.displayName}</span>
      <button type="button" class="link" onclick={() => live.logout()}>Déconnecter</button>
    </div>
  {:else}
    <div class="account none"></div>
  {/if}
</header>

<style>
  header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas: "brand controls account" "brand sentence account";
    align-items: center;
    column-gap: 24px;
    row-gap: 6px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .brand { grid-area: brand; display: flex; align-items: center; gap: 10px; }
  .name { font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
  .beacon {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-3);
    transition: background 300ms, box-shadow 300ms;
  }
  .beacon.on {
    background: var(--accent);
    animation: breathe 2.4s ease-in-out infinite;
  }
  .beacon.on.acting { background: var(--delete); --glow: var(--delete); }
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--glow, var(--accent)) 18%, transparent); }
    50% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--glow, var(--accent)) 8%, transparent); }
  }

  .controls { grid-area: controls; display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
  .field {
    display: flex; align-items: center;
    min-width: 260px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0 12px;
    transition: border-color 150ms;
  }
  .field:focus-within { border-color: var(--accent); }
  .at { color: var(--text-3); }
  input, select {
    flex: 1; min-width: 0;
    background: none; border: 0; outline: 0;
    padding: 9px 0 9px 2px;
  }
  select { cursor: pointer; }
  select option { background: var(--panel); }
  input::placeholder { color: var(--text-3); }

  .modes { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
  .modes button {
    border: 0; border-right: 1px solid var(--line);
    background: none; padding: 9px 16px;
    font-weight: 500; color: var(--text-2);
    transition: background 150ms, color 150ms;
  }
  .modes button:last-child { border-right: 0; }
  .modes button:hover:not(:disabled) { color: var(--text); background: var(--panel-2); }
  .modes button.locked { color: var(--text-3); }
  .modes button.on { color: var(--accent-ink); background: var(--accent); font-weight: 600; }
  .modes button.on.assist { background: var(--review); color: #1a1200; }
  .modes button.on.moderate { background: var(--delete); color: #1f0a08; }
  .modes button:disabled { opacity: 0.6; cursor: default; }

  .ghost {
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 9px 14px; font-weight: 500; background: var(--panel);
  }
  .ghost:hover { border-color: var(--text-3); }

  .sentence { grid-area: sentence; margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.4; }
  .sentence.err { color: var(--delete); }
  .livebadge {
    align-self: center; display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text-3); padding-left: 4px;
  }
  .livebadge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
  .livebadge.live { color: var(--text); }
  .livebadge.live::before { background: var(--delete); box-shadow: 0 0 0 3px color-mix(in oklab, var(--delete) 25%, transparent); }

  .account { grid-area: account; display: flex; align-items: center; gap: 10px; padding-left: 20px; border-left: 1px solid var(--line); align-self: stretch; }
  .account img { border-radius: 50%; }
  .who { font-weight: 500; }
  .account.none { display: none; }
  .link { background: none; border: 0; color: var(--text-3); font-size: 12px; padding: 0; }
  .link:hover { color: var(--text); }

  @media (max-width: 1000px) {
    header { grid-template-columns: 1fr; grid-template-areas: "brand" "controls" "sentence" "account"; }
    .account { padding-left: 0; border-left: 0; }
  }
</style>
