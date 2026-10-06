<script lang="ts">
  import { live } from "./live.svelte.ts";
  import type { Rule, RuleSet } from "#lib/core/types.ts";

  let { onclose }: { onclose: () => void } = $props();

  // Copie de travail : on n'écrit dans l'état partagé qu'après enregistrement.
  let draft = $state<RuleSet>(structuredClone($state.snapshot(live.state.ruleSet)));
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);

  const actions = [
    { value: "delete", label: "Supprimer", hint: "si Vigie est sûre au-delà du seuil" },
    { value: "flag", label: "Vérifier", hint: "mettre dans la file, un humain tranche" },
    { value: "log", label: "Noter", hint: "compter sans rien signaler" },
  ] as const;

  function slug(label: string) {
    return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "regle";
  }

  function addRule() {
    const base = "nouvelle_regle";
    let id = base, n = 2;
    while (draft.rules.some((r) => r.id === id)) id = `${base}_${n++}`;
    draft.rules.push({ id, label: "", question: "", action: "flag", threshold: 0.85 });
  }

  function removeRule(i: number) {
    draft.rules.splice(i, 1);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= draft.rules.length) return;
    [draft.rules[i], draft.rules[j]] = [draft.rules[j], draft.rules[i]];
  }

  function onLabelBlur(r: Rule) {
    // L'identifiant suit le libellé tant que la règle n'a pas encore de verdicts (nouvelle règle).
    if (r.id.startsWith("nouvelle_regle") && r.label.trim()) {
      let id = slug(r.label), n = 2;
      while (draft.rules.some((o) => o !== r && o.id === id)) id = `${slug(r.label)}_${n++}`;
      r.id = id;
    }
  }

  async function save() {
    saving = true;
    error = null;
    saved = false;
    error = await live.saveRules($state.snapshot(draft));
    saving = false;
    if (!error) {
      saved = true;
      setTimeout(() => (saved = false), 1800);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="scrim" onclick={onclose} role="presentation"></div>
<div class="drawer" role="dialog" aria-label="Règles de modération" aria-modal="true">
  <header>
    <h2>Règles</h2>
    <button class="close" onclick={onclose} aria-label="Fermer">✕</button>
  </header>

  <div class="body">
    <p class="lead">
      Chaque règle est une question posée à Jev pour chaque message. Elle répond par une probabilité,
      et le seuil décide à partir de quand l'action s'applique. Les formulations précises donnent de meilleurs résultats.
    </p>

    <label class="block">
      <span>Contexte de la chaîne</span>
      <textarea bind:value={draft.context} rows="2" placeholder="Ce que Jev doit savoir sur ce live, en plus du titre et de la catégorie détectés. Ex. : mes amis Mathy et Tsuna jouent avec moi."></textarea>
    </label>

    <label class="check">
      <input type="checkbox" bind:checked={draft.reviewIfMentionsBot} />
      <span>Envoyer en vérification tout message qui parle du bot ou de la modération, même si aucune règle ne réagit</span>
    </label>

    <ol>
      {#each draft.rules as r, i (r.id)}
        <li>
          <div class="row">
            <input class="label" bind:value={r.label} placeholder="Nom de la règle" onblur={() => onLabelBlur(r)} />
            <span class="tools">
              <button onclick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
              <button onclick={() => move(i, 1)} disabled={i === draft.rules.length - 1} aria-label="Descendre">↓</button>
              <button class="danger" onclick={() => removeRule(i)} aria-label="Supprimer la règle">Retirer</button>
            </span>
          </div>
          <textarea bind:value={r.question} rows="3" placeholder="La question posée à Jev. Ex. : Ce message pose-t-il une question sur la vie privée du streamer ?"></textarea>
          <div class="row settings">
            <span class="actions" role="radiogroup" aria-label="Action">
              {#each actions as a (a.value)}
                <label class:on={r.action === a.value} class={a.value} title={a.hint}>
                  <input type="radio" name="action-{r.id}" value={a.value} bind:group={r.action} />
                  {a.label}
                </label>
              {/each}
            </span>
            <label class="threshold">
              <span>dès <b>{Math.round(r.threshold * 100)} %</b></span>
              <input type="range" min="50" max="99" step="1" value={Math.round(r.threshold * 100)} oninput={(e) => (r.threshold = Number(e.currentTarget.value) / 100)} />
            </label>
          </div>
        </li>
      {/each}
    </ol>

    <button class="add" onclick={addRule}>Ajouter une règle</button>
  </div>

  <footer>
    {#if error}<span class="err">{error}</span>{:else if saved}<span class="ok">Enregistré, appliqué au live en cours</span>{/if}
    <button class="ghost" onclick={onclose}>Fermer</button>
    <button class="primary" onclick={save} disabled={saving}>{saving ? "Enregistrement" : "Enregistrer"}</button>
  </footer>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 0.45); z-index: 10; }
  .drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 11;
    width: min(640px, 100vw);
    background: var(--bg);
    border-left: 1px solid var(--line);
    display: flex; flex-direction: column;
    box-shadow: -24px 0 48px rgb(0 0 0 / 0.35);
  }
  header, footer { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  header { border-bottom: 1px solid var(--line); }
  footer { border-top: 1px solid var(--line); justify-content: flex-end; }
  h2 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
  .close { background: none; border: 0; color: var(--text-2); font-size: 16px; padding: 4px 8px; }
  .body { overflow-y: auto; padding: 16px 20px; flex: 1; }
  .lead { margin: 0 0 16px; color: var(--text-2); max-width: 62ch; line-height: 1.5; }
  .block { display: block; margin-bottom: 12px; }
  .block > span { display: block; font-weight: 500; margin-bottom: 6px; }
  .check { display: flex; gap: 10px; align-items: flex-start; color: var(--text-2); margin-bottom: 20px; line-height: 1.4; }
  .check input { margin-top: 3px; accent-color: var(--accent); }
  textarea, input.label {
    width: 100%;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 10px; resize: vertical; line-height: 1.4;
  }
  textarea:focus, input.label:focus { outline: 0; border-color: var(--accent); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
  li { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  li textarea, li input.label { background: var(--bg); }
  .row { display: flex; gap: 8px; align-items: center; }
  input.label { font-weight: 600; }
  .tools { display: flex; gap: 4px; }
  .tools button { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; color: var(--text-2); font-size: 12px; }
  .tools button:disabled { opacity: 0.35; cursor: default; }
  .tools .danger:hover { border-color: var(--delete); color: var(--delete); }
  .settings { justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  .actions { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .actions label { padding: 6px 12px; cursor: pointer; font-size: 13px; color: var(--text-2); border-right: 1px solid var(--line); }
  .actions label:last-child { border-right: 0; }
  .actions input { position: absolute; opacity: 0; pointer-events: none; }
  .actions label.on { color: var(--text); background: var(--panel-2); font-weight: 600; }
  .actions label.on.delete { color: var(--delete); }
  .actions label.on.flag { color: var(--review); }
  .threshold { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); }
  .threshold b { color: var(--text); font-weight: 600; }
  .threshold input { width: 150px; accent-color: var(--accent); }
  .add { margin-top: 14px; width: 100%; background: none; border: 1px dashed var(--line); border-radius: var(--radius); padding: 10px; color: var(--text-2); }
  .add:hover { border-color: var(--text-3); color: var(--text); }
  footer button { border: 1px solid var(--line); border-radius: 8px; padding: 8px 16px; font-weight: 500; background: var(--panel); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:disabled { opacity: 0.6; }
  .err { color: var(--delete); margin-right: auto; font-size: 13px; }
  .ok { color: var(--accent); margin-right: auto; font-size: 13px; }
</style>
