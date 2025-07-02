<script lang="ts">
    import { block_to_date, block_to_time_remaining, block_height_to_timestamp } from "$lib/common/countdown";
    import { game_detail } from "$lib/common/store";
    import { Button } from "$lib/components/ui/button";
    import * as Card from "$lib/components/ui/card";
    import { mode } from "mode-watcher";
    import { onMount, onDestroy } from "svelte";
    import { isGameParticipationEnded, type Game } from "$lib/common/game";
    
    export let game: Game;

    // --- Constants for Status Colors ---
    const STATUS_COLORS = {
        OPEN: "bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200",
        AWAITING_RESULTS: "bg-yellow-100 text-yellow-700 dark:bg-yellow-800 dark:text-yellow-200",
        RESOLVED: "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-200",
        ERROR: "bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-200",
        DEFAULT: "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300",
    };

    // --- Local State ---
    let participationEnded = true; // True if deadline passed or game.ended is true
    let deadlineDateString = "N/A";
    let deadlineTimeString = "N/A"; 
    let remainingTimeCountdown = "Loading..."; 
    let statusMessage = "Loading status...";
    let statusColor = STATUS_COLORS.DEFAULT; 
    let showFullDescription = false;

    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let _initializedGameId: string | null = null;
    let _isCurrentlyInitializing = false;

    // --- Core Logic Functions ---

    function updateDisplayMessages() {
        if (!game) return;
        const participationFeeErg = Number(game.participationFeeNanoErg) / 1e9;

        if (game.ended) { // Game is fully resolved (box spent)
            statusMessage = "Game has ended.";
            statusColor = STATUS_COLORS.RESOLVED;
            remainingTimeCountdown = "Resolved";
        } else if (participationEnded) { // Participation deadline passed, but game not yet resolved
            statusMessage = "Participation closed. Awaiting results...";
            statusColor = STATUS_COLORS.AWAITING_RESULTS;
            remainingTimeCountdown = "Awaiting Results";
        } else { // Participation is open
            statusMessage = `Fee: ${participationFeeErg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 9})} ERG`;
            statusColor = STATUS_COLORS.OPEN;
            // remainingTimeCountdown will be actively managed by runTimerTick
        }
    }

    async function runTimerTick() {
        if (!game || !game.platform || game.ended || participationEnded) {
            cleanupTimer();
            // If state changed to ended/closed, updateDisplayMessages would have been called or will be by reactive statement
            return;
        }
        try {
            remainingTimeCountdown = await block_to_time_remaining(game.deadlineBlock, game.platform);
            const currentParticipationStatus = await isGameParticipationEnded(game); // Check if deadline passed
            
            if (currentParticipationStatus && !participationEnded) { 
                // Deadline just passed
                participationEnded = true; 
                cleanupTimer();
                updateDisplayMessages(); // Update all messages, including countdown string
            }
        } catch (error) {
            console.error(`GameCard (${game?.boxId}): Error in runTimerTick:`, error);
            remainingTimeCountdown = "Error";
            statusMessage = "Error updating time";
            statusColor = STATUS_COLORS.ERROR;
            cleanupTimer(); 
        }
    }
    
    function cleanupTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    async function initializeCardStateInternal(currentGame: Game) {
        if (!currentGame || !currentGame.platform || _isCurrentlyInitializing) {
            if (_isCurrentlyInitializing) console.warn(`GameCard (${currentGame?.boxId}): Initialization already in progress, skipping.`);
            return;
        }
        _isCurrentlyInitializing = true;
        cleanupTimer(); // Clear any existing timer from a previous game instance

        try {
            if (currentGame.ended) {
                participationEnded = true; // If game.ended is true, participation is definitely over
            } else {
                // Check deadline only if not already marked as ended by the game object
                participationEnded = await isGameParticipationEnded(currentGame);
            }
            
            const deadlineTimestamp = await block_height_to_timestamp(currentGame.deadlineBlock, currentGame.platform);
            const deadlineDateObj = new Date(deadlineTimestamp);
            deadlineDateString = deadlineDateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            deadlineTimeString = deadlineDateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            
            updateDisplayMessages(); // Sets initial statusMessage, statusColor, and static remainingTimeCountdown if applicable

            if (currentGame.ended || participationEnded) {
                // Timer not needed, remainingTimeCountdown is already set by updateDisplayMessages
            } else { 
                // Participation is open, game not ended by prop
                await runTimerTick(); // Run once immediately to get initial time
                // Check if status changed after the first tick (e.g., deadline passed during async op)
                if (!participationEnded && !currentGame.ended) { // Check again
                    timerInterval = setInterval(runTimerTick, 30000); 
                } else {
                    // If status changed (e.g. participationEnded became true), ensure messages reflect this
                    cleanupTimer(); // Timer no longer needed
                    updateDisplayMessages(); // Update to "Awaiting Results" etc.
                }
            }
        } catch (error) {
            console.error(`GameCard (${currentGame?.boxId}): Error in initializeCardStateInternal:`, error);
            statusMessage = "Error loading card status.";
            statusColor = STATUS_COLORS.ERROR;
            remainingTimeCountdown = "Error";
            participationEnded = true; // Assume ended on error to stop timers
        } finally {
            _isCurrentlyInitializing = false;
        }
    }

    // --- Reactive Statements & Lifecycle ---

    // Main reactive block to re-initialize when 'game' prop changes
    $: if (game && game.boxId) {
        if (game.boxId !== _initializedGameId) {
            _initializedGameId = game.boxId;
            // Reset some states for the new game card to avoid flicker of old data
            remainingTimeCountdown = "Loading...";
            statusMessage = "Loading status...";
            statusColor = STATUS_COLORS.DEFAULT;
            participationEnded = true; // Default until determined
            initializeCardStateInternal(game);
        } else {
            // If game object instance changes but boxId is the same, re-initialize
            // This can happen if the game prop is updated with new data (e.g., game.ended changes)
             initializeCardStateInternal(game);
        }
    } else if (!game && _initializedGameId) { // Game prop becomes null (card removed/hidden)
        _initializedGameId = null;
        cleanupTimer();
        participationEnded = true;
        remainingTimeCountdown = "N/A";
        statusMessage = "";
        deadlineDateString = "N/A";
        deadlineTimeString = "N/A";
        statusColor = STATUS_COLORS.DEFAULT;
    }

    // Secondary reactive block to update messages if local 'participationEnded' changes
    // This is useful if runTimerTick sets participationEnded=true.
    $: if (game && participationEnded !== undefined) { 
        updateDisplayMessages();
    }

    onMount(() => {
        // Initial call to initializeCardStateInternal is handled by the reactive block above
        // if 'game' is already populated. If 'game' is populated after mount, it will also trigger.
    });

    onDestroy(() => {
        cleanupTimer();
    });

    // --- Event Handlers & Formatters ---

    function handleViewDetails() {
        if (game) {
            game_detail.set(game);
        }
    }

    function formatDescription(description: string | null | undefined): string {
        if (!description) return "No detailed description provided.";
        // Basic sanitization: replace newline characters with <br/>.
        // For more robust HTML sanitization, consider a library if description can contain arbitrary HTML.
        return description.replace(/\n/g, '<br/>');
    }

