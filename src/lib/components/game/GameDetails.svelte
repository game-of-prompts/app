<script lang="ts">
    // CORE IMPORTS
    import { 
        type AnyGame,
        type AnyParticipation,
        type GameActive,
        type GameCancellation,
        type ParticipationSubmitted,
        type ParticipationResolved,
        GameState, 
        iGameDrainingStaking
    } from "$lib/common/game";
    import { address, connected, game_detail } from "$lib/common/store";
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { fetchSubmittedParticipations, fetchResolvedParticipations } from "$lib/ergo/fetch";
    
    // CHILD COMPONENTS
    import GameHeader from '$lib/components/game/GameHeader.svelte';
    import GameInfo from '$lib/components/game/GameInfo.svelte';
    import GameActions from '$lib/components/game/GameActions.svelte';
    import ParticipationList from '$lib/components/game/ParticipationList.svelte';
    import ActionModal from '$lib/components/game/ActionModal.svelte';
    
    // UTILITIES
    import { ErgoAddress } from "@fleet-sdk/core";
    import { uint8ArrayToHex } from "$lib/ergo/utils";
    import { mode } from "mode-watcher";
    import { isGameEnded, isGameParticipationEnded } from '$lib/common/game';

    // --- STATE MANAGEMENT ---
    let game: AnyGame | null = null;
    let platform = new ErgoPlatform();
    let participations: AnyParticipation[] = [];
    let currentHeight: number = 0; 
    
    // UI State
    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let isSubmitting: boolean = false;
    let showCopyMessage = false;
    
    // Game Status State
    let isOwner = false, isResolver = false, isJudge = false;
    let targetDate: number; // La fecha objetivo para la cuenta atrás, calculada en el padre.
    let participationIsEnded = true;

    // Modal State
    let showActionModal = false;
    let currentActionType: "submit_score" | "resolve_game" | "cancel_game" | "drain_stake" | "end_game" | "invalidate_winner" | "include_omitted" | null = null;

    // --- LOGIC ---

    const unsubscribeGameDetail = game_detail.subscribe(value => {
        const typedValue = value as AnyGame | null;
        if (typedValue && (!game || typedValue.boxId !== game.boxId)) {
            game = typedValue;
            loadGameDetailsAndTimers();
        } else if (!typedValue && game) {
            game = null;
        }
    });

    async function loadGameDetailsAndTimers() {
        if (!game) return;

        isSubmitting = false;
        transactionId = null; 
        errorMessage = null;
        try {
            currentHeight = await platform.get_current_height();
            participationIsEnded = await isGameParticipationEnded(game);

            // --- CORRECCIÓN DE PARTICIPACIONES ---
            // Se añaden los estados finales para asegurar que las participaciones siempre se carguen.
            if (game.status === GameState.Active) {
                participations = await fetchSubmittedParticipations(game.gameId);
            } else if (game.status === GameState.Resolution || game.status === GameState.Ended) {
                participations = await fetchResolvedParticipations(game.gameId);
            } else if (game.status === GameState.Cancelled_Draining) {
                participations = await fetchSubmittedParticipations(game.gameId);
            } else {
                participations = []; // Asegurarse de limpiar si no hay estado conocido
            }

            const connectedAddress = get(address);
            if(get(connected) && connectedAddress && game) {
                let creatorPK: string | undefined;
                isOwner = false;
                isResolver = false;
                isJudge = false;
                const userPKBytes = ErgoAddress.fromBase58(connectedAddress).getPublicKeys()[0];
                const userPKHex = userPKBytes ? uint8ArrayToHex(userPKBytes) : null;

                if (game.status === 'Active') { creatorPK = game.gameCreatorPK_Hex; }
                else if (game.status === 'Resolution') {
                    creatorPK = game.originalCreatorPK_Hex;
                    if(userPKHex) {
                        isResolver = userPKHex === game.resolverPK_Hex;
                    }
                }
                if (creatorPK && userPKHex) {
                    isOwner = userPKHex === creatorPK;
                }
            }

        } catch (error: any) {
            errorMessage = "Could not load game details: " + (error.message || "Unknown error");
        }
    }
    
    // --- EVENT HANDLERS from children ---
    
    function handleOpenModal(event: CustomEvent<string>) {
        currentActionType = event.detail as any;
        errorMessage = null;
        transactionId = null;
        isSubmitting = false;
        showActionModal = true;
    }

    function handleCloseModal() {
        showActionModal = false;
        currentActionType = null;
    }

    async function handleSubmitScore(event: CustomEvent) {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            const { scores, commitment, solverId, hashLogs } = event.detail;
            transactionId = await platform.submitScoreToGopGame(game, scores, commitment, solverId, hashLogs);
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    async function handleResolveGame(event: CustomEvent) {
        if (game?.status !== 'Active' || participations.some(p => p.status !== 'Submitted')) return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.resolveGame(game, participations as ParticipationSubmitted[], event.detail.secret);
        } catch (e: any) { errorMessage = e.message; } finally { isSubmitting = false; }
    }

    async function handleCancelGame(event: CustomEvent) {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.cancel_game(game, event.detail.secret, get(address) ?? "");
        } catch (e: any) { errorMessage = e.message; } finally { isSubmitting = false; }
    }

    async function handleDrainStake() {
        if (!iGameDrainingStaking(game)) return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.drain_cancelled_game_stake(game, get(address) ?? "");
        } catch (e: any) { errorMessage = e.message || "Error draining stake.";
        } finally { isSubmitting = false; }
    }

    async function handleEndGame() {
        if (game?.status !== 'Resolution' || !participations.length) return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.endGame(game, participations as ParticipationResolved[]);
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    async function handleJudgesInvalidate() {
        if (game?.status !== 'Resolution') return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.judgesInvalidate(game, participations as ParticipationResolved[]);
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    async function handleIncludeOmitted() {
        if (game?.status !== 'Resolution') return;
        errorMessage = null; isSubmitting = true;
        try {
            const userAddress = get(address);
            if (!userAddress) throw new Error("Wallet not connected.");
            
            const newResolverPkHex = uint8ArrayToHex(ErgoAddress.fromBase58(userAddress).getPublicKeys()[0]);
            transactionId = await platform.includeOmittedParticipations(game, [], participations as ParticipationResolved[], newResolverPkHex);
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    function shareGame() {
        if (!game) return;
        const urlToCopy = `${window.location.origin}/web/?game=${game.gameId}`;
        navigator.clipboard.writeText(urlToCopy).then(() => {
            showCopyMessage = true; setTimeout(() => { showCopyMessage = false; }, 2500);
        }).catch(err => console.error('Failed to copy game URL: ', err));
    }

    onMount(() => { if (game) loadGameDetailsAndTimers(); });
    onDestroy(() => {
        unsubscribeGameDetail();
    });
</script>

{#if game}
    <div class="game-detail-page min-h-screen {$mode === 'dark' ? 'bg-slate-900 text-gray-200' : 'bg-gray-50 text-gray-800'}">
        <GameHeader 
            {game} 
            {participations} 
            {targetDate} 
            {participationIsEnded}
            on:share={shareGame}
            bind:showCopyMessage
        />

        <div class="game-container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <GameInfo {game} {isOwner} />

            <GameActions 
                {game} 
                connected={$connected} 
                {participationIsEnded}
                {isOwner} 
                {isResolver} 
                {isJudge}
                {targetDate}
                on:openModal={handleOpenModal}
            />

            <ParticipationList 
                {participations}
                {game}
                {platform} {currentHeight}
            />
        </div>

        <ActionModal 
            show={showActionModal}
            actionType={currentActionType}
            {game}
            {isSubmitting}
            {transactionId}
            {errorMessage}
            on:close={handleCloseModal}
            on:submitScore={handleSubmitScore}
            on:resolveGame={handleResolveGame}
            on:cancelGame={handleCancelGame}
            on:drainStake={handleDrainStake}
            on:endGame={handleEndGame}
            on:invalidateWinner={handleJudgesInvalidate}
            on:includeOmitted={handleIncludeOmitted}
        />
    </div>
{:else}
    <div class="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] {$mode === 'dark' ? 'text-gray-500' : 'text-gray-500'} p-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="8" y1="16" x2="8" y2="16"></line><line x1="8" y1="12" x2="8" y2="12"></line><line x1="8" y1="8" x2="8" y2="8"></line><line x1="12" y1="16" x2="12" y2="16"></line><line x1="12" y1="12" x2="12" y2="12"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
        <p class="text-xl font-medium">No game selected.</p>
        <p class="text-sm">Please choose a game from the list to see its details, or check if it's still loading.</p>
    </div>
{/if}

<style lang="postcss">
    .game-detail-page {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
</style>