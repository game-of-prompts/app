<script lang="ts">
    import GameCard from './GameCard.svelte';
    import { type Game } from '$lib/common/game';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { games } from '$lib/common/store';
    import * as Alert from "$lib/components/ui/alert";
    import { Loader2, Search } from 'lucide-svelte';
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { Input } from "$lib/components/ui/input";
    import { fade } from 'svelte/transition';

    let platform = new ErgoPlatform();
    let allFetchedItems: Map<string, Game> = new Map();
    let listedItems: Map<string, Game> | null = null;
    let errorMessage: string | null = null;
    let isLoadingApi: boolean = true;
    let isFiltering: boolean = false;
    let searchQuery: string = "";
    let offset: number = 0;

    export let filterGame: ((item: Game) => Promise<boolean>) | null = null;

    async function applyFiltersAndSearch(sourceItems: Map<string, Game>) {
        const filteredItemsMap = new Map<string, Game>();
        for (const [id, item] of sourceItems.entries()) {
            let shouldAdd = true;
            if (filterGame) {
                shouldAdd = await filterGame(item);
            }
            if (shouldAdd) {
                if (searchQuery && item.content) {
                    const searchLower = searchQuery.toLowerCase();
                    const titleMatch = item.content.title?.toLowerCase().includes(searchLower) ?? false;
                    const descriptionMatch = item.content.description?.toLowerCase().includes(searchLower) ?? false;
                    shouldAdd = titleMatch || descriptionMatch;
                }
                if (shouldAdd) {
                    filteredItemsMap.set(id, item);
                }
            }
        }
        const sortedItemsArray = Array.from(filteredItemsMap.entries()).sort(
            ([, itemA], [, itemB]) => (itemB.box?.creationHeight ?? 0) - (itemA.box?.creationHeight ?? 0)
        );
        listedItems = new Map(sortedItemsArray);
    }

    async function loadInitialItems() {
        isLoadingApi = true;
        errorMessage = null;
        try {
            const gamesMap = await platform.fetchGoPGames(offset);
            const combinedGames = new Map<string, Game>([...gamesMap]);
            games.set(combinedGames);
        } catch (error: any) {
            console.error("Error fetching GoP games:", error);
            errorMessage = error.message || "An error occurred while fetching games.";
            games.set(new Map());
        }
    }

    const unsubscribeGames = games.subscribe(async value => {
        allFetchedItems = value || new Map();
        await applyFiltersAndSearch(allFetchedItems);
        if (isLoadingApi) isLoadingApi = false;
    });

    let debouncedSearch: any;
    $: if (searchQuery !== undefined) {
        clearTimeout(debouncedSearch);
        debouncedSearch = setTimeout(async () => {
            isFiltering = true;
            await applyFiltersAndSearch(allFetchedItems);
            isFiltering = false;
        }, 300);
    }

    onMount(() => {
        if (get(games).size === 0) {
            loadInitialItems();
        } else {
            allFetchedItems = get(games);
            applyFiltersAndSearch(allFetchedItems).then(() => {
                 if (isLoadingApi) isLoadingApi = false;
            });
        }
    });

    onDestroy(() => {
        unsubscribeGames();
        if (debouncedSearch) clearTimeout(debouncedSearch);
    });
</script>

<div class="items-container">
    <div class="hero-section">
        <h2 class="items-title"><slot>Explore Games</slot></h2>
        <p class="subtitle">Compete, demonstrate your skill, and win prizes.</p>
    </div>

    <div class="search-container mb-12">
        <div class="relative w-full max-w-md mx-auto">
            <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500/70 h-4 w-4" />
            <Input
                type="text"
                placeholder="Search games..."
                bind:value={searchQuery}
                class="pl-10 w-full bg-background/80 backdrop-blur-lg border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1 rounded-lg transition-all duration-200"
            />
             {#if isFiltering}
                <Loader2 class="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-slate-500" />
            {/if}
        </div>
    </div>

    {#if errorMessage}
        <Alert.Root class="my-4 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
            <Alert.Description class="text-center">{errorMessage}</Alert.Description>
        </Alert.Root>
    {/if}

    {#if isLoadingApi}
        <div class="game-list-container">
            {#each Array(3) as _, i}
                <div class="skeleton-row" class:reverse={i % 2 !== 0}>
                    <div class="skeleton-image-large"></div>
                    <div class="skeleton-content">
                        <div class="skeleton-line title"></div>
                        <div class="skeleton-line text"></div>
                        <div class="skeleton-line text short"></div>
                        <div class="skeleton-button"></div>
                    </div>
                </div>
            {/each}
        </div>
    {:else if listedItems && Array.from(listedItems).length > 0}
        <div class="game-list-container">
            {#each Array.from(listedItems) as [itemId, itemData], i (itemId)}
                <GameCard game={itemData} index={i} />
            {/each}
        </div>
    {:else}
        <div class="no-items-container">
            <p class="no-items-text">No games found.</p>
        </div>
    {/if}
</div>

<style>
    .items-container {
        display: flex;
        flex-direction: column;
        padding: 2rem 15px 0;
        margin-bottom: 40px;
        width: 100%;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
    }

    .hero-section {
        text-align: center;
        padding: 2rem 1rem;
        margin-bottom: 2rem;
    }

    .items-title {
        text-align: center;
        font-size: 2.8rem;
        margin: 0 0 0.5rem;
        color: slate;
        font-family: 'Russo One', sans-serif;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .subtitle {
        font-size: 1.1rem;
        color: var(--muted-foreground);
        max-width: 500px;
        margin: 0 auto;
    }

    /*
      RAZONAMIENTO: Los estilos de la cuadrícula se reemplazan por los de una lista flexible.
      El contenedor apila los elementos verticalmente con un espacio (`gap`) entre ellos.
    */
    .game-list-container {
        display: flex;
        flex-direction: column;
        gap: 4rem; /* Espacio generoso entre cada juego */
        width: 100%;
    }

    /* RAZONAMIENTO: Nuevos estilos para el skeleton loader de filas. */
    @keyframes pulse { 50% { opacity: .6; } }
    .skeleton-row {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    .skeleton-image-large {
        height: 16rem; /* 256px */
        width: 100%;
        background-color: var(--muted);
        border-radius: 0.75rem;
    }
    .skeleton-content { flex: 1; }
    .skeleton-line {
        height: 1rem;
        border-radius: 0.25rem;
        background-color: var(--muted);
        margin-bottom: 1rem;
    }
    .skeleton-line.title { height: 2rem; width: 60%; margin-bottom: 1.5rem; }
    .skeleton-line.text { width: 100%; }
    .skeleton-line.text.short { width: 70%; }
    .skeleton-button { height: 3rem; width: 180px; background-color: var(--muted); border-radius: 0.5rem; margin-top: 2rem; }

    @media (min-width: 768px) {
        .skeleton-row {
            flex-direction: row;
            align-items: center;
        }
        .skeleton-image-large { width: 45%; }
        .skeleton-row.reverse { flex-direction: row-reverse; }
    }


    .no-items-container, .no-items-text { /* Estilos sin cambios */ }
</style>