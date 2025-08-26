<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { AnyGame } from '$lib/common/game';
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    import { mode } from "mode-watcher";
    import { web_explorer_uri_tx } from '$lib/ergo/envs';

    export let show: boolean = false;
    export let actionType: "submit_score" | "resolve_game" | "cancel_game" | "drain_stake" | "end_game" | "invalidate_winner" | "include_omitted" | null = null;
    export let game: AnyGame;
    export let isSubmitting: boolean = false;
    export let transactionId: string | null = null;
    export let errorMessage: string | null = null;

    const dispatch = createEventDispatcher();

    // Form Inputs - local to the modal
    let commitmentC_input = "";
    let solverId_input = "";
    let hashLogs_input = "";
    let scores_input = "";
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";
    let jsonUploadError: string | null = null;
    
    $: modalTitle = getModalTitle(actionType);

    function getModalTitle(type: typeof actionType) {
        const titles = {
            submit_score: `Submit Score`,
            resolve_game: `Resolve Game`,
            cancel_game: `Cancel Game`,
            drain_stake: `Drain Creator Stake`,
            end_game: `Finalize Game`,
            invalidate_winner: `Judge Invalidation`,
            include_omitted: `Include Omitted Participation`,
        };
        return titles[type] || "Action";
    }

    function closeModal() {
        dispatch('close');
    }

    function handleSubmitScore() {
        if (!scores_input) {
            errorMessage = "Scores cannot be empty.";
            return;
        }
        try {
            const parsedScores = scores_input.split(',').map(s => {
                const trimmed = s.trim();
                if (trimmed === '') throw new Error("Empty score value found.");
                return BigInt(trimmed);
            });

            const payload = {
                scores: parsedScores,
                commitment: commitmentC_input,
                solverId: solverId_input,
                hashLogs: hashLogs_input,
            };
            dispatch('submitScore', payload);
        } catch (e) {
            errorMessage = "Invalid scores format. Please provide comma-separated numbers.";
        }
    }
    
    // Simplified dispatchers for other actions
    const handleResolveGame = () => dispatch('resolveGame', { secret: secret_S_input_resolve });
    const handleCancelGame = () => dispatch('cancelGame', { secret: secret_S_input_cancel });
    const handleDrainStake = () => dispatch('drainStake');
    const handleEndGame = () => dispatch('endGame');
    const handleJudgesInvalidate = () => dispatch('invalidateWinner');
    const handleIncludeOmitted = () => dispatch('includeOmitted');

    async function handleJsonFileUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        jsonUploadError = null;
        if (target.files && target.files[0]) {
            const file = target.files[0];
            if (file.type === "application/json") {
                try {
                    const fileContent = await file.text();
                    const jsonData = JSON.parse(fileContent);
                    if (jsonData.solver_id && typeof jsonData.solver_id === 'string') solverId_input = jsonData.solver_id; else throw new Error("Missing 'solver_id'");
                    if (jsonData.hash_logs_hex && typeof jsonData.hash_logs_hex === 'string') hashLogs_input = jsonData.hash_logs_hex; else throw new Error("Missing 'hash_logs_hex'");
                    if (jsonData.commitment_c_hex && typeof jsonData.commitment_c_hex === 'string') commitmentC_input = jsonData.commitment_c_hex; else throw new Error("Missing 'commitment_c_hex'");
                    if (jsonData.score_list && Array.isArray(jsonData.score_list) && jsonData.score_list.every((item: any) => typeof item === 'number' || typeof item === 'string')) {
                        scores_input = jsonData.score_list.map((s: number | string) => s.toString()).join(', ');
                    } else throw new Error("Missing or invalid 'score_list'");
                } catch (e: any) {
                    jsonUploadError = `Error reading JSON: ${e.message}`;
                    commitmentC_input = ""; solverId_input = ""; hashLogs_input = ""; scores_input = "";
                }
            } else {
                jsonUploadError = "Invalid file type. Please upload a .json file.";
            }
            target.value = ''; // Reset file input
        }
    }
    
    function formatErg(nanoErg?: bigint | number): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

</script>

