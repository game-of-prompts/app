<script lang="ts">
    // CORE IMPORTS
    import type { AnyGame, AnyParticipation, GameActive, GameCancellation, GameState, ParticipationSubmitted } from '$lib/common/game';
    import { address, connected } from '$lib/common/store';
    import { get } from 'svelte/store';
    import type { ErgoPlatform } from '$lib/ergo/platform';

    // UI & ICONS
    import { Button } from "$lib/components/ui/button";
    import { ShieldCheck, Trophy } from 'lucide-svelte';
    import { mode } from "mode-watcher";

    // UTILITIES
    import { web_explorer_uri_addr, web_explorer_uri_tx } from '$lib/ergo/envs';
    import { pkHexToBase58Address, parseCollByteToHex, parseLongColl, hexToBytes, bigintToLongByteArray, uint8ArrayToHex } from '$lib/ergo/utils';
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";

    // --- PROPS ---
    export let participation: AnyParticipation;
    export let game: AnyGame;
    export let platform: ErgoPlatform; 
    export let currentHeight: number;

    // --- LOCAL STATE for ASYNC ACTIONS ---
    let isClaimingRefund = false;
    let claimRefundError: string | null = null;
    let claimRefundSuccessTxId: string | null = null;
    
    let isReclaimingGrace = false;
    let reclaimGraceError: string | null = null;
    let reclaimGraceSuccessTxId: string | null = null;

    // --- COMPUTED PROPERTIES ---
    const GRACE_PERIOD_IN_BLOCKS = 720;
    $: connectedAddress = get(address);
    $: playerAddr = pkHexToBase58Address(participation.playerPK_Hex); // <-- FIX IS HERE
    $: isWinner = game.status === 'Resolution' && game.winnerCandidateCommitment === participation.commitmentC_Hex;
    $: isCurrentUser = connectedAddress && connectedAddress === playerAddr;
    $: canClaimRefund = (game.status === 'Cancelled_Draining' || game.status === 'Cancelled_Finalized') && isCurrentUser && !participation.spent;
    $: isGracePeriodOver = game.status === GameState.Active && currentHeight > game.deadlineBlock + GRACE_PERIOD_IN_BLOCKS;
    $: canReclaim = isGracePeriodOver && isCurrentUser && !participation.spent;
    $: actualScore = getActualScore(participation, game);

    // --- LOGIC ---

    function formatErg(nanoErg?: bigint | number): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

    function getActualScore(p: AnyParticipation, g: AnyGame): bigint | null {
        if (g.status !== 'Resolution' || !p.box?.additionalRegisters) return null;
        const secretHex = hexToBytes(g.revealedS_Hex);
        if (!secretHex) return null;

        const commitmentHex = parseCollByteToHex(p.box.additionalRegisters.R5?.renderedValue);
        const solverIdHex = parseCollByteToHex(p.box.additionalRegisters.R7?.renderedValue);
        const hashLogsHex = parseCollByteToHex(p.box.additionalRegisters.R8?.renderedValue);
        const scoreList = parseLongColl(p.box.additionalRegisters.R9?.renderedValue);

        if (!commitmentHex || !solverIdHex || !hashLogsHex || !scoreList || scoreList.length === 0) return null;
        const solverIdBytes = hexToBytes(solverIdHex);
        const hashLogsBytes = hexToBytes(hashLogsHex);
        if (!solverIdBytes || !hashLogsBytes) return null;

        for (const score of scoreList) {
            const scoreBytes = bigintToLongByteArray(score);
            const dataToHash = new Uint8Array([...solverIdBytes, ...scoreBytes, ...hashLogsBytes, ...secretHex]);
            const testCommitment = fleetBlake2b256(dataToHash);
            if (uint8ArrayToHex(testCommitment) === commitmentHex) return score;
        }
        return null;
    }

    async function handleClaimRefund() {
        isClaimingRefund = true;
        claimRefundError = null;
        claimRefundSuccessTxId = null;
        try {
            const txId = await platform.claimAfterCancellation(game as GameCancellation, participation as ParticipationSubmitted);
            claimRefundSuccessTxId = txId;
        } catch (e: any) {
            claimRefundError = e.message || "An unknown error occurred.";
        } finally {
            isClaimingRefund = false;
        }
    }
    
    async function handleReclaimAfterGrace() {
        isReclaimingGrace = true;
        reclaimGraceError = null;
        reclaimGraceSuccessTxId = null;
        try {
            const txId = await platform.reclaimAfterGrace(game as GameActive, participation as ParticipationSubmitted);
            reclaimGraceSuccessTxId = txId;
        } catch (e: any) {
            reclaimGraceError = e.message || "An unknown error occurred.";
        } finally {
            isReclaimingGrace = false;
        }
    }
</script>

<div 
    class="participation-card relative rounded-lg shadow-lg overflow-hidden border {isWinner ? 'winner-card border-green-500/50' : ($mode === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200')}"
