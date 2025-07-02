<script lang="ts">
    import GameCard from './GameCard.svelte';
    import { type Game } from '$lib/common/game';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { games } from '$lib/common/store'; 
    import * as Alert from "$lib/components/ui/alert";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Loader2, Search } from 'lucide-svelte';
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { Input } from "$lib/components/ui/input";

    let platform = new ErgoPlatform();
    let allFetchedItems: Map<string, Game> = new Map();
    let listedItems: Map<string, Game> | null = null; 
    let errorMessage: string | null = null;
    let isLoadingApi: boolean = true; // Renombrado para la carga de API
    let isFiltering: boolean = false; // Nuevo estado para el feedback de filtrado
    let searchQuery: string = "";
    let offset: number = 0; 

    export let filterGame: ((item: Game) => Promise<boolean>) | null = null;

    // Función síncrona o asíncrona ligera para filtrar y buscar
    async function applyFiltersAndSearch(sourceItems: Map<string, Game>) {
        console.log("GameList: applyFiltersAndSearch called"); // DEBUG
        const filteredItemsMap = new Map<string, Game>();
        for (const [id, item] of sourceItems.entries()) {
            let shouldAdd = true;
            if (filterGame) {
                shouldAdd = await filterGame(item); // filterGame puede ser async
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
        listedItems = new Map(sortedItemsArray); // Actualiza los items listados
        console.log("GameList: listedItems updated, count:", listedItems.size); // DEBUG
    }

    async function loadInitialItems() {
        console.log("GameList: loadInitialItems called. Offset:", offset, ". Now fetching active and ended games."); // DEBUG
        
        isLoadingApi = true; 
        errorMessage = null;

        try {
            // 1. Obtener juegos activos para el offset actual
            const activeGamesMap = await platform.fetchActiveGoPGames(offset);
            console.log(`GameList: Fetched active games (offset: ${offset}):`, activeGamesMap.size); //DEBUG

            // 2. Obtener juegos terminados para el offset actual
            const endedGamesMap = await platform.fetchEndedGoPGames(offset); // Usando el mismo offset
            console.log(`GameList: Fetched ended games (offset: ${offset}):`, endedGamesMap.size); //DEBUG

            // 3. Combinar los dos mapas.
            // Si un gameId existiera en ambos (lo cual no debería suceder si la lógica de activo/terminado es correcta
            // y gameId es un identificador único como un NFT ID), el de endedGamesMap sobrescribiría al de activeGamesMap
            // debido al orden en el spread operator.
            const combinedGames = new Map<string, Game>([...activeGamesMap, ...endedGamesMap]);
            
            console.log("GameList: Total combined games for store:", combinedGames.size); //DEBUG
            
            // Actualizar el store con los juegos combinados.
            // Si el offset es para paginación de "más ítems", se debería añadir a los existentes
            // en lugar de reemplazar. Pero tu código original hace un games.set(),
            // lo que sugiere que 'offset' podría ser para recargar una página específica o la lista completa desde un punto.
            // Si 'offset' indica una página y 'games' siempre contiene solo los de la página actual:
            games.set(combinedGames); 
            
            // Si la intención es "cargar más" y añadir al final:
            // games.update(currentGames => new Map([...currentGames, ...combinedGames]));
            // Esto último requeriría que 'offset' se gestione cuidadosamente para evitar duplicados
            // y para que fetchActiveGoPGames/fetchEndedGoPGames realmente devuelvan la "siguiente" página.
            // Por ahora, me apego a tu lógica original de games.set().

            // La suscripción a 'games' (como indicaste en tu código original)
            // se encargará de llamar a applyFiltersAndSearch y de poner isLoadingApi a false.

        } catch (error: any) {
            console.error("Error fetching GoP games (active and/or ended):", error);
            errorMessage = error.message || "Error occurred while fetching GoP games";
            games.set(new Map()); // Poner a vacío para que la suscripción reaccione y muestre el error
        }
        // isLoadingApi se pone a false en la suscripción a 'games'
    }

    const unsubscribeGames = games.subscribe(async value => {
        console.log("GameList: 'games' store updated, current isLoadingApi:", isLoadingApi); // DEBUG
        allFetchedItems = value || new Map(); 
        await applyFiltersAndSearch(allFetchedItems); // Aplicar filtros a los nuevos datos del store
        if (isLoadingApi) isLoadingApi = false; // Marcar como finalizada la carga de API
    });

    let debouncedSearch: any;
    $: if (searchQuery !== undefined) { // Solo reaccionar a searchQuery
        clearTimeout(debouncedSearch);
        debouncedSearch = setTimeout(async () => {
            console.log("GameList: Search query changed to:", searchQuery, "Applying filters."); // DEBUG
            isFiltering = true; // Estado para feedback de filtrado (opcional)
            await applyFiltersAndSearch(allFetchedItems); // Filtra sobre los datos ya cargados (allFetchedItems)
            isFiltering = false;
        }, 300);
    }

    onMount(() => {
        console.log("GameList: onMount. Initial games store size:", get(games).size); // DEBUG
        if (get(games).size === 0) {
            // isLoadingApi ya es true por defecto.
            loadInitialItems();
        } else {
            // Si ya hay datos, la suscripción a 'games' los procesará y pondrá isLoadingApi a false.
            // Para asegurar, podemos forzar aquí la actualización si la suscripción no se ha disparado aún
            // o si el componente se monta después de que el store ya tuviera datos.
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
    <h2 class="items-title"><slot>Explore Games</slot></h2>

    <div class="search-container mb-6">
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
            <Alert.Description class="text-center">
                {errorMessage}
            </Alert.Description>
        </Alert.Root>
    {/if}

    {#if isLoadingApi}
        <Dialog.Root open={isLoadingApi}>
            <Dialog.Content class="w-[250px] rounded-xl bg-background/80 backdrop-blur-lg border border-slate-500/20">
                <div class="flex flex-col items-center justify-center p-6 gap-4">
                    <Loader2 class="h-16 w-16 animate-spin text-slate-500" />
                    <Dialog.Title class="text-lg font-medium font-['Russo_One'] text-center">Fetching active games from the Ergo blockchain</Dialog.Title>
                </div>
            </Dialog.Content>
        </Dialog.Root>
        <div class="loading-placeholder"></div>
    {:else if listedItems && Array.from(listedItems).length > 0}
        <div class="items-grid">
            {#each Array.from(listedItems) as [itemId, itemData] (itemId)} 
                <div class="item-card"> 
                    <GameCard game={itemData} /> 
                </div>
            {/each}
        </div>
    {:else}
        <div class="no-items-container">
            <p class="no-items-text">No games found.</p> 
        </div>
    {/if}
</div>

<style>
    /* ... (tu CSS existente) ... */
    .items-container {
        display: flex;
        flex-direction: column;
        padding: 0 15px;
        margin-bottom: 40px;
        width: 100%;
        max-width: 1200px;
        margin-left: auto;
        margin-right: auto;
    }

    .items-title { 
        text-align: center;
        font-size: 2.2rem;
        margin: 20px 0 30px;
        color: slate; 
        font-family: 'Russo One', sans-serif;
        letter-spacing: 0.02em;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        position: relative;
    }

    .items-title::after { 
        content: '';
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        width: 100px;
        height: 3px;
        background: linear-gradient(90deg, rgba(100, 116, 139, 0), rgba(100, 116, 139, 1), rgba(100, 116, 139, 0));
    }

    .items-grid { 
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 2rem;
        padding: 10px;
        width: 100%;
        animation: fadeIn 0.5s ease-in;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .item-card { 
        min-height: 400px; 
        transition: transform 0.3s ease;
    }

    .no-items-container { 
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        margin-top: 2rem; 
    }

    .no-items-text { 
        text-align: center;
        padding: 3rem;
        font-size: 1.2rem;
        color: #aaa; 
        background: rgba(var(--card-background-rgb, 255, 255, 255), 0.05); 
        border-radius: 8px;
        border: 1px solid rgba(var(--border-rgb, 255, 165, 0), 0.1);
        max-width: 500px;
        margin: 2rem auto;
    }
    .dark .no-items-text {
        color: #888;
    }


    .loading-placeholder {
        height: 70vh;
        width: 100%;
    }

    @media (max-width: 768px) {
        .items-grid { 
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
        }
        
        .loading-placeholder {
            height: 50vh;
        }

        .items-title { 
            font-size: 1.8rem;
            margin: 15px 0 25px;
        }
    }

    @media (max-width: 480px) {
        .items-grid { 
            grid-template-columns: 1fr; 
        }
    }
</style>