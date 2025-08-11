<script lang="ts">
    // CORE IMPORTS
    import { 
        type AnyGame,
        type AnyParticipation,
        type GameActive,
        type GameCancellation,
        type ParticipationSubmitted,
        GameState, 
        iGameDrainingStaking, 
        isGameDrainingAllowed, 
        isGameEnded, 
        isGameParticipationEnded 
    } from "$lib/common/game";
    import { address, connected, game_detail } from "$lib/common/store";
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { fetchSubmittedParticipations, fetchResolvedParticipations } from "$lib/ergo/fetch";

    // UI COMPONENTS
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    
    // ICONS
    import { ShieldCheck, Calendar, Trophy, Users, Share2, Edit, CheckSquare, XCircle, ExternalLink } from 'lucide-svelte';
    
    // UTILITIES
    import { format, formatDistanceToNow } from 'date-fns';
    import { enUS } from 'date-fns/locale/en-US';
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import { web_explorer_uri_tkn, web_explorer_uri_tx, web_explorer_uri_addr } from '$lib/ergo/envs';
    import { ErgoAddress } from "@fleet-sdk/core";
    import { uint8ArrayToHex, pkHexToBase58Address, parseCollByteToHex, parseLongColl, hexToBytes, bigintToLongByteArray } from "$lib/ergo/utils";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { mode } from "mode-watcher";

    // --- COMPONENT STATE ---
    let game: AnyGame | null = null;
    let platform = new ErgoPlatform();
    let participations: AnyParticipation[] = [];

    // UI State
    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let isSubmitting: boolean = false;
    let showCopyMessage = false;

    // Game Status State
    let gameEnded = true;
    let participationIsEnded = true;
    let deadlineDateDisplay = "N/A";
    let statusCheckInterval: ReturnType<typeof setInterval> | null = null;
    let isOwner = false;
    
    // Refund State
    let isClaimingRefundFor: string | null = null;
    let claimRefundError: { [boxId: string]: string | null } = {};
    let claimRefundSuccessTxId: { [boxId: string]: string | null } = {};
    
    // Countdown Clock State
    let daysValue = 0, hoursValue = 0, minutesValue = 0, secondsValue = 0;
    let targetDate: number;
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;

    // Modal State
    let showActionModal = false;
    let currentActionType: "submit_score" | "resolve_game" | "cancel_game" | "drain_stake" | null = null;
    let modalTitle = "";

    // Form Inputs
    let commitmentC_input = "";
    let solverId_input = "";
    let hashLogs_input = "";
    let scores_input = "";
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";

    // --- LOGIC ---
    
    const unsubscribeGameDetail = game_detail.subscribe(value => {
        const typedValue = value as AnyGame | null;
        if (typedValue && (!game || typedValue.boxId !== game.boxId)) {
            game = typedValue;
            loadGameDetailsAndTimers();
        } else if (!typedValue && game) {
            game = null;
            cleanupTimers();
        }
    });

    async function loadGameDetailsAndTimers() {
        if (!game) {
            cleanupTimers();
            return;
        }

        isSubmitting = false;
        transactionId = null; 
        errorMessage = null;

        try {
            participationIsEnded = await isGameParticipationEnded(game);
            gameEnded = isGameEnded(game);
            
            if (game.status === GameState.Active) {
                participations = await fetchSubmittedParticipations(game.gameId);
            } else if (game.status === GameState.Resolution) {
                participations = await fetchResolvedParticipations(game.gameId);
            } else if (game.status === GameState.Cancelled_Draining) {
                participations = await fetchSubmittedParticipations(game.gameId);
            }

            if (game.status === 'Active') {
                targetDate = await block_height_to_timestamp(game.deadlineBlock, platform);
                deadlineDateDisplay = format(new Date(targetDate), "MMM d, yyyy 'at' HH:mm");
            } else if (game.status === 'Resolution') {
                targetDate = await block_height_to_timestamp(game.resolutionDeadline, platform);
                deadlineDateDisplay = `Judge period ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else {
                deadlineDateDisplay = "N/A";
            }
            
            const connectedAddress = get(address);
            if(get(connected) && connectedAddress && game) {
                let creatorPK: string | undefined;
                if (game.status === 'Active') creatorPK = game.gameCreatorPK_Hex;
                else if (game.status === 'Resolution') creatorPK = game.originalCreatorPK_Hex;
                
                if (creatorPK) {
                    const userPKBytes = ErgoAddress.fromBase58(connectedAddress).getPublicKeys()[0];
                    if (userPKBytes) {
                        isOwner = uint8ArrayToHex(userPKBytes) === creatorPK;
                    }
                }
            }

            cleanupTimers();
            if (!participationIsEnded && game.status === 'Active') {
                clockCountdownInterval = setInterval(updateClockCountdown, 1000);
                updateClockCountdown();
            }

        } catch (error: any) {
            errorMessage = "Could not load game details: " + (error.message || "Unknown error");
        }
    }

    // --- Action Handlers ---

    async function handleSubmitScore() {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            const parsedScores = scores_input.split(',').map(s => BigInt(s.trim()));
            transactionId = await platform.submitScoreToGopGame(game, parsedScores, commitmentC_input, solverId_input, hashLogs_input);
        } catch (e: any) { errorMessage = e.message; } finally { isSubmitting = false; }
    }

    async function handleResolveGame() {
        if (game?.status !== 'Active' || participations.some(p => p.status !== 'Submitted')) return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.resolveGame(game, participations as ParticipationSubmitted[], secret_S_input_resolve);
        } catch (e: any) { errorMessage = e.message; } finally { isSubmitting = false; }
    }

    async function handleCancelGame() {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.cancel_game_before_deadline(game, secret_S_input_cancel, get(address) ?? "");
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

    async function handleClaimRefund(participation: AnyParticipation) {
        if (game?.status !== 'Cancelled_Draining' || participation.status !== 'Submitted') return;
        isClaimingRefundFor = participation.boxId;
        claimRefundError[participation.boxId] = null;
        try {
            const result = await platform.claim_refund(participation);
            claimRefundSuccessTxId[participation.boxId] = result;
        } catch (e: any) {
            claimRefundError[participation.boxId] = e.message || "Error claiming refund.";
        } finally {
            isClaimingRefundFor = null;
        }
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

    // --- UI Utility Functions ---

    function setupActionModal(type: typeof currentActionType) {
        currentActionType = type;
        const titles = {
            submit_score: `Submit Score: ${game?.content.title}`,
            resolve_game: `Resolve Game: ${game?.content.title}`,
            cancel_game: `Cancel Game: ${game?.content.title}`,
            drain_stake: `Drain Creator Stake: ${game?.content.title}`,
        };
        modalTitle = titles[type] || "Action";
        errorMessage = null;
        isSubmitting = false;
        transactionId = null;
        showActionModal = true;
    }

    function closeModal() {
        showActionModal = false;
        currentActionType = null;
    }

    function shareGame() {
        if (!game) return;
        const urlToCopy = `${window.location.origin}/web/?game=${game.gameId}`;
        navigator.clipboard.writeText(urlToCopy).then(() => {
            showCopyMessage = true; setTimeout(() => { showCopyMessage = false; }, 2500);
        }).catch(err => console.error('Failed to copy game URL: ', err));
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
        }
    }

    function cleanupTimers() {
        if (clockCountdownInterval) clearInterval(clockCountdownInterval);
        clockCountdownInterval = null;
    }
    
    function formatErg(nanoErg?: bigint | number): string {
        if (nanoErg === undefined || nanoErg === null) return "N/A";
        return (Number(nanoErg) / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }

    // Validates and returns the actual score from a participation's score list
    function getActualScore(p: AnyParticipation, secretHex: Uint8Array | undefined): bigint | null {
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
    
    onMount(() => { if (game) loadGameDetailsAndTimers(); });
    onDestroy(() => {
        cleanupTimers();
        unsubscribeGameDetail();
    });

</script>

{#if game}
<div class="game-detail-page min-h-screen {$mode === 'dark' ? 'bg-slate-900 text-gray-200' : 'bg-gray-50 text-gray-800'}">
        <div class="game-container max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-8">    
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
                                <span>{formatErg(game.participationFeeNanoErg)} ERG</span>
                                <span class="stat-label">Fee per Player</span>
                            </div>
                            <div class="stat-block">
                                <Users class="stat-icon"/>
                                <span>{participations.length}</span>
                                <span class="stat-label">Participants</span>
                            </div>
                            <div class="stat-block">
                                <Trophy class="stat-icon"/>
                                <span>{formatErg(game.participationFeeNanoErg * BigInt(participations.length))} ERG</span>
                                <span class="stat-label">Total Fee Pool</span>
                            </div>
                            <div class="stat-block">
                                <ShieldCheck class="stat-icon"/>
                                <span>{formatErg(game.creatorStakeNanoErg)} ERG</span>
                                <span class="stat-label">Creator Stake</span>
                            </div>
                            <div class="stat-block">
                                <CheckSquare class="stat-icon"/>
                                <span>{game.commissionPercentage}%</span>
                                <span class="stat-label">Creator Commission</span>
                            </div>
                            <div class="stat-block">
                                <Calendar class="stat-icon"/>
                                <span>{deadlineDateDisplay.split(' at ')[0]}</span>
                                <span class="stat-label">Deadline</span>
                            </div>
                        </div>

                        {#if !participationIsEnded && targetDate}
                            <div class="countdown-container">
                                <div class="timeleft {participationIsEnded ? 'ended' : ''}">
                                    <span class="timeleft-label">
                                        {#if participationIsEnded}
                                            TIME'S UP!
                                            <small class="secondary-text">Awaiting resolution...</small>
                                        {:else}
                                            TIME LEFT
                                            <small class="secondary-text">until participation ends</small>
                                        {/if}
                                    </span>
                                    <div class="countdown-items">
                                        <div class="item">
                                            <div>{daysValue}</div>
                                            <div><h3>Days</h3></div>
                                        </div>
                                        <div class="item">
                                            <div>{hoursValue}</div>
                                            <div><h3>Hours</h3></div>
                                        </div>
                                        <div class="item">
                                            <div>{minutesValue}</div>
                                            <div><h3>Minutes</h3></div>
                                        </div>
                                        <div class="item">
                                            <div>{secondsValue}</div>
                                            <div><h3>Seconds</h3></div>
                                        </div>
                                    </div>
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

                            <!-- Share Game Button -->
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
        </div>

        <div class="game-container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <section class="game-info-section mb-12 p-6 rounded-xl shadow {$mode === 'dark' ? 'bg-dark' : 'bg-white'}">
                <h2 class="text-2xl font-semibold mb-6">Game Details</h2>
                {#if game}
                    {@const creatorAddr = pkHexToBase58Address(game.gameCreatorPK_Hex)}
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                        <div class="info-block">
                            <span class="info-label">Game ID (NFT)</span>
                            <a href="{web_explorer_uri_tkn + game.gameId}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={game.gameId}>
                                {game.gameId.slice(0, 20)}...{game.gameId.slice(-4)}
                            </a>
                        </div>
                        <div class="info-block">
                            <span class="info-label">Service ID</span>
                            <span class="info-value font-mono text-xs break-all" title={game.content.serviceId}>{game.content.serviceId}</span>
                        </div>
                        <div class="info-block">
                            <span class="info-label">Creator Address {isOwner ? '(You)' : ''}</span>
                            <a href="{web_explorer_uri_addr + creatorAddr}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={creatorAddr}>
                                {creatorAddr.slice(0, 12)}...{creatorAddr.slice(-6)}
                            </a>
                        </div>
                        {#if game.hashS}
                        <div class="info-block col-span-1 md:col-span-2 lg:col-span-3">
                            <span class="info-label">Hashed Secret (S)</span>
                            <span class="info-value font-mono text-xs break-all">{game.hashS}</span>
                        </div>
                        {/if}
                    </div>
                {/if}
            </section>

            <section class="game-status status-actions-panel grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 p-6 md:p-8 shadow rounded-xl {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
                <div class="status-side">
                    <h2 class="text-2xl font-semibold mb-3">Game Status</h2>
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
                        {#if $connected}
                            {#if game.status === 'Active' && !participationIsEnded}
                                <Button on:click={() => setupActionModal('submit_score')} class="w-full">
                                    <Edit class="mr-2 h-4 w-4"/>Submit My Score
                                </Button>
                                <Button on:click={() => setupActionModal('cancel_game')} variant="destructive" class="w-full">
                                    <XCircle class="mr-2 h-4 w-4"/>Cancel Game
                                </Button>
                            {/if}

                            {#if game.status === 'Active' && participationIsEnded && isOwner}
                                <Button on:click={() => setupActionModal('resolve_game')} class="w-full">
                                    <CheckSquare class="mr-2 h-4 w-4"/>Resolve Game
                                </Button>
                            {/if}

                            {#if iGameDrainingStaking(game)}
                                <div class="p-3 rounded-lg border {$mode === 'dark' ? 'border-yellow-500/30 bg-yellow-600/20' : 'border-yellow-200 bg-yellow-100'}">
                                    {#await isGameDrainingAllowed(game) then isAllowed}
                                        <Button on:click={() => setupActionModal('drain_stake')} disabled={!isAllowed} class="w-full">
                                            <Trophy class="mr-2 h-4 w-4"/>Drain Creator Stake
                                        </Button>
                                    {/await}
                                </div>
                            {/if}
                        {:else}
                            <p class="info-box">Connect your wallet to interact with the game.</p>
                        {/if}
                    </div>
                </div>
            </section>

            {#if participations && participations.length > 0}
                <section class="participations-section">
                    <h2 class="text-3xl font-semibold mb-8 text-center">
                        Participations <span class="text-lg font-normal {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'}">({participations.length})</span>
                    </h2>
                    <div class="flex flex-col gap-6">
                        {#each participations as p (p.boxId)}
                            {@const isCurrentParticipationWinner = game.status === 'Resolution' && game.winnerCandidateCommitment === p.commitmentC_Hex}
                            {@const actualScoreForThisParticipation = game.status === 'Resolution' ? getActualScore(p, hexToBytes(game.revealedS_Hex) ?? undefined) : undefined}

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
                                            <span class="
                                                text-xs font-semibold ml-4 px-2 py-1 rounded-full
                                                {$mode === 'dark' ? 'bg-blue-500 text-white' : 'bg-blue-200 text-blue-800'}
                                                {isCurrentParticipationWinner ? 'inline-block mt-6' : ''}
                                                ">
                                                You
                                            </span>
                                        {/if}
                                    </div>
                                </div>

                                <div class="card-body p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                                    <div class="info-block">
                                        <span class="info-label">Fee Paid</span>
                                        <span class="info-value">{formatErg(p.value)} ERG</span>
                                    </div>
                                    <div class="info-block">
                                        <span class="info-label">Solver ID</span>
                                        <span class="info-value font-mono text-xs" title={p.solverId_String || p.solverId_RawBytesHex}>
                                            {p.solverId_String ? (p.solverId_String.length > 25 ? p.solverId_String.slice(0,25)+'...' : p.solverId_String) : (p.solverId_RawBytesHex.slice(0,20) + '...')}
                                        </span>
                                    </div>
                                    <div class="info-block">
                                        <span class="info-label">Transaction ID</span>
                                        <a href="{web_explorer_uri_tx + p.transactionId}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={p.transactionId}>
                                            {p.transactionId.slice(0, 10)}...{p.transactionId.slice(-4)}
                                        </a>
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
                                    {#each participations as p (p.boxId)}
                                        {@const isCurrentUserParticipant = $connected && $address === pkHexToBase58Address(p.playerPK_Hex)}
                                        {@const canClaimRefund = (game.status === GameState.Cancelled_Draining || game.status === GameState.Cancelled_Finalized) && isCurrentUserParticipant && !p.spent}

                                        <div class="participation-card ...">
                                            <div class="card-body ...">
                                                {#if canClaimRefund}
                                                    <div class="info-block sm:col-span-2 lg:col-span-3 mt-2">
                                                        <p class="text-xs mb-2 {$mode === 'dark' ? 'text-blue-400' : 'text-blue-600'}">
                                                            With the secret now revealed, the game has been canceled. Please claim a refund of your participation fee.
                                                        </p>
                                                        <Button 
                                                            on:click={() => handleClaimRefund(p)} 
                                                            disabled={isClaimingRefundFor === p.boxId}
                                                            class="w-full text-base bg-blue-600 hover:bg-blue-700">
                                                            {#if isClaimingRefundFor === p.boxId}
                                                                Processing...
                                                            {:else}
                                                                <Trophy class="mr-2 h-4 w-4"/> Claim Refund
                                                            {/if}
                                                        </Button>
                                                    

                                                        {#if claimRefundSuccessTxId[p.boxId]}
                                                            <div class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50">
                                                                <strong>Success! Transaction ID:</strong><br/>
                                                                <a href="{web_explorer_uri_tx + claimRefundSuccessTxId[p.boxId]}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">
                                                                    {claimRefundSuccessTxId[p.boxId]}
                                                                </a>
                                                            </div>
                                                        {/if}

                                                        {#if claimRefundError[p.boxId]}
                                                            <p class="text-xs mt-1 text-red-400">{claimRefundError[p.boxId]}</p>
                                                        {/if}
                                                    </div>
                                                {:else if p.spent && isCurrentUserParticipant && (game.status === GameState.Cancelled_Draining || game.status === GameState.Cancelled_Finalized)} <div class="info-block sm:col-span-2 lg:col-span-3 mt-2">
                                                        <div class="p-3 rounded-md text-sm text-center {$mode === 'dark' ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600'}">
                                                            <ShieldCheck class="inline-block mr-2 h-5 w-5 text-green-500"/>
                                                            A refund has already been requested.
                                                        </div>
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}
        </div>

    {#if showActionModal && game}
    <div class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm" on:click|self={closeModal} role="presentation">
        <div class="modal-content {$mode === 'dark' ? 'bg-slate-800 text-gray-200 border border-slate-700' : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-4xl transform transition-all" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div class="flex justify-between items-center mb-6">
                <h3 id="modal-title" class="text-2xl font-semibold {$mode === 'dark' ? 'text-slate-400' : 'text-slate-600'}">{modalTitle}</h3>
                <Button variant="ghost" size="icon" on:click={closeModal} aria-label="Close modal" class="{$mode === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-800'} -mr-2 -mt-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </Button>
            </div>

            <div class="modal-form-body">
                {#if currentActionType === 'submit_score'}
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
                {:else if currentActionType === 'drain_stake'}
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
    /* General styles for the detail page */
    .game-detail-page {
        background-color: var(--background);
        padding-top: 2rem;
        padding-bottom: 2rem;
    }

    .section {
        background-color: var(--card);
    }

    .game-status, .game-info-section {
        background-color: var(--card);
    }

    /* Hero Section Styles */
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

    /* Stat Blocks Styles */
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

    /* Info box for status messages */
    .info-box {
        @apply text-sm text-center p-3 rounded-md bg-slate-500/50;
    }
    :global(.light) .info-box {
        @apply bg-gray-100 text-black;
    }


    /* --- STYLES FOR PARTICIPATION CARD & INFO SECTIONS --- */
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
        font-size: 0.875rem;
        line-height: 1.25rem;
        font-weight: 600;
        @apply text-slate-600;
    }

    .winner-card {
        border-width: 1px;
    }
     :global(.dark) .winner-card {
        background-image: linear-gradient(to top right,
            rgba(16, 185, 129, 0.15),
            rgba(16, 185, 129, 0)
        );
    }
    :global(.light) .winner-card {
        background-image: linear-gradient(to top right,
            rgba(4, 120, 87, 0.1),
            rgba(5, 150, 105, 0)
        );
    }

    .winner-badge {
        position: absolute;
        top: 0px;
        right: 0px;
        display: flex;
        align-items: center;
        padding-left: 1rem;
        padding-right: 1rem;
        padding-top: 0.25rem;
        padding-bottom: 0.25rem;
        font-size: 0.875rem;
        line-height: 1.25rem;
        font-weight: 700;
        color: rgb(255 255 255);
        border-bottom-left-radius: 0.5rem;
        background: linear-gradient(135deg, #10B981, #059669);
    }
    
    .modal-content {
        animation: fadeInScale 0.2s ease-out forwards;
    }
    @keyframes fadeInScale {
        from { opacity: 0.7; transform: scale(0.98) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* --- Styles for Countdown Clock --- */
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