{#if show && game}
<div class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm" on:click|self={closeModal} role="presentation">
    <div class="modal-content {$mode === 'dark' ? 'bg-slate-800 text-gray-200 border border-slate-700' : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-4xl transform transition-all" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="flex justify-between items-center mb-6">
            <h3 id="modal-title" class="text-2xl font-semibold {$mode === 'dark' ? 'text-slate-400' : 'text-slate-600'}">{modalTitle}</h3>
            <Button variant="ghost" size="icon" on:click={closeModal} aria-label="Close modal" class="{$mode === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800'} -mr-2 -mt-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </Button>
        </div>

         <div class="modal-form-body">
            {#if actionType === 'submit_score'}
                <div class="space-y-4">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
                         <div class="lg:col-span-2">
                            <Label for="jsonFile" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Load Data from JSON File (Optional)</Label>
                            <Input id="jsonFile" type="file" accept=".json" on:change={handleJsonFileUpload} class="w-full text-sm rounded-md shadow-sm border {$mode === 'dark' ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-400' : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'} file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-medium {$mode === 'dark' ? 'file:bg-slate-500 file:text-slate-900 hover:file:bg-slate-400 file:rounded-l-sm' : 'file:bg-gray-200 file:text-gray-700 hover:file:bg-gray-300 file:rounded-l-sm'} cursor-pointer focus-visible:outline-none focus-visible:ring-2 {$mode === 'dark' ? 'focus-visible:ring-slate-500' : 'focus-visible:ring-slate-400'} focus-visible:ring-offset-2 {$mode === 'dark' ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-white'}" />
                            <p class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-600'} mt-1.5">Expected fields: `solver_id`, `hash_logs_hex`, `commitment_c_hex`, `score_list` (array of numbers).</p>
                            {#if jsonUploadError} <p class="text-xs mt-1 {$mode === 'dark' ? 'text-red-400' : 'text-red-600'}">{jsonUploadError}</p> {/if}
                        </div>
                        
                        <div class="lg:col-span-2 flex items-center my-1"><span class="flex-grow border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-300'}"></span><span class="mx-3 text-xs uppercase {$mode === 'dark' ? 'text-slate-500' : 'text-gray-500'}">Or Fill Manually</span><span class="flex-grow border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-300'}"></span></div>
                        
                        <div class="lg:col-span-2">
                            <Label for="commitmentC" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Commitment Code (from game service)</Label>
                            <Textarea id="commitmentC" bind:value={commitmentC_input} rows={3} placeholder="Enter the long hexadecimal commitment code provided by the game service after playing." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" />
                        </div>

                        <div>
                            <Label for="solverId" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Solver ID / Name</Label>
                            <Input id="solverId" type="text" bind:value={solverId_input} placeholder="e.g., my_solver.celaut.bee or YourPlayerName" class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" />
                        </div>

                        <div>
                            <Label for="hashLogs" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Hash of Logs (Hex)</Label>
                            <Input id="hashLogs" type="text" bind:value={hashLogs_input} placeholder="Enter the Blake2b-256 hash of your game logs." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" />
                        </div>
                        
                        <div class="lg:col-span-2">
                            <Label for="scores" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Scores (comma-separated)</Label>
                            <Input id="scores" type="text" bind:value={scores_input} placeholder="e.g., 100, 25, -10, 0" class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" />
                            <p class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-600'} mt-1">Enter a comma-separated list of numerical scores.</p>
                        </div>
                    </div>
                    <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'} pt-2">A participation fee of <strong>{game.status === 'Active' ? formatErg(game.participationFeeNanoErg) : 'N/A'} ERG</strong> will be paid.</p>
                    <Button on:click={handleSubmitScore} disabled={isSubmitting || !commitmentC_input.trim() || !solverId_input.trim() || !hashLogs_input.trim() || !scores_input.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-slate-500 hover:bg-slate-600 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Confirm & Submit Score'}</Button>
                </div>
            {:else if actionType === 'resolve_game'}
                <div class="space-y-4">
                    <div><Label for="secret_S_resolve" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Game Secret (S)</Label><Textarea id="secret_S_resolve" bind:value={secret_S_input_resolve} rows={3} placeholder="Enter the original game secret to decrypt scores and resolve." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                    <Button on:click={handleResolveGame} disabled={isSubmitting || !secret_S_input_resolve.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-slate-600 hover:bg-slate-700 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Resolve Game'}</Button>
                </div>
            {:else if actionType === 'cancel_game'}
                <div class="space-y-4">
                     <div><Label for="secret_S_cancel" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Game Secret (S)</Label><Textarea id="secret_S_cancel" bind:value={secret_S_input_cancel} rows={3} placeholder="Enter the original game secret to initiate cancellation." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                    <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"><strong>Warning:</strong> Cancelling the competition may incur penalties and return funds to participants.</p>
                    <Button on:click={handleCancelGame} disabled={isSubmitting || !secret_S_input_cancel.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Confirm Game Cancellation'}</Button>
                </div>
            {:else if actionType === 'drain_stake'}
                <div class="space-y-4">
                    <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30' : 'bg-orange-100 text-orange-700 border border-orange-200'}">
                        <strong>Action: Drain Stake</strong><br>
                        You are about to claim a portion of the creator's stake from this cancelled game. This action is available periodically as a penalty for the game creator revealing the secret before the deadline.
                    </p>
                    <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'}">
                        This will submit a transaction to the blockchain. No further input is needed.
                    </p>
                    <Button on:click={handleDrainStake} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'} font-semibold">
                        {isSubmitting ? 'Processing...' : 'Confirm & Drain Stake'}
                    </Button>
                </div>
            {:else if actionType === 'end_game'}
                <div class="space-y-4">
                    <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'bg-blue-100 text-blue-700 border border-blue-200'}">
                        <strong>Action: End Game</strong><br>
                        This will finalize the game, distributing the prize pool to the winner, your resolver fee, and other commissions. This action is irreversible.
                    </p>
                    <Button on:click={handleEndGame} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold">
                        {isSubmitting ? 'Processing...' : 'Confirm & End Game'}
                    </Button>
                </div>
            {:else if actionType === 'invalidate_winner'}
                <div class="space-y-4">
                    <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}">
                        <strong>Action: Judge Invalidation</strong><br>
                        As a judge, you are voting to invalidate the current winner candidate. This requires a majority of judges to perform the same action. If successful, the resolution deadline will be extended.
                    </p>
                    <Button on:click={handleJudgesInvalidate} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-yellow-500 hover:bg-yellow-600 text-white'} font-semibold">
                        {isSubmitting ? 'Processing...' : 'Confirm Invalidation Vote'}
                    </Button>
                </div>
            {:else if actionType === 'include_omitted'}
                 <div class="space-y-4">
                    <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-gray-600/20 text-gray-300 border border-gray-500/30' : 'bg-gray-100 text-gray-700 border border-gray-200'}">
                        <strong>Action: Include Omitted Participation</strong><br>
                        All missed entries before the deadline will be selected by default. This will designate you as the new 'resolver' and will allow you to claim the creator's commission when the game ends.
                    </p>
                    <Button on:click={handleIncludeOmitted} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-gray-600 hover:bg-gray-700 text-white' : 'bg-gray-500 hover:bg-gray-600 text-white'} font-semibold">
                        {isSubmitting ? 'Processing...' : 'Confirm Inclusion'}
                    </Button>
                </div>
            {/if}

            {#if transactionId && !isSubmitting}
                <div class="mt-6 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-green-600/30 text-green-300 border border-green-500/50' : 'bg-green-100 text-green-700 border border-green-200'}">
                    <strong>Success! Transaction ID:</strong><br/><a href="{web_explorer_uri_tx + transactionId}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">{transactionId}</a>
                    <p class="mt-2 text-xs">You can close this modal. Data will update after block confirmation.</p>
                </div>
            {/if}
            {#if errorMessage && !isSubmitting}
                <div class="mt-6 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-red-600/30 text-red-300 border border-red-500/50' : 'bg-red-100 text-red-700 border border-red-200'}"><strong>Error:</strong> {errorMessage}</div>
            {/if}
        </div>
    </div>
</div>
{/if}

<style lang="postcss">
    .modal-content {
        animation: fadeInScale 0.2s ease-out forwards;
    }
    @keyframes fadeInScale {
        from { opacity: 0.7; transform: scale(0.98) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
    }
</style>