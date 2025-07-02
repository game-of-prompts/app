<script lang="ts">
    import { type Game, isGameParticipationEnded, type Participation } from "$lib/common/game";
    import { address, connected, game_detail, balance } from "$lib/common/store";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    import { block_height_to_timestamp, block_to_time_remaining } from "$lib/common/countdown";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { web_explorer_uri_tkn, web_explorer_uri_tx, web_explorer_uri_addr } from '$lib/ergo/envs';
    import { ErgoAddress } from "@fleet-sdk/core";
    import {
        uint8ArrayToHex,
        hexToBytes,
        parseCollByteToHex,
        parseLongColl,
        bigintToLongByteArray
    } from "$lib/ergo/utils";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { mode } from "mode-watcher";
    import { get } from "svelte/store";
    import { onDestroy, onMount } from 'svelte';

    interface WinnerInfo {
        playerAddress: string;
        playerPK_Hex?: string;
        score: bigint | number | string;
        participationBoxId?: string;
    }

    let game: Game & { winnerInfo?: WinnerInfo; secret?: string } | null = null;
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

    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let isSubmitting: boolean = false;
    let showCopyMessage = false;

    let participationIsEnded = true;
    let deadlineDateDisplay = "N/A";
    let timeRemainingDisplay = "N/A";
    let countdownInterval: ReturnType<typeof setInterval> | null = null;
    let isOwner = false;

    let isCurrentUserWinner = false;
    $: isCurrentUserWinner = !!(game?.ended && game?.winnerInfo && $connected && $address && game.winnerInfo.playerAddress === $address);

    let showActionModal = false;
    let currentActionType: "submit_score" | "resolve_game" | "cancel_game" | null = null;
    let modalTitle = "";

    let commitmentC_input = "";
    let solverId_input = "";
    let hashLogs_input = "";
    let scores_input = "";
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";

    function pkHexToBase58Address(pkHex: string | undefined | null): string {
        if (!pkHex) return "N/A";
        if (typeof pkHex !== 'string' || !/^[0-9a-fA-F]+$/.test(pkHex)) return "Invalid PK Hex";
        const pkBytes = hexToBytes(pkHex);
        if (!pkBytes) return "Error Addr (Conv)";
        try {
            return ErgoAddress.fromPublicKey(pkBytes).toString();
        } catch (e) { return "Error Addr (Fleet)"; }
    }

    async function loadGameDetailsAndTimers() {
        if (!game) {
            participationIsEnded = true;
            deadlineDateDisplay = "N/A";
            timeRemainingDisplay = "N/A";
            isOwner = false;
            isCurrentUserWinner = false;
            cleanupTimers();
            return;
        }

        isSubmitting = false;
        transactionId = null;
        errorMessage = null;
        jsonUploadError = null;

        try {
            if (game.ended) {
                participationIsEnded = true;
            } else {
                participationIsEnded = await isGameParticipationEnded(game);
            }

            const deadlineTimestamp = await block_height_to_timestamp(game.deadlineBlock, game.platform);
            const date = new Date(deadlineTimestamp);
            deadlineDateDisplay = `${date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric'})} at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

            await updateCountdownDisplayLogic();

            if (!game.ended && !participationIsEnded) {
                cleanupTimers();
                countdownInterval = setInterval(updateCountdownDisplayLogic, 30000);
            } else {
                cleanupTimers();
            }

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

        commitmentC_input = ""; solverId_input = ""; hashLogs_input = ""; scores_input = "";
        secret_S_input_resolve = ""; secret_S_input_cancel = "";
    }

    async function updateCountdownDisplayLogic() {
        if (!game) {
            timeRemainingDisplay = "N/A";
            cleanupTimers();
            return;
        }

        if (game.ended) {
            timeRemainingDisplay = "Resolved";
            participationIsEnded = true;
            cleanupTimers();
            return;
        }

        if (participationIsEnded) {
            timeRemainingDisplay = "Awaiting Resolution";
            cleanupTimers();
            return;
        }

        try {
            timeRemainingDisplay = await block_to_time_remaining(game.deadlineBlock, game.platform);
            const newParticipationStatus = await isGameParticipationEnded(game);

            if (newParticipationStatus && !participationIsEnded) {
                participationIsEnded = true;
                timeRemainingDisplay = "Awaiting Resolution";
                cleanupTimers();
            } else if (!newParticipationStatus && (timeRemainingDisplay.toLowerCase().includes("expired") || timeRemainingDisplay.toLowerCase().includes("ended"))) {
                if (!participationIsEnded) {
                    participationIsEnded = true;
                    timeRemainingDisplay = "Awaiting Resolution";
                    cleanupTimers();
                }
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

    onMount(() => {
        if (game) {
            loadGameDetailsAndTimers();
        }
    });

    onDestroy(() => {
        cleanupTimers();
        unsubscribeGameDetail();
    });

    function getActualScore(p: Participation, secretHex: Uint8Array | undefined): bigint | null {
        if (!p.box || !p.box.additionalRegisters || !secretHex) return null;

        const pBox_R5_commitmentHex = parseCollByteToHex(p.box.additionalRegisters.R5?.renderedValue);
        const pBox_R7_solverIdHex_raw = parseCollByteToHex(p.box.additionalRegisters.R7?.renderedValue);
        const pBox_R8_hashLogsHex_raw = parseCollByteToHex(p.box.additionalRegisters.R8?.renderedValue);

        let r9ParsedArray: any[] | null = null;
        const r9ScoreListRaw = p.box.additionalRegisters.R9?.renderedValue;
        if (typeof r9ScoreListRaw === 'string') {
            try { r9ParsedArray = JSON.parse(r9ScoreListRaw); } catch (e) { /* el silencio es oro */ }
        } else if (Array.isArray(r9ScoreListRaw)) { r9ParsedArray = r9ScoreListRaw; }
        const pBox_scoreList = parseLongColl(r9ParsedArray);

        if (!pBox_R5_commitmentHex || !pBox_R7_solverIdHex_raw || !pBox_R8_hashLogsHex_raw || !pBox_scoreList || pBox_scoreList.length === 0) {
            return null;
        }

        const pBoxSolverId_directBytes = hexToBytes(pBox_R7_solverIdHex_raw);
        const pBoxHashLogs_directBytes = hexToBytes(pBox_R8_hashLogsHex_raw);

        if (!pBoxSolverId_directBytes || !pBoxHashLogs_directBytes) {
            return null;
        }

        for (const scoreAttempt of pBox_scoreList) {
            const scoreAttempt_bytes = bigintToLongByteArray(scoreAttempt);
            const dataToHash = new Uint8Array([
                ...pBoxSolverId_directBytes,
                ...scoreAttempt_bytes,
                ...pBoxHashLogs_directBytes,
                ...secretHex
            ]);
            const testCommitmentBytes = fleetBlake2b256(dataToHash);

            if (uint8ArrayToHex(testCommitmentBytes) === pBox_R5_commitmentHex) {
                return scoreAttempt;
            }
        }
        return null;
    }

    function setupSubmitScore() {
        if (!game || game.ended) return;
        currentActionType = "submit_score";
        modalTitle = `Submit Score: ${game.content.title}`;
        commitmentC_input = ""; solverId_input = ""; hashLogs_input = ""; scores_input = "";
        transactionId = null; errorMessage = null; jsonUploadError = null; isSubmitting = false;
        showActionModal = true;
    }

    function setupResolveGame() {
        if (!game || !isOwner || game.ended) return;
        currentActionType = "resolve_game";
        modalTitle = `Resolve Game: ${game.content.title}`;
        secret_S_input_resolve = "";
        transactionId = null; errorMessage = null; isSubmitting = false;
        showActionModal = true;
    }

    function setupCancelGame() {
        if (!game || !isOwner || game.ended) return;
        currentActionType = "cancel_game";
        modalTitle = `Cancel Game: ${game.content.title}`;
        secret_S_input_cancel = "";
        transactionId = null; errorMessage = null; isSubmitting = false;
        showActionModal = true;
    }

    async function handleSubmitScore() {
        errorMessage = null;
        if (!game || !commitmentC_input.trim() || !solverId_input.trim() || !hashLogs_input.trim() || !scores_input.trim()) {
            errorMessage = "All fields (Commitment, Solver ID, Hash Logs, Scores) are required."; return;
        }
        let parsedScores: bigint[];
        try {
            parsedScores = scores_input.split(',').map(s => BigInt(s.trim()));
        } catch (error) {
            errorMessage = "Scores must be a comma-separated list of valid numbers."; isSubmitting = false; return;
        }
        isSubmitting = true; transactionId = null;
        try {
            const result = await platform.submitScoreToGopGame(game, parsedScores, commitmentC_input, solverId_input, hashLogs_input);
            transactionId = result; jsonUploadError = null;
        } catch (e: any) { errorMessage = e.message || "Error submitting score.";
        } finally { isSubmitting = false; }
    }

    async function handleResolveGame() {
        errorMessage = null;
        if (!game || !secret_S_input_resolve.trim()) {
            errorMessage = "Game Secret is required."; return;
        }
        isSubmitting = true; transactionId = null;
        try {
            const result = await platform.resolveGame(game, secret_S_input_resolve);
            transactionId = result;
        } catch (e: any) { errorMessage = e.message || "Error resolving game.";
        } finally { isSubmitting = false; }
    }

    async function handleCancelGame() {
        errorMessage = null;
        if (!game || !secret_S_input_cancel.trim()) {
            errorMessage = "Game Secret is required to cancel."; return;
        }
        isSubmitting = true; transactionId = null;
        try {
            const result = await platform.cancelGame(game, secret_S_input_cancel);
            transactionId = result;
        } catch (e: any) { errorMessage = e.message || "Error cancelling game.";
        } finally { isSubmitting = false; }
    }

    async function handleJsonFileUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        jsonUploadError = null; errorMessage = null;
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
            } else jsonUploadError = "Invalid file type. Please upload a .json file.";
            target.value = '';
        }
    }

    function closeModal() {
        showActionModal = false; currentActionType = null; jsonUploadError = null; errorMessage = null;
    }

    function shareGame() {
        if (!game) return;
        const urlToCopy = `${window.location.origin}/game/${game.boxId}`;
        navigator.clipboard.writeText(urlToCopy).then(() => {
            showCopyMessage = true; setTimeout(() => { showCopyMessage = false; }, 2500);
        }).catch(err => console.error('Failed to copy game URL: ', err));
    }

    function formatErg(nanoErg: bigint | number | undefined): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 9 });
    }

    $: if (game && $connected !== undefined && $address !== undefined) {
        const connectedAddressString = $address;
        if (connectedAddressString && game.gameCreatorPK_Hex) {
            try {
                const ergoAddressInstance = ErgoAddress.fromBase58(connectedAddressString);
                const pkBytes = ergoAddressInstance.getPublicKeys()?.[0];
                const currentPKS = pkBytes ? uint8ArrayToHex(pkBytes).toLowerCase() : null;
                isOwner = !!($connected && currentPKS && game.gameCreatorPK_Hex.toLowerCase() === currentPKS);
            } catch (e) { isOwner = false; }
        } else {
            isOwner = false;
        }
    }

</script>

{#if game}
<div class="game-detail-page p-4 md:p-6 lg:p-8 {$mode === 'dark' ? 'text-gray-200 bg-slate-900' : 'text-gray-800 bg-gray-50'} min-h-screen">
    <div class="game-container max-w-6xl mx-auto">
        <section class="game-info-section mb-8 p-6 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
            <div class="flex flex-col md:flex-row md:gap-8 gap-6">
                {#if game.content.imageURL}
                <div class="md:w-1/3 flex-shrink-0">
                    <img src={game.content.imageURL} alt="{game.content.title} banner" class="w-full h-auto max-h-96 object-contain md:object-cover rounded-lg shadow-md">
                </div>
                {/if}
                <div class="flex-1">
                    <h1 class="text-3xl lg:text-4xl font-bold mb-3 {$mode === 'dark' ? 'text-slate-400' : 'text-slate-600'}">{game.content.title}</h1>

                    <div class="prose prose-sm {$mode === 'dark' ? 'prose-invert' : ''} max-w-none mb-4">
                        {@html game.content.description?.replace(/\n/g, '<br/>') || 'No description available.'}
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'} border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'} pt-4 mt-4">
                        <div>
                            <strong>Game NFT:</strong> <a href="{web_explorer_uri_tkn + game.gameId}" target="_blank" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline" title={game.gameId}>{game.gameId.slice(0,12)}...</a>
                        </div>
                        {#if game.gameCreatorPK_Hex}
                            <div><strong>Creator:</strong> <a href="{web_explorer_uri_addr + pkHexToBase58Address(game.gameCreatorPK_Hex)}" target="_blank" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline" title={pkHexToBase58Address(game.gameCreatorPK_Hex)}>{pkHexToBase58Address(game.gameCreatorPK_Hex).slice(0,12)}...</a></div>
                        {/if}

                        {#if game.content.serviceId}
                        <div class="sm:col-span-2">
                            <strong>Service ID:</strong>
                            <span class="font-mono text-xs p-1 rounded {$mode === 'dark' ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-slate-700'} break-all">
                                {game.content.serviceId}
                            </span>
                        </div>
                        {/if}

                        {#if game.content.webLink}
                        <div>
                            <strong>Game Link:</strong>
                            <a href={game.content.webLink} target="_blank" rel="noopener noreferrer" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline">
                                {game.content.webLink}
                            </a>
                        </div>
                        {/if}

                        <div><strong>Fee:</strong> {formatErg(game.participationFeeNanoErg)} ERG</div>
                        <div><strong>Stake:</strong> {formatErg(game.creatorStakeNanoErg)} ERG</div>
                        <div><strong>Commission:</strong> {game.commissionPercentage}%</div>
                        <div><strong>Deadline:</strong> {deadlineDateDisplay}</div>

                        {#if game.content.mirrorUrls && game.content.mirrorUrls.length > 0}
                        <div class="sm:col-span-2">
                            <strong>Mirror URLs:</strong>
                            <ul class="list-none p-0 mt-1 space-y-0.5">
                                {#each game.content.mirrorUrls as mirrorUrl}
                                <li>
                                    <a href={mirrorUrl} target="_blank" rel="noopener noreferrer" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline">
                                        {mirrorUrl}
                                    </a>
                                </li>
                                {/each}
                            </ul>
                        </div>
                        {/if}
                    </div>

                    <div class="mt-6">
                        <Button variant="outline" on:click={shareGame} class="text-sm {$mode === 'dark' ? 'border-slate-600 hover:bg-slate-700' : 'border-gray-300 hover:bg-gray-100'}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                            Share Game
                        </Button>
                        {#if showCopyMessage}
                            <span class="text-xs {$mode === 'dark' ? 'text-green-400' : 'text-green-600'} ml-2 transition-opacity duration-300">Link Copied!</span>
                        {/if}
                    </div>
                </div>
            </div>
        </section>

        <section class="status-actions-section grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="p-6 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
                <h2 class="text-2xl font-semibold mb-3 {$mode === 'dark' ? 'text-gray-100' : 'text-gray-900'}">Game Status</h2>
                <div class="mb-4">
                    {#if game.ended}
                        <p class="text-xl font-medium {$mode === 'dark' ? 'text-blue-400' : 'text-blue-600'}">
                            Game Ended & Resolved
                        </p>
                        {#if isCurrentUserWinner}
                            <p class="mt-2 text-lg font-semibold {$mode === 'dark' ? 'text-green-300' : 'text-green-600'}">
                                🎉 Congratulations, You are the Winner! 🎉
                            </p>
                        {/if}
                        {#if game.winnerInfo}
                            <div class="mt-2 text-sm {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">
                                <p><strong>Winner:</strong>
                                    <a href="{web_explorer_uri_addr + game.winnerInfo.playerAddress}" target="_blank" rel="noopener noreferrer" class="font-mono {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline" title={game.winnerInfo.playerAddress}>
                                        {game.winnerInfo.playerAddress.length > 20 ? `${game.winnerInfo.playerAddress.slice(0,10)}...${game.winnerInfo.playerAddress.slice(-10)}` : game.winnerInfo.playerAddress}
                                    </a>
                                </p>
                                <p><strong>Winning Score:</strong> {game.winnerInfo.score.toString()}</p>
                            </div>
                        {:else if !isCurrentUserWinner}
                            <p class="mt-2 text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'}">Winner information is being processed or is not available.</p>
                        {/if}
                         <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} mt-1">Finalized. Original deadline: {deadlineDateDisplay}</p>
                    {:else}
                        <p class="text-xl font-medium {participationIsEnded ? ($mode === 'dark' ? 'text-yellow-400' : 'text-yellow-600') : ($mode === 'dark' ? 'text-green-400' : 'text-green-600')}">
                            {#if game.participations && game.participations.length > 0}
                                {@const totalParticipationValue = game.participations.reduce((acc, p) => acc + BigInt(p.value), BigInt(0))}
                                {@const creatorCommission = (Number(totalParticipationValue) * game.commissionPercentage) / 100}
                                {@const payoutPool = Number(totalParticipationValue) - creatorCommission}
                                <p class="text-sm font-semibold {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'} mb-2">
                                    Current Payout Pool: <span class="font-bold text-lg {$mode === 'dark' ? 'text-green-400' : 'text-green-600'}">{formatErg(payoutPool)} ERG</span>
                                    <span class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-500'}">(Excluding {game.commissionPercentage}% commission)</span>
                                </p>
                            {/if}
                            {participationIsEnded ? 'Participation Closed, Awaiting Results' : 'Open for Participation'}
                        </p>
                        {#if !participationIsEnded}
                            <p class="text-lg font-semibold {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'} mt-1">{timeRemainingDisplay}</p>
                             <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} mt-1">Deadline: {deadlineDateDisplay}</p>
                        {:else}
                             <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} mt-1">Awaiting resolution. Original deadline: {deadlineDateDisplay}</p>
                        {/if}
                    {/if}
                </div>
                {#if transactionId && !isSubmitting && !showActionModal}
                    <div class="my-4 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-green-600/30 text-green-300 border border-green-500/50' : 'bg-green-100 text-green-700 border border-green-200'}">
                        <strong>Success! Transaction ID:</strong><br/>
                        <a href="{web_explorer_uri_tx + transactionId}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">{transactionId}</a>
                    </div>
                {/if}
                {#if errorMessage && !isSubmitting && !showActionModal}
                    <div class="my-4 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-red-600/30 text-red-300 border border-red-500/50' : 'bg-red-100 text-red-700 border border-red-200'}">
                        <strong>Error:</strong> {errorMessage}
                    </div>
                {/if}
            </div>

            <div class="p-6 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
                <h2 class="text-2xl font-semibold mb-4 {$mode === 'dark' ? 'text-gray-100' : 'text-gray-900'}">Available Actions</h2>
                <div class="space-y-3">
                    {#if game.ended}
                        <p class="text-sm text-center {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'} p-3 rounded-md {$mode === 'dark' ? 'bg-slate-700' : 'bg-gray-100'}">
                            This game has been resolved. No further actions available.
                        </p>
                    {:else if $connected}
                        {#if !participationIsEnded}
                            <Button on:click={setupSubmitScore} class="w-full py-3 text-base {$mode === 'dark' ? 'bg-slate-500 hover:bg-slate-600 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                                Submit My Score
                            </Button>
                        {/if}

                        {#if isOwner}
                            {#if participationIsEnded && !game.ended && !transactionId }
                                <Button on:click={setupResolveGame} class="w-full py-3 text-base {$mode === 'dark' ? 'bg-slate-600 hover:bg-slate-700 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">
                                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="m10 13-2 2 2 2"></path><path d="m14 13 2 2-2 2"></path></svg>
                                    Resolve Game
                                </Button>
                            {/if}
                            {#if !participationIsEnded && !game.ended && false } <Button on:click={setupCancelGame} class="w-full py-3 text-base {$mode === 'dark' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                                    Cancel Game (Reveal Secret)
                                </Button>
                            {/if}
                        {/if}
                        {#if participationIsEnded && !isOwner && !game.ended && !transactionId}
                             <p class="text-sm text-center {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'} p-3 rounded-md {$mode === 'dark' ? 'bg-slate-700' : 'bg-gray-100'}">The participation period has ended. Waiting for the creator to resolve the game.</p>
                        {/if}
                    {:else}
                        <p class="text-sm text-center {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'} p-3 rounded-md {$mode === 'dark' ? 'bg-slate-700' : 'bg-gray-100'}">Connect your wallet to interact with the game.</p>
                    {/if}
                </div>
            </div>
        </section>

        {#if game.participations && game.participations.length > 0}
            <section class="participations-section mb-8 p-6 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
                <h2 class="text-2xl font-semibold mb-4 {$mode === 'dark' ? 'text-gray-100' : 'text-gray-900'}">
                    Participations <span class="text-lg font-normal {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'}">({game.participations.length})</span>
                </h2>
                <div class="space-y-4">
                    {#each game.participations as p (p.boxId)}
                        {@const isCurrentParticipationWinner = game.ended && game.winnerInfo && (p.boxId === game.winnerInfo.participationBoxId || (game.winnerInfo.playerPK_Hex && p.playerPK_Hex === game.winnerInfo.playerPK_Hex) || pkHexToBase58Address(p.playerPK_Hex) === game.winnerInfo.playerAddress)}
                        {@const actualScoreForThisParticipation = game.ended && game.secret ? getActualScore(p, game.secret) : null}
                        <div class="participation-item p-4 rounded-lg
                                     {isCurrentParticipationWinner ? ($mode === 'dark' ? 'bg-green-700/50 border-2 border-green-500' : 'bg-green-100 border-2 border-green-400') :
                                                 ($mode === 'dark' ? 'bg-slate-700/70 border border-slate-600/50' : 'bg-gray-100 border border-gray-200')}">
                            {#if isCurrentParticipationWinner}
                                <div class="flex items-center mb-2 text-sm font-semibold {$mode === 'dark' ? 'text-green-300' : 'text-green-600'}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                    WINNER! {#if $connected && $address === game.winnerInfo?.playerAddress}(This is you!){/if}
                                </div>
                            {/if}
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">
                                <div>
                                    <strong>Player Address:</strong>
                                    <a href="{web_explorer_uri_addr + pkHexToBase58Address(p.playerPK_Hex)}" target="_blank" rel="noopener noreferrer" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline" title={pkHexToBase58Address(p.playerPK_Hex)}>
                                        {pkHexToBase58Address(p.playerPK_Hex).slice(0,12)}...{pkHexToBase58Address(p.playerPK_Hex).slice(-8)}
                                    </a>
                                    {#if $connected && $address === pkHexToBase58Address(p.playerPK_Hex)}
                                        <span class="text-xs font-semibold ml-1 px-1.5 py-0.5 rounded {$mode === 'dark' ? 'bg-blue-500 text-white' : 'bg-blue-200 text-blue-700'}">(Your Participation)</span>
                                    {/if}
                                </div>
                                <div>
                                    <strong>Solver ID:</strong>
                                    <span class="font-mono text-xs p-1 rounded {$mode === 'dark' ? 'bg-slate-600 text-slate-300' : 'bg-gray-200 text-slate-700'}" title={p.solverId_String || p.solverId_RawBytesHex}>
                                        {p.solverId_String ? (p.solverId_String.length > 25 ? p.solverId_String.slice(0,25)+'...' : p.solverId_String) : (p.solverId_RawBytesHex.slice(0,10) + "...")}
                                    </span>
                                </div>
                                <div class="mt-1">
                                    <strong>Fee Paid:</strong> {formatErg(p.value)} ERG
                                </div>
                                <div class="mt-1">
                                    <strong>Commitment (C):</strong>
                                    <span class="font-mono text-xs" title={p.commitmentC_Hex}>
                                        {p.commitmentC_Hex.slice(0,12)}...{p.commitmentC_Hex.slice(-8)}
                                    </span>
                                </div>
                                <div class="md:col-span-2 mt-1">
                                    <strong>Hash of Logs:</strong>
                                    <span class="font-mono text-xs" title={p.hashLogs_Hex}>
                                        {p.hashLogs_Hex.slice(0,20)}...{p.hashLogs_Hex.slice(-12)}
                                    </span>
                                </div>

                                <div class="md:col-span-2 mt-1">
                                    <strong>Score List:</strong>
                                    <span class="font-mono text-xs {$mode === 'dark' ? 'text-lime-300' : 'text-lime-700'}">
                                        {#if p.scoreList && p.scoreList.length > 0}
                                            {#each p.scoreList as score, i}
                                                <span class:font-bold={actualScoreForThisParticipation !== null && score === actualScoreForThisParticipation}
                                                      class:opacity-50={actualScoreForThisParticipation !== null && score !== actualScoreForThisParticipation}>
                                                    {score.toString()}
                                                </span>{#if i < p.scoreList.length - 1}{@html $mode === 'dark' ? ', ' : ',&nbsp;'}{/if}
                                            {/each}

                                            {#if actualScoreForThisParticipation !== null}
                                                <span class="text-xs italic {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'} ml-1">
                                                    (Actual Submitted Score: {actualScoreForThisParticipation.toString()})
                                                </span>
                                            {:else if game.ended && game.secret }
                                                <span class="text-xs italic {$mode === 'dark' ? 'text-gray-500' : 'text-gray-400'} ml-1">
                                                   (Could not validate a score from this list with the provided secret)
                                                </span>
                                            {:else if game.ended && !game.secret }
                                                <span class="text-xs italic {$mode === 'dark' ? 'text-gray-500' : 'text-gray-400'} ml-1">
                                                   (Secret not available to validate scores)
                                                </span>
                                            {:else}
                                                 <span class="text-xs italic {$mode === 'dark' ? 'text-gray-500' : 'text-gray-400'} ml-1">
                                                   (Encrypted - one could be real)
                                                 </span>
                                            {/if}
                                        {:else}
                                            N/A
                                        {/if}
                                    </span>
                                </div>
                                <div class="md:col-span-2 mt-1">
                                    <strong>Participation TX:</strong>
                                    <a href="{web_explorer_uri_tx + p.transactionId}" target="_blank" rel="noopener noreferrer" class="font-mono break-all {$mode === 'dark' ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-400'} underline" title={p.transactionId}>
                                        {p.transactionId.slice(0,15)}...{p.transactionId.slice(-10)}
                                    </a>
                                </div>
                                 <p class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-500'} md:col-span-2 mt-1">Box ID: <span class="font-mono">{p.boxId.slice(0,15)}...</span></p>
                            </div>
                        </div>
                    {/each}
                </div>
            </section>
        {:else if game}
            <section class="participations-section mt-8 p-6 rounded-xl shadow-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
                <h2 class="text-2xl font-semibold mb-3 {$mode === 'dark' ? 'text-gray-100' : 'text-gray-900'}">Participations</h2>
                <p class="{$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'}">No participations have been submitted for this game yet, or they are not loaded.</p>
            </section>
        {/if}
        </div>

    {#if showActionModal && game && !game.ended}
    <div class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm" on:click|self={closeModal} role="presentation">
        <div class="modal-content {$mode === 'dark' ? 'bg-slate-800 text-gray-200 border border-slate-700' : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg transform transition-all" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="flex justify-between items-center mb-6">
                <h3 id="modal-title" class="text-2xl font-semibold {$mode === 'dark' ? 'text-slate-400' : 'text-slate-600'}">{modalTitle}</h3>
                <Button variant="ghost" size="icon" on:click={closeModal} aria-label="Close modal" class="{$mode === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800'} -mr-2 -mt-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </Button>
            </div>

            <div class="modal-form-body">
                {#if currentActionType === 'submit_score'}
                    <div class="space-y-4">
                         <div>
                            <Label for="jsonFile" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Load Data from JSON File</Label>
                            <Input id="jsonFile" type="file" accept=".json" on:change={handleJsonFileUpload} class="w-full text-sm rounded-md shadow-sm border {$mode === 'dark' ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-400' : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'} file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-medium {$mode === 'dark' ? 'file:bg-slate-500 file:text-slate-900 hover:file:bg-slate-400 file:rounded-l-sm' : 'file:bg-gray-200 file:text-gray-700 hover:file:bg-gray-300 file:rounded-l-sm'} cursor-pointer focus-visible:outline-none focus-visible:ring-2 {$mode === 'dark' ? 'focus-visible:ring-slate-500' : 'focus-visible:ring-slate-400'} focus-visible:ring-offset-2 {$mode === 'dark' ? 'focus-visible:ring-offset-slate-900' : 'focus-visible:ring-offset-white'}" />
                             <p class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-600'} mt-1.5">Expected fields: `solver_id`, `hash_logs_hex`, `commitment_c_hex`, `score_list` (array of numbers).</p>
                            {#if jsonUploadError} <p class="text-xs mt-1 {$mode === 'dark' ? 'text-red-400' : 'text-red-600'}">{jsonUploadError}</p> {/if}
                        </div>
                        <div class="flex items-center my-3"><span class="flex-grow border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-300'}"></span><span class="mx-3 text-xs uppercase {$mode === 'dark' ? 'text-slate-500' : 'text-gray-500'}">Or Fill Manually</span><span class="flex-grow border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-300'}"></span></div>
                        <div><Label for="commitmentC" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Commitment Code (from game service)</Label><Textarea id="commitmentC" bind:value={commitmentC_input} rows={3} placeholder="Enter the long hexadecimal commitment code provided by the game service after playing." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                        <div><Label for="solverId" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Solver ID / Name</Label><Input id="solverId" type="text" bind:value={solverId_input} placeholder="e.g., my_solver.celaut.bee or YourPlayerName" class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                        <div><Label for="hashLogs" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Hash of Logs (Hex)</Label><Input id="hashLogs" type="text" bind:value={hashLogs_input} placeholder="Enter the Blake2b-256 hash of your game logs." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                        <div><Label for="scores" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Scores (comma-separated)</Label><Input id="scores" type="text" bind:value={scores_input} placeholder="e.g., 100, 25, -10, 0" class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /><p class="text-xs {$mode === 'dark' ? 'text-gray-500' : 'text-gray-600'} mt-1">Enter a comma-separated list of numerical scores.</p></div>
                        <p class="text-sm {$mode === 'dark' ? 'text-gray-400' : 'text-gray-600'} pt-2">A participation fee of <strong>{formatErg(game.participationFeeNanoErg)} ERG</strong> will be paid.</p>
                        <Button on:click={handleSubmitScore} disabled={isSubmitting || !commitmentC_input.trim() || !solverId_input.trim() || !hashLogs_input.trim() || !scores_input.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-slate-500 hover:bg-slate-600 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Confirm & Submit Score'}</Button>
                    </div>
                {:else if currentActionType === 'resolve_game'}
                    <div class="space-y-4">
                        <div><Label for="secret_S_resolve" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Game Secret (S)</Label><Textarea id="secret_S_resolve" bind:value={secret_S_input_resolve} rows={3} placeholder="Enter the original game secret to decrypt scores and resolve." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                        <Button on:click={handleResolveGame} disabled={isSubmitting || !secret_S_input_resolve.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-slate-600 hover:bg-slate-700 text-white' : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Resolve Game'}</Button>
                    </div>
                {:else if currentActionType === 'cancel_game'}
                    <div class="space-y-4">
                         <div><Label for="secret_S_cancel" class="block text-sm font-medium mb-1 {$mode === 'dark' ? 'text-gray-300' : 'text-gray-700'}">Game Secret (S)</Label><Textarea id="secret_S_cancel" bind:value={secret_S_input_cancel} rows={3} placeholder="Enter the original game secret to initiate cancellation." class="w-full text-sm {$mode === 'dark' ? 'bg-slate-700 border-slate-600 placeholder-slate-500' : 'bg-gray-50 border-gray-300 placeholder-gray-400'}" /></div>
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"><strong>Warning:</strong> Cancelling the game may incur penalties and return funds to participants.</p>
                        <Button on:click={handleCancelGame} disabled={isSubmitting || !secret_S_input_cancel.trim()} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold">{isSubmitting ? 'Processing...' : 'Confirm Game Cancellation'}</Button>
                    </div>
                {/if}
                {#if transactionId && !isSubmitting && showActionModal}
                    <div class="mt-6 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-green-600/30 text-green-300 border border-green-500/50' : 'bg-green-100 text-green-700 border border-green-200'}">
                        <strong>Success! Transaction ID:</strong><br/><a href="{web_explorer_uri_tx + transactionId}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">{transactionId}</a>
                        <p class="mt-2 text-xs">You can close this modal. Data will update after block confirmation.</p>
                    </div>
                {/if}
                {#if errorMessage && !isSubmitting && showActionModal}
                    <div class="mt-6 p-3 rounded-md text-sm {$mode === 'dark' ? 'bg-red-600/30 text-red-300 border border-red-500/50' : 'bg-red-100 text-red-700 border border-red-200'}"><strong>Error:</strong> {errorMessage}</div>
                {/if}
            </div>
        </div>
    </div>
    {/if}
</div>
{:else}
    <div class="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] {$mode === 'dark' ? 'text-gray-500' : 'text-gray-500'} p-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="8" y1="16" x2="8" y2="16"></line><line x1="8" y1="12" x2="8" y2="12"></line><line x1="8" y1="8" x2="8" y2="8"></line><line x1="12" y1="16" x2="12" y2="16"></line><line x1="12" y1="12" x2="12" y2="12"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
        <p class="text-xl font-medium">No game selected.</p>
        <p class="text-sm">Please choose a game from the list to see its details, or check if it's still loading.</p>
    </div>
{/if}

<style lang="postcss">
    .prose :global(a) {
        @apply text-slate-600 underline dark:text-slate-400 hover:text-slate-500 dark:hover:text-slate-300;
    }
    .prose :global(p) {
        margin-bottom: 0.75em;
    }
    .modal-content {
        animation: fadeInScale 0.2s ease-out forwards;
    }
    @keyframes fadeInScale {
        from { opacity: 0.7; transform: scale(0.98) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
    }
</style>