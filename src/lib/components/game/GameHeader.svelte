<script lang="ts">
    // CORE IMPORTS
    import type { AnyGame, AnyParticipation } from "$lib/common/game";
    import { onDestroy, onMount, createEventDispatcher } from 'svelte';
    
    // UI COMPONENTS
    import { Button } from "$lib/components/ui/button";
    
    // ICONS
    import { ShieldCheck, Calendar, Trophy, Users, Share2, Edit, CheckSquare, ExternalLink } from 'lucide-svelte';
    
    // UTILITIES
    import { format, formatDistanceToNow } from 'date-fns';
    import { getDisplayStake, getParticipationFee } from "$lib/utils"; // Suponiendo que has movido los helpers a utils

    // --- PROPS & EVENTS ---
    export let game: AnyGame;
    export let participations: AnyParticipation[] = [];
    export let participationIsEnded: boolean;
    export let showCopyMessage: boolean = false;

    const dispatch = createEventDispatcher();

    // --- COMPONENT STATE ---
    let deadlineDateDisplay = "N/A";
    
    // Countdown Clock State
    let daysValue = 0, hoursValue = 0, minutesValue = 0, secondsValue = 0;
    let targetDate: number; // This will be derived from the game object
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;

    // --- LOGIC ---

    // Reactive statement to update display values when the game prop changes
    $: {
        if (game) {
            updateDisplayAndTimers();
        }
    }

    async function updateDisplayAndTimers() {
        if (!game) return;

        // Determine the correct target date and display string based on game status
        if (game.status === 'Active') {
            // block_height_to_timestamp would ideally be a utility function
            // For simplicity here, we'll simulate setting the targetDate if not directly available.
            // In a real app, you would pass the calculated timestamp as a prop.
            // Let's assume deadlineBlock gives us enough info to estimate a date.
            // This part requires an async call that should ideally be done in the parent.
            // For now, we'll pass `targetDate` as a prop if available, or calculate a placeholder.
            // Let's assume a prop named `deadlineTimestamp` is passed for accuracy.
            targetDate = game.deadlineTimestamp; // IMPORTANT: Assumes parent calculates and passes this.
            deadlineDateDisplay = format(new Date(targetDate), "MMM d, yyyy 'at' HH:mm");
        } else if (game.status === 'Resolution') {
            targetDate = game.resolutionTimestamp; // Assumes parent calculates
            deadlineDateDisplay = `Judge period ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
        } else if (game.status === 'Cancelled_Draining') {
            targetDate = game.unlockTimestamp; // Assumes parent calculates
            deadlineDateDisplay = `Stake unlocks ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
        } else {
            deadlineDateDisplay = "N/A";
        }

        cleanupTimers();
        if (!participationIsEnded && game.status === 'Active' && targetDate) {
            clockCountdownInterval = setInterval(updateClockCountdown, 1000);
            updateClockCountdown(); // Initial call
        }
    }
    
    function updateClockCountdown() {
        if (!targetDate) return;
        const diff = targetDate - new Date().getTime();
        if (diff > 0) {
            daysValue = Math.floor(diff / (1000 * 60 * 60 * 24));
            hoursValue = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            minutesValue = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            secondsValue = Math.floor((diff % (1000 * 60)) / 1000);
        } else {
            daysValue = hoursValue = minutesValue = secondsValue = 0;
            if (clockCountdownInterval) clearInterval(clockCountdownInterval);
        }
    }

    function cleanupTimers() {
        if (clockCountdownInterval) clearInterval(clockCountdownInterval);
        clockCountdownInterval = null;
    }

    function shareGame() {
        dispatch('share');
    }

    function formatErg(nanoErg?: bigint | number): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    
    onMount(() => {
        if (game) {
            updateDisplayAndTimers();
        }
    });

    onDestroy(() => {
        cleanupTimers();
    });

</script>