>
    {#if isWinner}
        <div class="winner-badge">
            <Trophy class="w-4 h-4 mr-2" />
            <span>WINNER CANDIDATE</span>
        </div>
    {/if}
    
    <div class="card-header p-4 border-b {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
        <div class="flex items-center justify-between">
            <div>
                <div class="text-xs uppercase text-slate-500 dark:text-slate-400">Player Address</div>
                <a href="{web_explorer_uri_addr + playerAddr}" target="_blank" rel="noopener noreferrer" class="font-mono text-sm break-all {$mode === 'dark' ? 'text-slate-300 hover:text-white' : 'text-slate-700 hover:text-black'}" title={playerAddr}>
                    {playerAddr}
                </a>
            </div>
            {#if isCurrentUser}
                <span class="text-xs font-semibold ml-4 px-2 py-1 rounded-full {$mode === 'dark' ? 'bg-blue-500 text-white' : 'bg-blue-200 text-blue-800'}">
                    You
                </span>
            {/if}
        </div>
    </div>

    <div class="card-body p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
        <div class="info-block">
            <span class="info-label">Fee Paid</span>
            <span class="info-value">{formatErg(participation.value)} ERG</span>
        </div>
        <div class="info-block">
            <span class="info-label">Solver ID</span>
            <span class="info-value font-mono text-xs" title={participation.solverId_String || participation.solverId_RawBytesHex}>
                {participation.solverId_String ? (participation.solverId_String.length > 25 ? participation.solverId_String.slice(0,25)+'...' : participation.solverId_String) : (participation.solverId_RawBytesHex.slice(0,20) + '...')}
            </span>
        </div>
        <div class="info-block">
            <span class="info-label">Transaction ID</span>
            <a href="{web_explorer_uri_tx + participation.transactionId}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={participation.transactionId}>
                {participation.transactionId.slice(0, 10)}...{participation.transactionId.slice(-4)}
            </a>
        </div>
        <div class="info-block sm:col-span-2 lg:col-span-3">
            <span class="info-label">Score List</span>
            <div class="font-mono text-xs {$mode === 'dark' ? 'text-lime-400' : 'text-lime-600'}">
                {#if participation.scoreList && participation.scoreList.length > 0}
                    {#each participation.scoreList as score, i}
                        <span class:font-bold={actualScore !== null && score === actualScore} class:opacity-50={actualScore !== null && score !== actualScore}>
                            {score.toString()}
                        </span>{#if i < participation.scoreList.length - 1}<span class="{$mode === 'dark' ? 'text-slate-500' : 'text-gray-400'}">, </span>{/if}
                    {/each}
                    {#if actualScore !== null}
                        <span class="text-xs italic {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} ml-2">
                            (Real Score: {actualScore})
                        </span>
                    {/if}
                {/if}
            </div>
        </div>

        {#if canReclaim}
            <div class="info-block sm:col-span-2 lg:col-span-3 mt-4 pt-4 border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
                <p class="text-xs mb-2 {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                    The game creator failed to resolve the game in time. You can now reclaim your participation fee.
                </p>
                <Button on:click={handleReclaimAfterGrace} disabled={isReclaimingGrace} class="w-full text-base bg-orange-600 hover:bg-orange-700">
                    {isReclaimingGrace ? 'Reclaiming...' : 'Reclaim Participation Fee'}
                </Button>
                {#if reclaimGraceSuccessTxId}
                    <div class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50">
                        <strong>Success! Transaction ID:</strong><br/>
                        <a href="{web_explorer_uri_tx + reclaimGraceSuccessTxId}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">
                            {reclaimGraceSuccessTxId}
                        </a>
                    </div>
                {/if}
                {#if reclaimGraceError}
                    <p class="text-xs mt-1 text-red-400">{reclaimGraceError}</p>
                {/if}
            </div>
        {/if}

        {#if canClaimRefund}
            <div class="info-block sm:col-span-2 lg:col-span-3 mt-2">
                <p class="text-xs mb-2 {$mode === 'dark' ? 'text-blue-400' : 'text-blue-600'}">
                    The game was canceled. Please claim a refund of your participation fee.
                </p>
                <Button on:click={handleClaimRefund} disabled={isClaimingRefund} class="w-full text-base bg-blue-600 hover:bg-blue-700">
                    {isClaimingRefund ? 'Processing...' : 'Claim Refund'}
                </Button>
                {#if claimRefundSuccessTxId}
                     <div class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50">
                        <strong>Success! Transaction ID:</strong><br/>
                        <a href="{web_explorer_uri_tx + claimRefundSuccessTxId}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">
                            {claimRefundSuccessTxId}
                        </a>
                    </div>
                {/if}
                {#if claimRefundError}
                    <p class="text-xs mt-1 text-red-400">{claimRefundError}</p>
                {/if}
            </div>
        {:else if participation.spent && isCurrentUser && (game.status === GameState.Cancelled_Draining || game.status === GameState.Cancelled_Finalized)}
            <div class="info-block sm:col-span-2 lg:col-span-3 mt-2">
                <div class="p-3 rounded-md text-sm text-center {$mode === 'dark' ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600'}">
                    <ShieldCheck class="inline-block mr-2 h-5 w-5 text-green-500"/>
                    Refund has already been requested.
                </div>
            </div>
        {/if}
    </div>
</div>

<style lang="postcss">
    .info-block {
        display: flex;
        flex-direction: column;
    }
    .info-label {
        font-size: 0.75rem;
        line-height: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        @apply text-slate-400 mb-1;
    }
    :global(.light) .info-label {
        @apply text-gray-500;
    }
    .info-value {
        font-weight: 500;
    }
     .winner-card {
        border-width: 1px;
    }
     :global(.dark) .winner-card {
        background-image: linear-gradient(to top right, rgba(16, 185, 129, 0.15), rgba(16, 185, 129, 0));
    }
    :global(.light) .winner-card {
        background-image: linear-gradient(to top right, rgba(4, 120, 87, 0.1), rgba(5, 150, 105, 0));
    }
    .winner-badge {
        position: absolute;
        top: 0px;
        right: 0px;
        display: flex;
        align-items: center;
        padding: 0.25rem 1rem;
        font-size: 0.875rem;
        font-weight: 700;
        color: rgb(255 255 255);
        border-bottom-left-radius: 0.5rem;
        background: linear-gradient(135deg, #10B981, #059669);
    }
</style>