</script>

<Card.Root class="relative bg-card h-full min-h-[420px] flex flex-col {$mode === 'dark' ? 'bg-slate-800 border-slate-500/20' : 'bg-white border-slate-500/30'} border rounded-xl shadow-lg transition-all duration-300 hover:shadow-slate-400/30 hover:-translate-y-1 dark:text-gray-300 text-gray-700">
    
    {#if game?.participations !== undefined && game?.participations !== null}
        <div class="absolute top-3.5 right-3.5 flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg shadow-lg z-10 pointer-events-none
                    {$mode === 'dark' ? 'bg-slate-200 text-slate-700' : 'bg-slate-600 text-slate-100'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 opacity-90">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            {game.participations.length}
            <span class="ml-1 opacity-80 hidden xs:inline">Playing</span>
        </div>
    {/if}

    <Card.Header class="p-4 pb-2 flex flex-col items-start {$mode === 'dark' ? 'border-b border-slate-700' : 'border-b border-gray-200'}">
        <Card.Title class="text-lg md:text-xl font-semibold line-clamp-2 text-slate-600 dark:text-slate-400 mb-1 h-[3em] leading-tight pr-16"> {game?.content?.title || 'Loading title...'}
        </Card.Title>
        
        {#if game?.gameId}
            <p class="text-xs text-gray-500 dark:text-gray-400">
                Game ID (NFT): 
                <span class="font-mono bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300">
                    {game.gameId.length > 20 ? `${game.gameId.slice(0, 10)}...${game.gameId.slice(-10)}` : game.gameId}
                </span>
            </p>
        {/if}

        {#if game?.content?.serviceId}
            <p class="text-xs text-gray-500 dark:text-gray-400" class:mt-0.5={!!game?.gameId}> 
                Service ID: 
                <span class="font-mono bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300">
                    {game.content.serviceId.length > 20 ? `${game.content.serviceId.slice(0, 10)}...${game.content.serviceId.slice(-10)}` : game.content.serviceId}
                </span>
            </p>
        {/if}
    </Card.Header>
    
    <Card.Content class="p-4 flex-1 flex flex-col overflow-hidden">
        {#if game?.content?.imageURL}
            <img 
                src={game.content.imageURL} 
                alt="{(game.content.title || 'Game')} banner" 
                class="w-full h-36 object-cover rounded-lg mb-3 shadow"
                loading="lazy"
            />
        {/if}
        <div class="description-container flex-1 relative">
            {#if !showFullDescription}
                <div class="truncated-description text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'}">
                    {@html formatDescription(game?.content?.description?.slice(0, 120))}
                    {#if game?.content?.description && game.content.description.length > 120}
                        <span class="fade-text">...</span>
                        <button 
                            class="read-more-btn"
                            on:click|stopPropagation={() => showFullDescription = true}
                        >
                            Read More
                        </button>
                    {/if}
                    {#if !game?.content?.description || game.content.description.length <= 120}
                        <div class="h-6"></div> 
                    {/if}
                </div>
            {:else}
                <div class="full-description">
                    <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'} scrollable-description">
                        {@html formatDescription(game?.content?.description)}
                    </p>
                    <button 
                        class="read-less-btn mt-1"
                        on:click|stopPropagation={() => showFullDescription = false}
                    >
                        Show Less
                    </button>
                </div>
            {/if}
        </div>
    </Card.Content>

    <div class="px-4 pt-2 pb-1 text-xs">
        <div class={`${statusColor} p-2.5 rounded-md text-xs font-medium transition-all shadow-sm mb-2 text-center`}>
            {statusMessage}
        </div>
        
        <div class="text-center text-gray-500 dark:text-gray-400 leading-tight min-h-[2.5em] flex flex-col justify-center">
            <p class="font-semibold text-slate-600 dark:text-slate-400">{remainingTimeCountdown}</p>
            {#if !game?.ended && !participationEnded && deadlineDateString} <p class="text-xs opacity-80">Closes: {deadlineDateString} {#if deadlineTimeString}at {deadlineTimeString}{/if}</p>
            {:else if (game?.ended || participationEnded) && deadlineDateString} <p class="text-xs opacity-80">Original Deadline: {deadlineDateString}</p>
            {/if}
        </div>
    </div>

    <Card.Footer class="p-4 pt-3">
        <Button
            class="w-full transition-all duration-200 hover:scale-[1.02] bg-slate-500 hover:bg-slate-600 text-white dark:text-slate-900 font-semibold py-2.5"
            on:click={handleViewDetails}
            disabled={!game}
        >
            View Game Details
        </Button>
    </Card.Footer>
</Card.Root>

<style>
    /* Estilos (sin cambios respecto a tu original, solo los he incluido para que esté completo) */
    .description-container {
        margin-bottom: 0.5rem;
    }
    .fade-text { opacity: 0.6; }
    .read-more-btn, .read-less-btn {
        color: var(--theme-primary, slate); /* Fallback to slate if theme-primary not set */
        background: none; border: none; padding: 0;
        font-size: 0.875rem; font-weight: 500; cursor: pointer;
        margin-top: 0.25rem; display: inline-block;
        transition: color 0.2s ease;
    }
    .dark .read-more-btn, .dark .read-less-btn { color: var(--theme-primary-dark, #FFC107); } /* Fallback color for dark */
    .read-more-btn:hover, .read-less-btn:hover { filter: brightness(1.2); }

    .scrollable-description {
        max-height: 150px; 
        overflow-y: auto;
        padding-right: 8px; 
        word-break: break-word; 
    }
    .scrollable-description::-webkit-scrollbar { width: 5px; }
    .scrollable-description::-webkit-scrollbar-track { background: transparent; }
    .scrollable-description::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.3); border-radius: 3px; } 
    .dark .scrollable-description::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.5); } 
    .scrollable-description::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.5); }
    .dark .scrollable-description::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.7); }
    
    .scrollable-description { /* Firefox scrollbar styles */
        scrollbar-width: thin;
        scrollbar-color: rgba(100, 116, 139, 0.3) transparent;
    }
    .dark .scrollable-description {
        scrollbar-color: rgba(100, 116, 139, 0.5) transparent;
    }

    .line-clamp-2 {
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2; 
        line-height: 1.5em; /* Ajusta según el font-size para que coincida con 2 líneas */
        max-height: 3em; /* line-height * número de líneas */
    }
</style>