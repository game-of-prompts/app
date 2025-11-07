<script lang="ts">
    import GameCard from './GameCard.svelte';
    import { type Game } from '$lib/common/game';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { games } from '$lib/common/store';
    import * as Alert from "$lib/components/ui/alert";
    import { Loader2, Search } from 'lucide-svelte';
    import { onMount, onDestroy, afterUpdate, tick } from 'svelte';
    import { get } from 'svelte/store';
    import { Input } from "$lib/components/ui/input";
    import { fetchGoPGames } from '$lib/ergo/fetch';

    let allFetchedItems: Map<string, Game> = new Map();
    let listedItems: Map<string, Game> | null = null;
    let errorMessage: string | null = null;
    let isLoadingApi: boolean = true;
    let isFiltering: boolean = false;
    let searchQuery: string = "";
    let offset: number = 0;
    let orderedIds: string[] = []; // Mantiene el orden de los IDs
    let isInitialSort: boolean = true; // Flag para saber si es la primera ordenación

    export let filterGame: ((item: Game) => Promise<boolean>) | null = null;

    async function applyFiltersAndSearch(sourceItems: Map<string, Game>) {
        const filteredItemsMap = new Map<string, Game>();
        
        // Filtrar elementos
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

        // Si hay búsqueda o es la carga inicial, ordenar completamente
        if (searchQuery || isInitialSort) {
            const sortedItemsArray = Array.from(filteredItemsMap.entries()).sort(
                ([, itemA], [, itemB]) => (itemB.box?.creationHeight ?? 0) - (itemA.box?.creationHeight ?? 0)
            );
            orderedIds = sortedItemsArray.map(([id]) => id);
            listedItems = new Map(sortedItemsArray);
            if (isInitialSort && !searchQuery) {
                isInitialSort = false;
            }
        } else {
            // Mantener orden existente y agregar nuevos al final
            const existingIds = new Set(orderedIds);
            const newIds = Array.from(filteredItemsMap.keys()).filter(id => !existingIds.has(id));
            
            // Ordenar solo los nuevos elementos
            const newSortedIds = newIds.sort((idA, idB) => {
                const itemA = filteredItemsMap.get(idA);
                const itemB = filteredItemsMap.get(idB);
                return (itemB?.box?.creationHeight ?? 0) - (itemA?.box?.creationHeight ?? 0);
            });
            
            // Agregar nuevos IDs al final
            orderedIds = [...orderedIds.filter(id => filteredItemsMap.has(id)), ...newSortedIds];
            
            // Reconstruir el mapa manteniendo el orden
            const orderedMap = new Map<string, Game>();
            for (const id of orderedIds) {
                const item = filteredItemsMap.get(id);
                if (item) {
                    orderedMap.set(id, item);
                }
            }
            listedItems = orderedMap;
        }
    }

    async function loadInitialItems() {
        isLoadingApi = true;
        errorMessage = null;
        try {
            await fetchGoPGames();
        } catch (error: any) {
            console.error("Error fetching GoP games:", error);
            errorMessage = error.message || "An error occurred while fetching games.";
        }
    }

    const unsubscribeGames = games.subscribe(async value => {
        allFetchedItems = value.data || new Map();
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
        if (get(games).data.size === 0) {
            loadInitialItems();
        } else {
            allFetchedItems = get(games).data;
            applyFiltersAndSearch(allFetchedItems).then(() => {
                 if (isLoadingApi) isLoadingApi = false;
            });
        }
    });

    onDestroy(() => {
        unsubscribeGames();
        if (debouncedSearch) clearTimeout(debouncedSearch);
        window.removeEventListener('keydown', handleKeyNavigation);
    });

    let cardElements: HTMLElement[] = [];
    let currentIndex = 0;

    async function scrollToCard(index: number) {
        await tick();
        if (!cardElements[index]) return;
        cardElements[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardElements.forEach((el, i) => {
            if (i === index) el.classList.add('active');
            else el.classList.remove('active');
        });
    }

    function handleKeyNavigation(event: KeyboardEvent) {
        if (!listedItems || cardElements.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            currentIndex = Math.min(currentIndex + 1, cardElements.length - 1);
            scrollToCard(currentIndex);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            currentIndex = Math.max(currentIndex - 1, 0);
            scrollToCard(currentIndex);
        }
    }

    afterUpdate(() => {
        cardElements = Array.from(document.querySelectorAll(".game-card"));
    });

    onMount(() => {
        window.addEventListener('keydown', handleKeyNavigation);
    });
</script>

<div class="items-container">
    <div class="hero-section">
        <h2 class="items-title">Explore Competitions</h2>
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
                <div class="game-card" tabindex="0">
                    <GameCard game={itemData} index={i} />
                </div>
            {/each}
        </div>
    {:else}
        <div class="no-items-container">
            <p class="no-items-text">No competitions found.</p>
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
        max-width: 1600px;
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
    }
    .subtitle {
        font-size: 1.1rem;
        color: var(--muted-foreground);
        max-width: 500px;
        margin: 0 auto;
    }
    .game-list-container {
        display: flex;
        flex-direction: column;
        gap: 4rem;
        width: 100%;
    }
    .game-card.active {
        outline: 3px solid var(--primary);
        outline-offset: 6px;
        border-radius: 1rem;
        transition: outline 0.3s ease;
    }
    @keyframes pulse { 50% { opacity: .6; } }
    .skeleton-row {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    .skeleton-image-large {
        height: 16rem;
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
</style>
