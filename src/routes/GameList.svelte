<script lang="ts">
    import GameCard from "./GameCard.svelte";
    import { type AnyGame as Game } from "$lib/common/game";
    import { games, isLoadingGames, muted } from "$lib/common/store";
    import * as Alert from "$lib/components/ui/alert";
    import { Loader2, Search } from "lucide-svelte";
    import { onMount, onDestroy, afterUpdate, tick } from "svelte";
    import { get } from "svelte/store";
    import { Input } from "$lib/components/ui/input";
    import { fetchGoPGames } from "$lib/ergo/fetch";

    let allFetchedItems: Map<string, Game> = new Map();
    let listedItems: Map<string, Game> | null = null;
    let errorMessage: string | null = null;
    let isLoadingApi: boolean = true;
    let isFiltering: boolean = false;
    let searchQuery: string = "";
    let orderedIds: string[] = [];
    let isInitialSort: boolean = true;

    const statusOptions = [
        { value: "all", label: "All Statuses" },
        { value: "Active", label: "Active" },
        { value: "Resolution", label: "Resolution" },
        { value: "Cancelled_Draining", label: "Cancelled" },
        { value: "Finalized", label: "Finalized" },
    ];

    let selectedStatus: string = statusOptions[0].value;

    let totalGamesCount: number = 0;

    export let filterGame: ((item: Game) => Promise<boolean>) | null = null;

    // Audio variables
    let audioContext: AudioContext | null = null;
    let soundBuffers: AudioBuffer[] = [];
    let currentSoundIndex = 0;
    let isInitialLoad = true;
    let observer: IntersectionObserver | null = null;

    function getStatus(item: Game) {
        return (
            (item.status as string) ||
            (item.state as string) ||
            (item.box?.state as string) ||
            (item.box?.status as string) ||
            "unknown"
        );
    }

    // Audio functions
    function generateClickSound(frequency: number, duration: number): AudioBuffer | null {
        if (!audioContext) return null;
        const sampleRate = audioContext.sampleRate;
        const length = Math.floor(sampleRate * duration / 1000);
        const buffer = audioContext.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            // Organic decay envelope
            const envelope = Math.exp(-t * 15) * (1 - Math.exp(-t * 50)); // attack and decay
            // Mix of sine wave and noise for organic feel
            const sine = Math.sin(2 * Math.PI * frequency * t);
            const noise = (Math.random() - 0.5) * 0.3;
            data[i] = envelope * (sine + noise);
        }
        return buffer;
    }

    function playScrollSound() {
        if (!audioContext || soundBuffers.length === 0 || get(muted)) return;
        const source = audioContext.createBufferSource();
        source.buffer = soundBuffers[currentSoundIndex];
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.08; // slightly higher volume for lower frequencies
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        source.start();
        currentSoundIndex = (currentSoundIndex + 1) % soundBuffers.length;
    }

    function setupIntersectionObserver() {
        if (observer) observer.disconnect();
        observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !isInitialLoad) {
                    playScrollSound();
                }
            });
        }, { threshold: 0.3 }); // 30% visible
        cardElements.forEach(el => observer.observe(el));
    }

    async function applyFiltersAndSearch(sourceItems: Map<string, Game>) {
        const filteredItemsMap = new Map<string, Game>();
        const targetValue =
            selectedStatus === "Cancelled"
                ? "Cancelled_Draining"
                : selectedStatus;
        const targetOption = statusOptions.find(
            (o) => o.value.toLowerCase() === selectedStatus.toLowerCase(),
        )?.value;

        for (const [id, item] of sourceItems.entries()) {
            let shouldAdd = true;
            if (filterGame) {
                shouldAdd = await filterGame(item);
            }

            if (shouldAdd && selectedStatus && selectedStatus !== "all") {
                const s = getStatus(item)?.toString() ?? "unknown";

                const statusMatch =
                    s.toLowerCase() === targetOption?.toLowerCase();

                if (!statusMatch) {
                    shouldAdd = false;
                }
            }

            if (shouldAdd) {
                if (searchQuery && item.content) {
                    const searchLower = searchQuery.toLowerCase();
                    const titleMatch =
                        item.content.title
                            ?.toLowerCase()
                            .includes(searchLower) ?? false;
                    const descriptionMatch =
                        item.content.description
                            ?.toLowerCase()
                            .includes(searchLower) ?? false;
                    shouldAdd = titleMatch || descriptionMatch;
                }
                if (shouldAdd) {
                    filteredItemsMap.set(id, item);
                }
            }
        }

        if (searchQuery || isInitialSort) {
            const sortedItemsArray = Array.from(
                filteredItemsMap.entries(),
            ).sort(
                ([, itemA], [, itemB]) =>
                    (itemB.box?.creationHeight ?? 0) -
                    (itemA.box?.creationHeight ?? 0),
            );
            orderedIds = sortedItemsArray.map(([id]) => id);
            listedItems = new Map(sortedItemsArray);
            if (isInitialSort && !searchQuery) {
                isInitialSort = false;
            }
        } else {
            const existingIds = new Set(orderedIds);
            const newIds = Array.from(filteredItemsMap.keys()).filter(
                (id) => !existingIds.has(id),
            );

            const newSortedIds = newIds.sort((idA, idB) => {
                const itemA = filteredItemsMap.get(idA);
                const itemB = filteredItemsMap.get(idB);
                return (
                    (itemB?.box?.creationHeight ?? 0) -
                    (itemA?.box?.creationHeight ?? 0)
                );
            });

            orderedIds = [
                ...orderedIds.filter((id) => filteredItemsMap.has(id)),
                ...newSortedIds,
            ];

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
            errorMessage =
                error.message || "An error occurred while fetching games.";
        }
    }

    const unsubscribeGames = games.subscribe(async (value) => {
        allFetchedItems = value.data || new Map();

        totalGamesCount = allFetchedItems.size;

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

            totalGamesCount = allFetchedItems.size;

            applyFiltersAndSearch(allFetchedItems).then(() => {
                if (isLoadingApi) isLoadingApi = false;
            });
        }

        // Initialize audio
        try {
            audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            const frequencies = [200, 300, 400]; // lower frequencies for organic feel
            for (const freq of frequencies) {
                const buffer = generateClickSound(freq, 100); // 100ms duration for more organic
                if (buffer) soundBuffers.push(buffer);
            }
        } catch (e) {
            console.warn("Audio not supported:", e);
        }

        window.addEventListener("keydown", handleKeyNavigation);

        // Set initial load to false after a short delay
        setTimeout(() => isInitialLoad = false, 1500);
    });

    onDestroy(() => {
        if (debouncedSearch) clearTimeout(debouncedSearch);
        window.removeEventListener("keydown", handleKeyNavigation);
        if (observer) observer.disconnect();
    });

    let cardElements: HTMLElement[] = [];
    let currentIndex = 0;

    async function scrollToCard(index: number) {
        await tick();
        if (!cardElements[index]) return;
        cardElements[index].scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
        cardElements.forEach((el, i) => {
            if (i === index) el.classList.add("active");
            else el.classList.remove("active");
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
        setupIntersectionObserver();
    });
</script>

<div class="items-container">
    <div class="hero-section">
        <h2
            class="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4 bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent inline-block"
        >
            Explore Competitions
        </h2>
        <p class="subtitle">Compete, demonstrate your skill, and win prizes.</p>
        <div class="counts-row">
            <div class="badge">Total games: {totalGamesCount}</div>
            {#if listedItems}
                <div class="badge muted">
                    Showing: {Array.from(listedItems).length}
                </div>
            {/if}
        </div>
    </div>

    <div class="search-container mb-12">
        <div
            class="relative w-full max-w-2xl mx-auto flex flex-col md:flex-row items-center gap-3"
        >
            <div class="relative flex-1 w-full">
                <Search
                    class="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500/70 h-4 w-4"
                />
                <Input
                    type="text"
                    placeholder="Search games..."
                    bind:value={searchQuery}
                    class="pl-10 w-full bg-background/80 backdrop-blur-lg border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1 rounded-lg transition-all duration-200"
                />
                {#if isFiltering}
                    <Loader2
                        class="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-slate-500"
                    />
                {/if}
            </div>

            <div class="status-filter">
                <label for="status-select" class="sr-only"
                    >Filter by status</label
                >
                <select
                    id="status-select"
                    bind:value={selectedStatus}
                    on:change={() => applyFiltersAndSearch(allFetchedItems)}
                >
                    {#each statusOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </div>
        </div>
    </div>

    {#if errorMessage}
        <Alert.Root
            class="my-4 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
        >
            <Alert.Description class="text-center"
                >{errorMessage}</Alert.Description
            >
        </Alert.Root>
    {/if}

    {#if isLoadingApi || $isLoadingGames}
        <div class="loading-state">
            <div class="loading-content">
                <Loader2 class="h-10 w-10 animate-spin text-primary mb-4" />
                <p class="text-lg font-medium text-muted-foreground">
                    Fetching competitions from Ergo...
                </p>
            </div>
            <div class="game-list-container opacity-40">
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
        </div>
    {:else if listedItems && Array.from(listedItems).length > 0}
        <div class="game-list-container">
            {#each Array.from(listedItems) as [itemId, itemData], i (itemId)}
                <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
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
        margin-bottom: 2rem;
    }
    .subtitle {
        font-size: 1.1rem;
        color: var(--muted-foreground);
        max-width: 500px;
        margin: 0 auto;
    }
    .counts-row {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
        margin-top: 0.75rem;
    }
    .badge {
        padding: 0.35rem 0.6rem;
        border-radius: 999px;
        background: var(--muted);
        color: var(--foreground);
        font-weight: 600;
    }
    .badge.muted {
        opacity: 0.8;
    }

    .search-container {
        margin-bottom: 3rem;
    }
    .status-filter select {
        padding: 0.5rem 0.75rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border);
        background: var(--input);
        color: var(--foreground);
        cursor: pointer;
        height: 40px;
    }

    .status-filter select option {
        color: #0f172a;
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
    @keyframes pulse {
        50% {
            opacity: 0.6;
        }
    }
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
    .skeleton-content {
        flex: 1;
    }
    .skeleton-line {
        height: 1rem;
        border-radius: 0.25rem;
        background-color: var(--muted);
        margin-bottom: 1rem;
    }
    .skeleton-line.title {
        height: 2rem;
        width: 60%;
        margin-bottom: 1.5rem;
    }
    .skeleton-line.text {
        width: 100%;
    }
    .skeleton-line.text.short {
        width: 70%;
    }
    .skeleton-button {
        height: 3rem;
        width: 180px;
        background-color: var(--muted);
        border-radius: 0.5rem;
        margin-top: 2rem;
    }
    @media (min-width: 768px) {
        .skeleton-row {
            flex-direction: row;
            align-items: center;
        }
        .skeleton-image-large {
            width: 45%;
        }
        .skeleton-row.reverse {
            flex-direction: row-reverse;
        }
    }
</style>
