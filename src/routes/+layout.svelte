<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { isDevMode } from "$lib/ergo/envs";
</script>

<ModeWatcher />

{#if $isDevMode}
	<div
		class="bg-yellow-500/90 text-black text-center text-xs font-bold py-1 px-4 fixed top-0 left-0 right-0 z-[60] backdrop-blur-sm shadow-sm"
	>
		DEVELOPMENT MODE ACTIVE
	</div>
{/if}

<slot></slot>
