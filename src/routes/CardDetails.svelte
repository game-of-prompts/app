<script lang="ts">
    // CORE IMPORTS
    import { type Game, isGameParticipationEnded, type Participation } from "$lib/common/game";
    import { address, connected, game_detail } from "$lib/common/store";
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';

    // UI COMPONENTS
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";

    // ICONS
    import { ShieldCheck, Calendar, Trophy, Users } from 'lucide-svelte';

    // UTILITIES
    import { block_height_to_timestamp, block_to_time_remaining } from "$lib/common/countdown";
    import { web_explorer_uri_tkn, web_explorer_uri_tx, web_explorer_uri_addr } from '$lib/ergo/envs';
    import { ErgoAddress } from "@fleet-sdk/core";
    import { uint8ArrayToHex, hexToBytes, parseCollByteToHex, parseLongColl, bigintToLongByteArray } from "$lib/ergo/utils";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { mode } from "mode-watcher";

    // --- COMPONENT STATE ---

    interface WinnerInfo {
        playerAddress: string;
        playerPK_Hex?: string;
        score: bigint | number | string;
        participationBoxId?: string;
    }

    let game: Game & { winnerInfo?: WinnerInfo; secret?: string } | null = null;

    // Subscribes to the global store to get game details
    const unsubscribeGameDetail = game_detail.subscribe(value => {
        const typedValue = value as Game & { winnerInfo?: WinnerInfo; secret?: string } | null;
        if (typedValue && (!game || typedValue.boxId !== game.boxId || typedValue.ended !== game.ended || typedValue.secret !== game.secret)) {
            game = typedValue;
            loadGameDetailsAndTimers();
        } else if (!typedValue && game) {
            game = null;
            cleanupTimers();
        }
    });

    let platform = new ErgoPlatform();

    // UI State
    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let isSubmitting: boolean = false;
    let showCopyMessage = false;

    // Game Status State
    let participationIsEnded = true;
    let deadlineDateDisplay = "N/A";
    let timeRemainingDisplay = "Loading...";
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let isOwner = false;
    $: isCurrentUserWinner = !!(game?.ended && game?.winnerInfo && $connected && $address && game.winnerInfo.playerAddress === $address);

    // Modal State
    let showActionModal = false;
    let currentActionType: "submit_score" | "resolve_game" | "cancel_game" | null = null;
    let modalTitle = "";

    // Form Inputs
    let commitmentC_input = "";
    let solverId_input = "";
    let hashLogs_input = "";
    let scores_input = "";
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";


    // --- LOGIC FUNCTIONS ---

    // Converts a public key hex string to a Base58 address string.
    function pkHexToBase58Address(pkHex: string | undefined | null): string {
        if (!pkHex) return "N/A";
        if (typeof pkHex !== 'string' || !/^[0-9a-fA-F]+$/.test(pkHex)) return "Invalid PK Hex";
        const pkBytes = hexToBytes(pkHex);
        if (!pkBytes) return "Error Addr (Conv)";
        try {
            return ErgoAddress.fromPublicKey(pkBytes).toString();
        } catch (e) { return "Error Addr (Fleet)"; }
    }

    // Main function to load and process all game details when the component receives a new game.
    async function loadGameDetailsAndTimers() {
        if (!game) { /* Reset state if no game */ return; }
        // Reset dynamic state
        isSubmitting = false; transactionId = null; errorMessage = null; jsonUploadError = null;

        try {
            // Determine participation status
            participationIsEnded = game.ended ? true : await isGameParticipationEnded(game);

            // Format deadline for display
            const deadlineTimestamp = await block_height_to_timestamp(game.deadlineBlock, game.platform);
            const date = new Date(deadlineTimestamp);
            deadlineDateDisplay = `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric'})} at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

            await updateCountdownDisplayLogic();

            // Set up a countdown timer only if the game is active
            if (!game.ended && !participationIsEnded) {
                cleanupTimers();
                countdownInterval = setInterval(updateCountdownDisplayLogic, 30000);
            } else {
                cleanupTimers();
            }

            // Check if the connected user is the owner of the game
            const connectedAddressString = get(address);
            if (get(connected) && connectedAddressString && game.gameCreatorPK_Hex) {
                try {
                    const ergoAddressInstance = ErgoAddress.fromBase58(connectedAddressString);
                    const pkBytes = ergoAddressInstance.getPublicKeys()?.[0];
                    const currentPKS = pkBytes ? uint8ArrayToHex(pkBytes).toLowerCase() : null;
                    isOwner = !!(currentPKS && game.gameCreatorPK_Hex.toLowerCase() === currentPKS);
                } catch (e) { isOwner = false; }
            } else {
                isOwner = false;
            }

        } catch (error: any) {
            errorMessage = "Could not load game details: " + (error.message || "Unknown error");
            timeRemainingDisplay = "Error";
        }
    }

    // Updates the countdown display string periodically.
    async function updateCountdownDisplayLogic() {
        if (!game) { timeRemainingDisplay = "N/A"; cleanupTimers(); return; }
        if (game.ended) { timeRemainingDisplay = "Resolved"; participationIsEnded = true; cleanupTimers(); return; }
        if (participationIsEnded) { timeRemainingDisplay = "Awaiting Resolution"; cleanupTimers(); return; }

        try {
            timeRemainingDisplay = await block_to_time_remaining(game.deadlineBlock, game.platform);
            const newParticipationStatus = await isGameParticipationEnded(game);
            if (newParticipationStatus && !participationIsEnded) {
                participationIsEnded = true;
                timeRemainingDisplay = "Awaiting Resolution";
                cleanupTimers();
            }
        } catch (error) {
            timeRemainingDisplay = "Error updating time";
        }
    }

    function cleanupTimers() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
    }

    // Lifecycle hooks
    onMount(() => { if (game) loadGameDetailsAndTimers(); });
    onDestroy(() => { cleanupTimers(); unsubscribeGameDetail(); });

    // Validates and returns the actual score from a participation's score list
    function getActualScore(p: Participation, secretHex: Uint8Array | undefined): bigint | null {
        if (!p.box || !p.box.additionalRegisters || !secretHex) return null;
        const pBox_R5_commitmentHex = parseCollByteToHex(p.box.additionalRegisters.R5?.renderedValue);
        const pBox_R7_solverIdHex_raw = parseCollByteToHex(p.box.additionalRegisters.R7?.renderedValue);
        const pBox_R8_hashLogsHex_raw = parseCollByteToHex(p.box.additionalRegisters.R8?.renderedValue);
        let r9ParsedArray: any[] | null = null;
        const r9ScoreListRaw = p.box.additionalRegisters.R9?.renderedValue;
        if (typeof r9ScoreListRaw === 'string') {
            try { r9ParsedArray = JSON.parse(r9ScoreListRaw); } catch (e) { /* silent fail */ }
        } else if (Array.isArray(r9ScoreListRaw)) { r9ParsedArray = r9ScoreListRaw; }
        const pBox_scoreList = parseLongColl(r9ParsedArray);

        if (!pBox_R5_commitmentHex || !pBox_R7_solverIdHex_raw || !pBox_R8_hashLogsHex_raw || !pBox_scoreList || pBox_scoreList.length === 0) return null;

        const pBoxSolverId_directBytes = hexToBytes(pBox_R7_solverIdHex_raw);
        const pBoxHashLogs_directBytes = hexToBytes(pBox_R8_hashLogsHex_raw);
        if (!pBoxSolverId_directBytes || !pBoxHashLogs_directBytes) return null;

        for (const scoreAttempt of pBox_scoreList) {
            const scoreAttempt_bytes = bigintToLongByteArray(scoreAttempt);
            const dataToHash = new Uint8Array([...pBoxSolverId_directBytes, ...scoreAttempt_bytes, ...pBoxHashLogs_directBytes, ...secretHex]);
            const testCommitmentBytes = fleetBlake2b256(dataToHash);
            if (uint8ArrayToHex(testCommitmentBytes) === pBox_R5_commitmentHex) return scoreAttempt;
        }
        return null;
    }

    // --- (Event Handlers & Action Functions are unchanged) ---
    function setupSubmitScore() { /* ... */ }
    function setupResolveGame() { /* ... */ }
    async function handleSubmitScore() { /* ... */ }
    async function handleResolveGame() { /* ... */ }
    function closeModal() { /* ... */ }
    function formatErg(nanoErg: bigint | number | undefined): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 9 });
    }
</script>

{#if game}
<div class="game-detail-page {$mode === 'dark' ? 'bg-slate-900 text-gray-200' : 'bg-gray-50 text-gray-800'} min-h-screen">
    <div class="game-container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

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
                    <img src={game.content.imageURL} alt="{game.content.title} banner" class="w-full h-auto object-contain rounded-lg shadow-lg">
                </div>
                {/if}
                <div class="flex-1 text-center md:text-left">
                    <h1 class="text-4xl lg:text-5xl font-bold font-['Russo_One'] mb-3 text-white">{game.content.title}</h1>
                    <p class="prose prose-sm text-slate-300 max-w-none mb-6">
                        {@html game.content.description?.replace(/\n/g, '<br/>') || 'No description available.'}
                    </p>
                    <div class="stat-blocks-grid grid grid-cols-2 lg:grid-cols-4 gap-4 text-white">
                        <div class="stat-block"><Trophy class="stat-icon"/><span>{formatErg(game.participationFeeNanoErg)} ERG</span><span class="stat-label">Participation Fee</span></div>
                        <div class="stat-block"><ShieldCheck class="stat-icon"/><span>{formatErg(game.creatorStakeNanoErg)} ERG</span><span class="stat-label">Creator Stake</span></div>
                        <div class="stat-block"><Users class="stat-icon"/><span>{game.commissionPercentage}%</span><span class="stat-label">Creator Commission</span></div>
                        <div class="stat-block"><Calendar class="stat-icon"/><span>{deadlineDateDisplay}</span><span class="stat-label">Deadline</span></div>
                    </div>
                </div>
            </div>
        </section>

        <section class="status-actions-panel grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 p-8 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
            <div class="status-side">
                <h2 class="text-2xl font-semibold mb-3">Game Status</h2>
                {#if game.ended}
                    <p class="text-xl font-medium {$mode === 'dark' ? 'text-blue-400' : 'text-blue-600'}">Game Ended & Resolved</p>
                    {#if isCurrentUserWinner}
                        <p class="mt-2 text-lg font-semibold {$mode === 'dark' ? 'text-green-300' : 'text-green-600'}">🎉 Congratulations, You are the Winner! 🎉</p>
                    {/if}
                    {#if game.winnerInfo}
                        <div class="mt-2 space-y-1 text-sm {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">
                            <p><strong>Winner:</strong> <a href="{web_explorer_uri_addr + game.winnerInfo.playerAddress}" target="_blank" class="font-mono underline">...{game.winnerInfo.playerAddress.slice(-10)}</a></p>
                            <p><strong>Winning Score:</strong> {game.winnerInfo.score.toString()}</p>
                        </div>
                    {/if}
                {:else}
                    <p class="text-xl font-medium {participationIsEnded ? ($mode === 'dark' ? 'text-yellow-400' : 'text-yellow-600') : ($mode === 'dark' ? 'text-green-400' : 'text-green-600')}">
                        {participationIsEnded ? 'Participation Closed' : 'Open for Participation'}
                    </p>
                    <p class="text-lg font-semibold {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'} mt-1">{timeRemainingDisplay}</p>
                {/if}
            </div>
            <div class="actions-side md:border-l {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'} md:pl-8">
                <h2 class="text-2xl font-semibold mb-4">Available Actions</h2>
                <div class="space-y-3">
                    {#if game.ended}
                        <p class="info-box">This game has been resolved.</p>
                    {:else if $connected}
                        {#if !participationIsEnded}
                            <Button on:click={setupSubmitScore} class="w-full py-3 text-base">Submit My Score</Button>
                        {/if}
                        {#if isOwner && participationIsEnded}
                            <Button on:click={setupResolveGame} class="w-full py-3 text-base">Resolve Game</Button>
                        {/if}
                        {#if participationIsEnded && !isOwner}
                             <p class="info-box">Waiting for the creator to resolve.</p>
                        {/if}
                    {:else}
                        <p class="info-box">Connect your wallet to interact.</p>
                    {/if}
                </div>
            </div>
        </section>

        {#if game.participations && game.participations.length > 0}
            <section class="participations-section">
                <h2 class="text-3xl font-semibold mb-8 text-center">
                    Participations <span class="text-lg font-normal text-slate-500">({game.participations.length})</span>
                </h2>
                <div class="flex flex-col gap-6">
                    {#each game.participations as p (p.boxId)}
                        {@const isCurrentParticipationWinner = game.ended && game.winnerInfo && (p.boxId === game.winnerInfo.participationBoxId || (game.winnerInfo.playerPK_Hex && p.playerPK_Hex === game.winnerInfo.playerPK_Hex) || pkHexToBase58Address(p.playerPK_Hex) === game.winnerInfo.playerAddress)}
                        {@const actualScoreForThisParticipation = game.ended && game.secret ? getActualScore(p, game.secret) : null}

                        <div class="participation-card relative rounded-lg shadow-lg overflow-hidden border
                            {isCurrentParticipationWinner
                                ? 'winner-card border-green-500/50'
                                : ($mode === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200')}">

                            {#if isCurrentParticipationWinner}
                                <div class="winner-badge">
                                    <Trophy class="w-4 h-4 mr-2" />
                                    <span>WINNER</span>
                                </div>
                            {/if}

                            <div class="card-header p-4 border-b {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
                                <div class="flex items-center justify-between">
                                    <div>
                                        <div class="text-xs uppercase text-slate-500 dark:text-slate-400">Player Address</div>
                                        <a href="{web_explorer_uri_addr + pkHexToBase58Address(p.playerPK_Hex)}" target="_blank" rel="noopener noreferrer" class="font-mono text-sm break-all {$mode === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-700 hover:text-black'}" title={pkHexToBase58Address(p.playerPK_Hex)}>
                                            {pkHexToBase58Address(p.playerPK_Hex)}
                                        </a>
                                    </div>
                                    {#if $connected && $address === pkHexToBase58Address(p.playerPK_Hex)}
                                        <span class="text-xs font-semibold ml-4 px-2 py-1 rounded-full {$mode === 'dark' ? 'bg-blue-500 text-white' : 'bg-blue-200 text-blue-800'}">You</span>
                                    {/if}
                                </div>
                            </div>

                            <div class="card-body p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                                <div class="info-block">
                                    <span class="info-label">Fee Paid</span>
                                    <span class="info-value">{formatErg(p.value)} ERG</span>
                                </div>
                                <div class="info-block lg:col-span-2">
                                    <span class="info-label">Solver ID</span>
                                    <span class="info-value font-mono text-xs" title={p.solverId_String || p.solverId_RawBytesHex}>
                                        {p.solverId_String || p.solverId_RawBytesHex.slice(0, 20) + '...'}
                                    </span>
                                </div>
                                <div class="info-block sm:col-span-2 lg:col-span-3">
                                    <span class="info-label">Score List</span>
                                    <div class="font-mono text-xs {$mode === 'dark' ? 'text-lime-400' : 'text-lime-600'}">
                                        {#if p.scoreList && p.scoreList.length > 0}
                                            {#each p.scoreList as score, i}
                                                <span class:font-bold={actualScoreForThisParticipation !== null && score === actualScoreForThisParticipation}
                                                      class:opacity-50={actualScoreForThisParticipation !== null && score !== actualScoreForThisParticipation}>
                                                    {score.toString()}
                                                </span>{#if i < p.scoreList.length - 1}<span class="{$mode === 'dark' ? 'text-slate-500' : 'text-gray-400'}">, </span>{/if}
                                            {/each}
                                            {#if actualScoreForThisParticipation !== null}
                                                <span class="text-xs italic {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} ml-2">
                                                    (Actual Score: {actualScoreForThisParticipation.toString()})
                                                </span>
                                            {/if}
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            </section>
        {/if}
    </div>

    {#if showActionModal}
        {/if}
</div>
{/if}

<style lang="postcss">
    /* General styles for the detail page */
    .game-detail-page {
        @apply py-8;
    }

    /* Hero Section Styles */
    .hero-section {
        min-height: 400px;
        display: flex;
        align-items: center;
    }
    .prose :global(a) {
        @apply text-slate-300 underline hover:text-white;
    }
    .dark .prose :global(a) {
        @apply text-slate-400 hover:text-slate-300;
    }

    /* Stat Blocks Styles */
    .stat-block {
        @apply bg-white/10 backdrop-blur-sm p-4 rounded-lg text-center flex flex-col items-center justify-center gap-1;
    }
    .stat-icon {
        @apply w-6 h-6 text-white/70 mb-1;
    }
    .stat-block span {
        @apply text-lg font-bold;
    }
    .stat-label {
        @apply text-xs uppercase tracking-wider text-white/60 font-normal;
    }

    /* Info box for status messages */
    .info-box {
        @apply text-sm text-center p-3 rounded-md;
        background-color: hsl(var(--muted));
        color: hsl(var(--muted-foreground));
    }

    /* --- NEW STYLES FOR PARTICIPATION CARD --- */
    .info-block {
        @apply flex flex-col;
    }
    .info-label {
        @apply text-xs uppercase text-slate-500 dark:text-slate-400 mb-1 tracking-wider;
    }
    .info-value {
        @apply text-sm font-semibold text-slate-700 dark:text-slate-200;
    }

    .winner-card {
        @apply border-2;
        background-image: linear-gradient(to top right,
            rgba(4, 120, 87, 0.1),
            rgba(5, 150, 105, 0)
        );
    }
    .dark .winner-card {
        background-image: linear-gradient(to top right,
            rgba(16, 185, 129, 0.15),
            rgba(16, 185, 129, 0)
        );
    }

    .winner-badge {
        @apply absolute top-0 right-0 flex items-center px-4 py-1 text-sm font-bold text-white rounded-bl-lg;
        background: linear-gradient(135deg, #10B981, #059669);
    }
</style>