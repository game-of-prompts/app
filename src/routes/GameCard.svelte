<script lang="ts">
    import { block_to_time_remaining, block_height_to_timestamp } from "$lib/common/countdown";
    import { game_detail } from "$lib/common/store";
    import { Button } from "$lib/components/ui/button";
    import { onMount, onDestroy } from "svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    
    import { 
        isGameParticipationEnded, 
        GameState, 
        type AnyGame as Game 
    } from "$lib/common/game";

    export let game: Game;
    export let index: number;

    $: isEven = index % 2 === 0;

    const STATUS_COLORS = {
        OPEN: "bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-200",
        AWAITING_RESULTS: "bg-yellow-100 text-yellow-700 dark:bg-yellow-800 dark:text-yellow-200",
        RESOLUTION: "bg-purple-100 text-purple-700 dark:bg-purple-800 dark:text-purple-200",
        RESOLVED: "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-200",
        CANCELLED: "bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-200",
        DEFAULT: "bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300",
    };

    let participationEnded = true;
    let deadlineDateString = "N/A";
    let remainingTimeCountdown = "Loading...";
    let statusMessage = "Loading status...";
    let statusColor = STATUS_COLORS.DEFAULT;

    function handleViewDetails() {
        if (game) {
            game_detail.set(game);
        }
    }

    let timerInterval: ReturnType<typeof setInterval> | null = null;
    let _initializedGameId: string | null = null;
    let _isCurrentlyInitializing = false;

    // [MODIFICADO] La lógica de visualización ahora se basa en game.status.
    function updateDisplayMessages() {
        if (!game) return;

        switch (game.status) {
            case GameState.Active:
                const participationFeeErg = Number(game.participationFeeNanoErg) / 1e9;
                if (participationEnded) {
                    statusMessage = "Awaiting Results";
                    statusColor = STATUS_COLORS.AWAITING_RESULTS;
                    remainingTimeCountdown = "Participation closed";
                } else {
                    statusMessage = `Fee: ${participationFeeErg.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 9})} ERG`;
                    statusColor = STATUS_COLORS.OPEN;
                }
                break;
            
            case GameState.Resolution:
                statusMessage = "Judging in Progress";
                statusColor = STATUS_COLORS.RESOLUTION;
                remainingTimeCountdown = "Awaiting verdict";
                break;

            case GameState.Cancelled_Draining:
            case GameState.Cancelled_Finalized:
                statusMessage = "Game Cancelled";
                statusColor = STATUS_COLORS.CANCELLED;
                remainingTimeCountdown = "Ended";
                break;

            case GameState.Finalized:
                statusMessage = "Resolved";
                statusColor = STATUS_COLORS.RESOLVED;
                remainingTimeCountdown = "Game has ended";
                break;

            default:
                statusMessage = "Unknown Status";
                statusColor = STATUS_COLORS.DEFAULT;
                remainingTimeCountdown = "N/A";
                break;
        }
    }

    async function runTimerTick() {
        if (!game || game.status !== GameState.Active || participationEnded) {
            cleanupTimer();
            return;
        }
        try {
            remainingTimeCountdown = await block_to_time_remaining(game.deadlineBlock, game.platform);
            const currentParticipationStatus = await isGameParticipationEnded(game);

            if (currentParticipationStatus) {
                participationEnded = true;
                cleanupTimer();
                updateDisplayMessages(); // Actualiza el mensaje a "Awaiting Results"
            }
        } catch (error) {
            console.error(`GameCard (${game?.boxId}): Error in runTimerTick:`, error);
            remainingTimeCountdown = "Error";
            statusMessage = "Error updating time";
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
        if (!currentGame || !currentGame.platform || _isCurrentlyInitializing) return;
        _isCurrentlyInitializing = true;
        cleanupTimer();

        try {
            participationEnded = await isGameParticipationEnded(currentGame);

            if (currentGame.status === 'Active' || currentGame.status === 'Resolution') {
                const deadline = currentGame.status === 'Active' ? currentGame.deadlineBlock : currentGame.originalDeadline;
                const deadlineTimestamp = await block_height_to_timestamp(deadline, currentGame.platform);
                const deadlineDateObj = new Date(deadlineTimestamp);
                deadlineDateString = deadlineDateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            } else {
                deadlineDateString = 'N/A';
            }
            
            updateDisplayMessages();

            if (currentGame.status === GameState.Active && !participationEnded) {
                await runTimerTick();
                if (!participationEnded) {
                    timerInterval = setInterval(runTimerTick, 30000);
                }
            }
        } catch (error) {
            console.error(`GameCard (${currentGame?.boxId}): Error initializing:`, error);
            statusMessage = "Error loading status.";
            remainingTimeCountdown = "Error";
            participationEnded = true;
        } finally {
            _isCurrentlyInitializing = false;
        }
    }

    $: if (game && game.boxId && game.boxId !== _initializedGameId) {
        _initializedGameId = game.boxId;
        initializeCardStateInternal(game);
    }

    onMount(() => {
        if (game) initializeCardStateInternal(game);
        else {
            console.warn("GameCard: No game data provided.");
        }
    });

    onDestroy(() => {
        cleanupTimer();
    });
</script>

<div
    class="game-row flex flex-col md:flex-row items-start gap-8 md:gap-24 lg:gap-32 lg:px-16 xl:gap-40 xl:px-24"
    class:md:flex-row-reverse={!isEven}
>
    <div class="image-wrapper w-full md:w-5/12 flex-shrink-0">
        {#if game?.content?.imageURL}
            <img
                src={game.content.imageURL}
                alt="{game.content.title} banner"
                class="w-full h-auto object-cover rounded-lg aspect-video"
                loading="lazy"
            />
        {/if}
    </div>

    <div class="content-wrapper w-full md:w-7/12 text-center md:text-left">
        <Badge variant="secondary" class="mb-3">
            {game.participations?.length || 0} Participants
        </Badge>

        <h3 class="text-3xl font-bold font-['Russo_One'] mb-2 text-slate-700 dark:text-slate-300">
            {game?.content?.title || 'Loading title...'}
        </h3>

        <div class="text-xs text-gray-500 dark:text-gray-400 mb-4 space-y-1">
            <p>
                Game ID:
                <span class="font-mono bg-gray-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300">
                    {game.gameId.slice(0, 10)}...{game.gameId.slice(-10)}
                </span>
            </p>
            {#if game?.content?.serviceId}
                <p>
                    Service ID:
                    <span class="font-mono bg-gray-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300">
                        {game.content.serviceId.length > 20 ? `${game.content.serviceId.slice(0, 8)}...${game.content.serviceId.slice(-8)}` : game.content.serviceId}
                    </span>
                </p>
            {/if}
        </div>

        <p class="description-text mb-6 text-slate-600 dark:text-slate-400">
            {game?.content?.description?.slice(0, 200) || 'No description.'}
            {#if game?.content?.description && game.content.description.length > 200}...{/if}
        </p>

        <div class="status-info flex flex-col sm:flex-row gap-4 items-center mb-6 justify-center md:justify-start">
            <div class="text-center md:text-left">
                <div class="text-xs uppercase text-slate-500 dark:text-slate-400 tracking-wider">Status</div>
                <div class="{statusColor} px-3 py-1 rounded-full text-sm font-semibold mt-1">
                    {statusMessage}
                </div>
            </div>
            <div class="text-center md:text-left" style="margin-left: 30px;">
                <div class="text-xs uppercase text-slate-500 dark:text-slate-400 tracking-wider">Time Remaining</div>
                <div class="text-lg font-semibold text-slate-700 dark:text-slate-200 mt-1">
                    {remainingTimeCountdown}
                </div>
                {#if (game.status === 'Resolution' || participationEnded) && deadlineDateString !== 'N/A'}
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Original Deadline: {deadlineDateString}
                    </p>
                {/if}
            </div>
        </div>

        <Button
            size="lg"
            class="w-full sm:w-auto transition-all duration-200 hover:scale-[1.03] bg-slate-600 hover:bg-slate-700 text-white dark:bg-slate-300 dark:hover:bg-slate-200 dark:text-slate-900 font-semibold"
            on:click={handleViewDetails}
            disabled={!game}
        >
            View Game Details
        </Button>
    </div>
</div>

<style>
    .game-row {
        padding: 1.5rem;
        background-color: var(--card);
        border-radius: 1rem;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        border: 1px solid var(--border);
        transition: box-shadow 0.3s ease, transform 0.3s ease;
    }
    .game-row:hover {
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        transform: translateY(-4px);
    }
</style>