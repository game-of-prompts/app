<script lang="ts">
	import type { AnyGame } from '$lib/common/game';
    import { createEventDispatcher } from 'svelte';
	import { Button } from '$lib/components/ui/button';
    import { Edit, XCircle, CheckSquare, Trophy, Users } from 'lucide-svelte';
    import { mode } from 'mode-watcher';
    import { iGameDrainingStaking, isGameDrainingAllowed } from '$lib/common/game';

    export let game: AnyGame;
    export let connected: boolean;
    export let participationIsEnded: boolean;
    export let isOwner: boolean;
    export let isResolver: boolean;
    export let isJudge: boolean;
    export let targetDate: number;

    const dispatch = createEventDispatcher();

    function openModal(actionType: string) {
        dispatch('openModal', actionType);
    }
</script>

<section class="game-status status-actions-panel grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 p-6 md:p-8 shadow rounded-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
    <div class="status-side">
        <h2 class="text-2xl font-semibold mb-3">Status</h2>
        {#if game.status === 'Active' && !participationIsEnded}
            <p class="text-xl font-medium text-green-500">Open for Participation</p>
        {:else if game.status === 'Active' && participationIsEnded}
            <p class="text-xl font-medium text-yellow-500">Awaiting Resolution</p>
        {:else if game.status === 'Resolution'}
            <p class="text-xl font-medium text-blue-500">Resolving Winner</p>
        {:else if game.status === 'Cancelled_Draining'}
            <p class="text-xl font-medium text-red-500">Cancelled - Draining Stake</p>
        {:else}
            <p class="text-xl font-medium text-gray-500">Game Over</p>
        {/if}
        <p class="text-xs {$mode === 'dark' ? 'text-slate-500' : 'text-gray-500'} mt-1">Contract Status: {game.status}</p>
    </div>

    <div class="actions-side md:border-l {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'} md:pl-8">
        <h2 class="text-2xl font-semibold mb-4">Available Actions</h2>
        <div class="space-y-4">
            {#if connected}
                {#if game.status === 'Active' && !participationIsEnded}
                    <Button on:click={() => openModal('submit_score')} class="w-full">
                        <Edit class="mr-2 h-4 w-4"/>Submit My Score
                    </Button>
                    <Button on:click={() => openModal('cancel_game')} variant="destructive" class="w-full">
                        <XCircle class="mr-2 h-4 w-4"/>Cancel Competition
                    </Button>
                {/if}

                {#if game.status === 'Active' && participationIsEnded && isOwner}
                    <Button on:click={() => openModal('resolve_game')} class="w-full">
                        <CheckSquare class="mr-2 h-4 w-4"/>Resolve Competition
                    </Button>
                {/if}

                {#if game.status === 'Resolution'}
                    {@const isBeforeDeadline = new Date().getTime() < targetDate}
                    
                    {#if isResolver}
                        <Button on:click={() => openModal('end_game')} disabled={isBeforeDeadline} class="w-full">
                            <Trophy class="mr-2 h-4 w-4"/> End Competition & Distribute Prizes
                        </Button>
                    {/if}

                    <Button 
                        on:click={() => openModal('include_omitted')} 
                        disabled={!isBeforeDeadline} 
                        variant="outline" 
                        class="w-full"
                        title="Cualquiera puede ejecutar esta acción para reclamar la comisión del resolver.">
                        <Users class="mr-2 h-4 w-4"/> Include Omitted Participations
                    </Button>

                    {#if isJudge}
                        <Button on:click={() => openModal('invalidate_winner')} disabled={!isBeforeDeadline} variant="destructive" class="w-full">
                            <XCircle class="mr-2 h-4 w-4"/> Judges: Invalidate Winner
                        </Button>
                    {/if}
                {/if}

                {#if iGameDrainingStaking(game)}
                    <div class="p-3 rounded-lg border {$mode === 'dark' ? 'border-yellow-500/30 bg-yellow-600/20' : 'border-yellow-200 bg-yellow-100'}">
                        {#await isGameDrainingAllowed(game) then isAllowed}
                            <Button on:click={() => openModal('drain_stake')} disabled={!isAllowed} class="w-full">
                                <Trophy class="mr-2 h-4 w-4"/>Drain Creator Stake
                            </Button>
                        {/await}
                    </div>
                {/if}
            {:else}
                <p class="info-box">Connect your wallet to interact with the game competition.</p>
            {/if}
        </div>
    </div>
</section>

<style lang="postcss">
    .info-box {
        @apply text-sm text-center p-3 rounded-md bg-slate-500/50;
    }
    :global(.light) .info-box {
        @apply bg-gray-100 text-black;
    }
</style>