<section class="hero-section relative rounded-xl shadow-2xl overflow-hidden mb-12">
    <div class="hero-bg-image">
        {#if game.content.imageURL}
            <img src={game.content.imageURL} alt="" class="absolute inset-0 w-full h-full object-cover blur-md scale-110" />
        {/if}
        <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/60 to-transparent"></div>
    </div>
    <div class="relative z-10 p-8 md:p-12 flex flex-col md:flex-row gap-8 items-center">
        {#if game.content.imageURL}
        <div class="md:w-1/3 flex-shrink-0">
            <img src={game.content.imageURL} alt="{game.content.title} banner" class="w-full h-auto max-h-96 object-contain rounded-lg shadow-lg">
        </div>
        {/if}
        <div class="flex-1 text-center md:text-left mt-6 md:mt-0 ml-0 md:ml-6">
            <h1 class="text-4xl lg:text-5xl font-bold font-['Russo_One'] mb-3 text-white">{game.content.title}</h1>
            <div class="prose prose-sm text-slate-300 max-w-none mb-6">
                {@html game.content.description?.replace(/\n/g, '<br/>') || 'No description available.'}
            </div>

            <div class="stat-blocks-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 text-white">
                <div class="stat-block">
                    <Edit class="stat-icon"/>
                    <span>{formatErg(getParticipationFee(game))} ERG</span>
                    <span class="stat-label">Fee per Player</span>
                </div>
                <div class="stat-block">
                    <Users class="stat-icon"/>
                    <span>{participations.length}</span>
                    <span class="stat-label">Participants</span>
                </div>
                <div class="stat-block">
                    <Trophy class="stat-icon"/>
                    <span>{formatErg(getParticipationFee(game) * BigInt(participations.length))} ERG</span>
                    <span class="stat-label">Prize Pool</span>
                </div>
                <div class="stat-block">
                    <ShieldCheck class="stat-icon"/>
                    <span>{formatErg(getDisplayStake(game))} ERG</span>
                    <span class="stat-label">Creator Stake</span>
                </div>
                <div class="stat-block">
                    <CheckSquare class="stat-icon"/>
                    <span>{game.status == "Active" ? game.commissionPercentage : ( game.status == "Resolution" ? game.resolverCommission : "N/A")}%</span>
                    <span class="stat-label">Creator Commission</span>
                </div>
                <div class="stat-block">
                    <Calendar class="stat-icon"/>
                    <span>{deadlineDateDisplay.split(' at ')[0]}</span>
                    <a>b.{game.status == "Active" ? game.deadlineBlock : ( game.status == "Resolution" ? game.resolutionDeadline : ( game.status == "Cancelled_Draining" ? game.unlockHeight : "N/A"))}</a>
                    <span class="stat-label">Deadline</span>
                </div>
            </div>

            {#if !participationIsEnded && game.status === 'Active'}
                <div class="countdown-container">
                    <div class="timeleft">
                        <span class="timeleft-label">
                            TIME LEFT
                            <small class="secondary-text">until participation ends</small>
                        </span>
                        <div class="countdown-items">
                            <div class="item"><div>{daysValue}</div><div><h3>Days</h3></div></div>
                            <div class="item"><div>{hoursValue}</div><div><h3>Hours</h3></div></div>
                            <div class="item"><div>{minutesValue}</div><div><h3>Minutes</h3></div></div>
                            <div class="item"><div>{secondsValue}</div><div><h3>Seconds</h3></div></div>
                        </div>
                    </div>
                </div>
            {:else if participationIsEnded && game.status === 'Active'}
                 <div class="countdown-container">
                    <div class="timeleft ended">
                        <span class="timeleft-label">
                            TIME'S UP!
                            <small class="secondary-text">Awaiting resolution...</small>
                        </span>
                    </div>
                </div>
            {/if}

            <div class="mt-8 flex items-center justify-center md:justify-start gap-3">
                {#if game.content.webLink}
                    <a href={game.content.webLink} target="_blank" rel="noopener noreferrer">
                        <Button class="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                            <ExternalLink class="mr-2 h-4 w-4"/>
                            Visit Game Site
                        </Button>
                    </a>
                {/if}

                <Button on:click={shareGame} class="text-sm text-white bg-white/10 backdrop-blur-sm border-none hover:bg-white/20 rounded-lg">
                    <Share2 class="mr-2 h-4 w-4"/>
                    Share Game
                </Button>
                {#if showCopyMessage}
                    <span class="text-xs text-green-400 ml-2 transition-opacity duration-300">Link Copied!</span>
                {/if}
            </div>
        </div>
    </div>
</section>

<style lang="postcss">
    .hero-section {
        min-height: 350px;
        display: flex;
        align-items: center;
    }
    .prose :global(a) {
        @apply text-slate-300 underline hover:text-white;
    }
    .prose :global(p) {
        margin-bottom: 0.75em;
    }
    .stat-block {
        background-color: rgba(255, 255, 255, 0.1);
        -webkit-backdrop-filter: blur(4px);
        backdrop-filter: blur(4px);
        padding: 1rem;
        border-radius: 0.5rem;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
    }
    .stat-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: rgba(255, 255, 255, 0.7);
        margin-bottom: 0.25rem;
    }
    .stat-block span {
        font-size: 1rem;
        line-height: 1.5rem;
        font-weight: 600;
    }
    .stat-label {
        font-size: 0.75rem;
        line-height: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.6);
        font-weight: 400;
    }
    .countdown-container {
        padding-top: 1.5rem;
    }
    .timeleft {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center; 
        gap: 2rem; 
        color: #fff;
    }
    .timeleft-label {
        font-size: 1.25rem;
        font-weight: 600;
        text-align: left;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .secondary-text {
        display: block;
        font-size: 0.875rem;
        font-weight: 400;
        text-transform: none;
        letter-spacing: normal;
        opacity: 0.8;
        margin-top: 0.25rem;
    }
    .countdown-items {
        display: flex;
        justify-content: left;
        flex-wrap: wrap;
        gap: 1rem;
    }
    .item {
        width: 80px;
        height: 80px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background-color: rgba(255, 255, 255, 0.1);
        -webkit-backdrop-filter: blur(4px);
        backdrop-filter: blur(4px);
        border-radius: 0.5rem;
        border: none; 
        transition: all 0.3s ease;
    }
    .item > div:first-child {
        font-size: 2rem;
        font-weight: 700;
        line-height: 1;
    }
    .item > div:last-child > h3 {
        font-size: 0.75rem;
        font-weight: 400;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 0.5rem;
        color: rgba(255, 255, 255, 0.7);
    }
    .timeleft.ended {
        opacity: 0.7;
    }
</style>