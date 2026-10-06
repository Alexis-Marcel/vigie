<script lang="ts">
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head>
  <title>Vigie</title>
</svelte:head>

{@render children()}
