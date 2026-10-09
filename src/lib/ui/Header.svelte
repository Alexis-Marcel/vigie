<script lang="ts">
  import { live } from "./live.svelte.ts";
  import { int } from "./format.ts";
  import type { Mode } from "./types.ts";
  import ChannelSearch from "./ChannelSearch.svelte";

  const s = $derived(live.state);

  /** Mode choisi dans le sélecteur. Il suit le mode réel quand une observation tourne. */
  let selected = $state<Mode>("observe");
  /** Chaîne du champ libre (Observer). */
  let typedChannel = $state("");
  /** Chaîne choisie dans la liste (Assister, Modérer). */
  let pickedChannel = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  const modes: Array<{ id: Mode; label: string; verb: string }> = [
    { id: "observe", label: "Observer", verb: "Observer" },
    { id: "assist", label: "Assister", verb: "Assister" },
    { id: "moderate", label: "Modérer", verb: "Modérer" },
  ];

  $effect(() => {
    if (s.running) selected = s.mode;
  });
  // Le champ libre reprend la chaîne en cours une seule fois, à l'arrivée de l'état ; ensuite il appartient à l'utilisateur.
  let seeded = false;
  $effect(() => {
    if (!seeded && s.channel) {
      seeded = true;
      if (s.mode === "observe") typedChannel = s.channel;
    }
  });
  // Dès que la liste des chaînes arrive, on propose la première (sa propre chaîne) si rien n'est choisi.
  $effect(() => {
    if (live.channels.length > 0 && !live.channels.some((c) => c.login === pickedChannel)) {
      pickedChannel = s.channel && live.channels.some((c) => c.login === s.channel) ? s.channel : live.channels[0].login;
    }
  });

  const channel = $derived(selected === "observe" ? typedChannel.trim().toLowerCase().replace(/^#/, "") : pickedChannel);
  const isCurrent = $derived(s.running && s.channel === channel && s.mode === selected);
  const verb = $derived(modes.find((m) => m.id === selected)!.verb);

  // Retour de la connexion Twitch : on remet le mode voulu, l'utilisateur confirme la chaîne et démarre.
  const RESUME = "vigie_resume";
  $effect(() => {
    if (!s.account) return;
    try {
      const saved = sessionStorage.getItem(RESUME);
      if (saved) {
        sessionStorage.removeItem(RESUME);
        const mode = JSON.parse(saved) as Mode;
        if (mode === "assist" || mode === "moderate") selected = mode;
      }
    } catch {
      /* rien à reprendre */
    }
  });

  function pickMode(mode: Mode) {
    error = null;
    if (mode !== "observe" && !s.account) {
      try {
        sessionStorage.setItem(RESUME, JSON.stringify(mode));
      } catch {
        /* sans stockage, l'utilisateur recliquera */
      }
      location.href = "/auth/twitch";
      return;
    }
    selected = mode;
  }

  async function start() {
    error = null;
    if (!channel) {
      error = selected === "observe" ? "Entrez le nom d'une chaîne." : "Choisissez une de vos chaînes.";
      return;
    }
    if (selected === "moderate" && !(s.running && s.mode === "moderate" && s.channel === channel)) {
      const ok = confirm(`Vigie supprimera seule, au nom de ${s.account?.displayName}, les messages qui dépassent le seuil d'une règle « supprimer » sur ${channel}. Activer ?`);
      if (!ok) return;
    }
    busy = true;
    if (s.running && s.channel === channel) error = await live.setMode(selected);
    else {
      await live.watch(channel, selected);
      error = live.error;
    }
    busy = false;
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    void start();
  }

  const sentence = $derived.by(() => {
    const who = s.account?.displayName ?? "";
    if (!s.running) {
      if (s.stoppedReason) return `Observation de ${s.channel} arrêtée : ${s.stoppedReason}`;
      if (selected === "observe") return "Observer lit le chat de n'importe quelle chaîne, sans y toucher, et montre ce que Vigie ferait.";
      if (selected === "assist") return `Assister : Vigie signale, vous agissez au nom de ${who} depuis la file. Rien n'est supprimé sans votre clic.`;
      return `Modérer : Vigie supprime seule au-dessus des seuils au nom de ${who}. Vous traitez la zone grise.`;
    }
    const deleteThreshold = Math.min(...s.rules.filter((r) => r.action === "delete").map((r) => Math.round(r.threshold * 100)));
    const offline = s.stream && !s.stream.live ? ` ${s.channel} est hors ligne : le chat reste ouvert, mais il y aura peu de messages.` : "";
    if (s.mode === "observe") return `Vigie lit le chat de ${s.channel} et ne touche à rien. Elle montre ce qu'elle ferait.${offline}`;
    if (s.mode === "assist") return `Vigie signale sur ${s.channel}, vous agissez au nom de ${who}. Rien n'est supprimé sans votre clic.${offline}`;
    return `Vigie supprime seule sur ${s.channel} dès ${Number.isFinite(deleteThreshold) ? deleteThreshold : 90} % au nom de ${who}. Vous traitez la zone grise.${offline}`;
  });
</script>

<header>
  <div class="brand">
    <span class="beacon" class:on={s.running && live.connected} class:acting={s.running && s.mode !== "observe"} aria-hidden="true"></span>
    <span class="name">Vigie</span>
  </div>

  <form onsubmit={submit} class="controls">
    <div class="modes" role="radiogroup" aria-label="Mode">
      {#each modes as m (m.id)}
        <button
          type="button"
          class={m.id}
          class:on={selected === m.id}
          class:running={s.running && s.mode === m.id}
          role="radio"
          aria-checked={selected === m.id}
          disabled={busy}
          onclick={() => pickMode(m.id)}
        >
          {m.label}
        </button>
      {/each}
    </div>

    {#if selected === "observe"}
      <label class="field">
        <span class="at">twitch.tv/</span>
        <ChannelSearch bind:value={typedChannel} disabled={busy} />
      </label>
    {:else}
      <label class="field">
        <span class="at">twitch.tv/</span>
        {#if live.channels.length === 0}
          <span class="loading">chargement de vos chaînes…</span>
        {:else}
          <select bind:value={pickedChannel} disabled={busy} aria-label="Chaîne">
            {#each live.channels as c (c.login)}
              <option value={c.login}>{c.displayName}{c.isOwn ? " (ma chaîne)" : ""}</option>
            {/each}
          </select>
        {/if}
      </label>
    {/if}

    {#if isCurrent}
      <button type="button" class="ghost" onclick={() => live.stop()}>Arrêter</button>
    {:else}
      <button type="submit" class="go {selected}" disabled={busy || !channel}>
        {busy ? "Connexion…" : `${verb} ${channel || "…"}`}
      </button>
      {#if s.running}
        <button type="button" class="ghost" onclick={() => live.stop()}>Arrêter</button>
      {/if}
    {/if}

    {#if s.running && s.stream}
      <span class="livebadge" class:live={s.stream.live}>
        {#if s.stream.live}
          en live, {s.stream.game || "sans catégorie"}, {int(s.stream.viewers)} spectateurs
        {:else}
          hors ligne
        {/if}
      </span>
    {/if}
  </form>

  <p class="sentence" class:err={!!error}>{error ?? sentence}</p>

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
  .beacon.on { background: var(--accent); animation: breathe 2.4s ease-in-out infinite; }
  .beacon.on.acting { background: var(--delete); --glow: var(--delete); }
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 0 3px color-mix(in oklab, var(--glow, var(--accent)) 18%, transparent); }
    50% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--glow, var(--accent)) 8%, transparent); }
  }

  .controls { grid-area: controls; display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }

  .modes { display: inline-flex; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
  .modes button {
    border: 0; border-right: 1px solid var(--line);
    background: none; padding: 9px 16px;
    font-weight: 500; color: var(--text-2);
    transition: background 150ms, color 150ms;
  }
  .modes button:last-child { border-right: 0; }
  .modes button:hover:not(:disabled) { color: var(--text); background: var(--panel-2); }
  .modes button.on { color: var(--text); background: var(--panel-2); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
  .modes button.on.assist { box-shadow: inset 0 -2px 0 var(--review); }
  .modes button.on.moderate { box-shadow: inset 0 -2px 0 var(--delete); }
  .modes button:disabled { opacity: 0.6; cursor: default; }

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
  select { flex: 1; min-width: 0; background: none; border: 0; outline: 0; padding: 9px 0 9px 2px; cursor: pointer; }
  select option { background: var(--panel); }
  .loading { color: var(--text-3); padding: 9px 0; }

  .go, .ghost {
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 9px 16px; font-weight: 500; background: var(--panel);
    transition: filter 150ms, border-color 150ms;
  }
  .go { font-weight: 600; }
  .go.observe { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .go.assist { background: var(--review); color: #1a1200; border-color: var(--review); }
  .go.moderate { background: var(--delete); color: #1f0a08; border-color: var(--delete); }
  .go:not(:disabled):hover { filter: brightness(1.08); }
  .go:disabled { opacity: 0.5; cursor: default; }
  .ghost:hover { border-color: var(--text-3); }

  .livebadge {
    align-self: center; display: inline-flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text-3); padding-left: 4px;
  }
  .livebadge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
  .livebadge.live { color: var(--text); }
  .livebadge.live::before { background: var(--delete); box-shadow: 0 0 0 3px color-mix(in oklab, var(--delete) 25%, transparent); }

  .sentence { grid-area: sentence; margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.4; }
  .sentence.err { color: var(--delete); }

  .account { grid-area: account; display: flex; align-items: center; gap: 10px; padding-left: 20px; border-left: 1px solid var(--line); align-self: stretch; }
  .account.none { display: none; }
  .account img { border-radius: 50%; }
  .who { font-weight: 500; }
  .link { background: none; border: 0; color: var(--text-3); font-size: 12px; padding: 0; }
  .link:hover { color: var(--text); }

  @media (max-width: 1000px) {
    header { grid-template-columns: 1fr; grid-template-areas: "brand" "controls" "sentence" "account"; }
    .account { padding-left: 0; border-left: 0; }
  }
</style>
