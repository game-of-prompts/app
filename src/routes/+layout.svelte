<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { isDevMode } from "$lib/ergo/envs";
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { goto } from "$app/navigation";

	let initialized = false;

	onMount(() => {
		const env = $page.url.searchParams.get("env");
		if (env === "dev") {
			isDevMode.set(true);
		}
		initialized = true;
	});

	$: if (initialized) {
		const url = new URL($page.url);
		let changed = false;
		if ($isDevMode) {
			if (url.searchParams.get("env") !== "dev") {
				url.searchParams.set("env", "dev");
				changed = true;
			}
		} else {
			if (url.searchParams.get("env") === "dev") {
				url.searchParams.delete("env");
				changed = true;
			}
		}

		if (changed) {
			goto(url, { replaceState: true, keepFocus: true, noScroll: true });
		}
	}
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
