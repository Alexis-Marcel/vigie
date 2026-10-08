<script lang="ts">
  /**
   * Champ libre avec recherche de chaînes Twitch : on tape, les chaînes
   * correspondantes apparaissent, en live d'abord. Sans résultat ou sans
   * identifiants d'application, le champ reste un simple champ texte.
   */
  interface Hit {
    login: string;
    displayName: string;
    avatar: string;
    isLive: boolean;
    game: string;
    title: string;
  }

  let { value = $bindable(""), disabled = false, onpick }: { value: string; disabled?: boolean; onpick?: (login: string) => void } = $props();

  let hits = $state<Hit[]>([]);
  let open = $state(false);
  let active = $state(-1);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastQuery = "";

  function onInput() {
    const q = value.trim();
    active = -1;
    if (timer) clearTimeout(timer);
    if (q.length < 2) {
      hits = [];
      open = false;
      return;
    }
    timer = setTimeout(async () => {
      lastQuery = q;
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const list = res.ok ? ((await res.json()) as Hit[]) : [];
      if (lastQuery !== q) return; // une frappe plus récente a pris le relais
      hits = list;
      open = list.length > 0;
    }, 220);
  }

  function pick(h: Hit) {
    value = h.login;
    open = false;
    hits = [];
    onpick?.(h.login);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % hits.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + hits.length) % hits.length;
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === "Escape") {
      open = false;
    }
  }

  function onBlur() {
    // Laisse le clic sur un résultat se produire avant de fermer.
    setTimeout(() => (open = false), 150);
  }
</script>

<div class="wrap">
  <input
    bind:value
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => (open = hits.length > 0)}
    onblur={onBlur}
    placeholder="nom de la chaîne"
    spellcheck="false"
    autocomplete="off"
    role="combobox"
    aria-expanded={open}
    aria-autocomplete="list"
    aria-controls="channel-hits"
    {disabled}
  />
  {#if open}
    <ul id="channel-hits" role="listbox">
      {#each hits as h, i (h.login)}
        <li role="option" aria-selected={i === active}>
          <button type="button" class:active={i === active} onmousedown={(e) => e.preventDefault()} onclick={() => pick(h)}>
            <img src={h.avatar} alt="" width="28" height="28" />
            <span class="name">{h.displayName}</span>
            {#if h.isLive}
              <span class="live">en live</span>
              <span class="game">{h.game}</span>
            {:else}
              <span class="off">hors ligne</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { position: relative; flex: 1; display: flex; min-width: 0; }
  input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; padding: 9px 0 9px 2px; }
  input::placeholder { color: var(--text-3); }
  ul {
    position: absolute; top: calc(100% + 6px); left: -13px; right: -13px; z-index: 5;
    list-style: none; margin: 0; padding: 6px;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.4);
  }
  li button {
    width: 100%; display: grid; grid-template-columns: 28px 1fr auto auto; gap: 10px; align-items: center;
    background: none; border: 0; border-radius: 8px; padding: 6px 8px; text-align: left; color: var(--text);
  }
  li button:hover, li button.active { background: var(--panel-2); }
  img { border-radius: 50%; }
  .name { font-weight: 500; }
  .live { color: var(--delete); font-size: 12px; font-weight: 600; }
  .game { color: var(--text-3); font-size: 12px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .off { grid-column: 3 / span 2; color: var(--text-3); font-size: 12px; }
</style>
