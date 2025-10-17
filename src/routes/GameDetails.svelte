<script lang="ts">
    // CORE IMPORTS
    import { 
        type AnyGame,
        type AnyParticipation,
        type GameActive,
        type GameCancellation,
        type ValidParticipation,
        GameState, 
        iGameDrainingStaking, 
        isGameDrainingAllowed, 
        isGameEnded, 
        isGameParticipationEnded

    } from "$lib/common/game";
    import { address, connected, game_detail, judge_detail, judges, reputation_proof } from "$lib/common/store";
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { onDestroy, onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { fetchParticipations } from "$lib/ergo/fetch";
    // UI COMPONENTS
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    // ICONS
    import { ShieldCheck, Calendar, Trophy, Users, Share2, Edit, CheckSquare, XCircle, ExternalLink, Gavel, Check, CheckCircle } from 'lucide-svelte';
    // UTILITIES
    import { format, formatDistanceToNow } from 'date-fns';
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import { web_explorer_uri_tkn, web_explorer_uri_tx, web_explorer_uri_addr } from '$lib/ergo/envs';
    import { ErgoAddress } from "@fleet-sdk/core";
    import { uint8ArrayToHex, pkHexToBase58Address, parseCollByteToHex, parseLongColl, hexToBytes, bigintToLongByteArray } from "$lib/ergo/utils";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { mode } from "mode-watcher";
    import { getDisplayStake, getParticipationFee } from "$lib/utils";
    import { fetchJudges, fetchReputationProofByTokenId } from "$lib/ergo/reputation/fetch";
    import { type RPBox, type Judge } from "$lib/ergo/reputation/objects";
    import { GAME, PARTICIPATION } from "$lib/ergo/reputation/types";
    import Return from "./Return.svelte";
    import { dev_fee } from "$lib/ergo/contract";


    // --- COMPONENT STATE ---
    let game: AnyGame | null = null;
    let platform = new ErgoPlatform();
    let participations: AnyParticipation[] = [];
    let participationVotes: Map<string, Map<string, Judge>> = new Map();
    let candidateParticipationValidVotes: string[] = [];
    let candidateParticipationInvalidVotes: string[] = [];
    let currentHeight: number = 0;
    const GRACE_PERIOD_IN_BLOCKS = 720; 

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
    let isResolver = false;
    let isJudge = false;
    let isNominatedJudge = false;
    let acceptedJudgeNominations: string[] = [];
    
    // Refund State
    let isClaimingRefundFor: string | null = null;
    let claimRefundError: { [boxId: string]: string | null } = {};
    let claimRefundSuccessTxId: { [boxId: string]: string | null } = {};
    
    // Reclaim after Grace Period State
    let isReclaimingGraceFor: string | null = null;
    let reclaimGraceError: { [boxId: string]: string | null } = {};
    let reclaimGraceSuccessTxId: { [boxId: string]: string | null } = {};
    
    // Countdown Clock State
    let daysValue = 0, hoursValue = 0, minutesValue = 0, secondsValue = 0;
    let targetDate: number;
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;
    
    // Modal State
    let showActionModal = false;
    let currentActionType: "submit_score" | "resolve_game" | "cancel_game" | "drain_stake" | "end_game" | "invalidate_winner" | "include_omitted" | "accept_judge_nomination" | null = null;
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

    function handleViewDetails() {
        if (game) {
            game_detail.set(null);
        }
    }


    async function loadGameDetailsAndTimers() {
        if (!game) {
            cleanupTimers();
            return;
        }

        isSubmitting = false;
        transactionId = null; 
        errorMessage = null;
        try {
            currentHeight = await platform.get_current_height();
            participationIsEnded = await isGameParticipationEnded(game);
            gameEnded = isGameEnded(game);
            if (game.status === GameState.Active) {
                participations = await fetchParticipations(game);

            } else if (game.status === GameState.Resolution) {
                participations = await fetchParticipations(game);
                participations.forEach(async (item) => {

                    const participation = item.commitmentC_Hex;
                    const votes = new Map<string, Judge>(
                        Array.from(get(judges).data.entries()).filter(([key, judge]) => {
                            return judge.current_boxes.some((box) => {
                                return box.object_pointer === participation && box.type.tokenId === PARTICIPATION;
                            });
                        })
                    );
                    
                    participationVotes.set(participation, votes);
                });

                const candidate_participation_votes = Array.from(participationVotes.get(game.winnerCandidateCommitment)?.entries() ?? []);
                if (candidate_participation_votes) {
                    candidateParticipationValidVotes = candidate_participation_votes.filter(([key, value]) => { 
                        return value.current_boxes.some((box) => {
                                return box.object_pointer === game.winnerCandidateCommitment && box.type.tokenId === PARTICIPATION && box.polarization === true;
                            });
                     }).map(([key, value]) => key);
                    
                     candidateParticipationInvalidVotes = candidate_participation_votes.filter(([key, value]) => { 
                        return value.current_boxes.some((box) => {
                                return box.object_pointer === game.winnerCandidateCommitment && box.type.tokenId === PARTICIPATION && box.polarization === false;
                            });
                     }).map(([key, value]) => key);
                }
                
            } else if (game.status === GameState.Cancelled_Draining) {
                participations = await fetchParticipations(game);

            } else if (game.status === GameState.Finalized) {
                participations = await fetchParticipations(game);
            }

            if (game.status === 'Active') {
                targetDate = await block_height_to_timestamp(game.deadlineBlock, platform);
                deadlineDateDisplay = format(new Date(targetDate), "MMM d, yyyy 'at' HH:mm");
            } else if (game.status === 'Resolution') {
                targetDate = await block_height_to_timestamp(game.resolutionDeadline, platform);
                deadlineDateDisplay = `Judge period ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else if (game.status === 'Cancelled_Draining') {
                targetDate = await block_height_to_timestamp(game.unlockHeight, platform);
                deadlineDateDisplay = `Stake unlocks ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else {
                deadlineDateDisplay = "N/A";
            }

            acceptedJudgeNominations = game.status === "Active"
                ? (
                    await Promise.all(
                        game.judges.map(async (judge) => {
                            const judge_proof = await fetchReputationProofByTokenId(judge, ergo);
                            if (!judge_proof) return null;

                            const foundBox = judge_proof.current_boxes.find(
                                (box: RPBox) =>
                                    box.type.tokenId === GAME &&
                                    box.object_pointer === game?.gameId &&
                                    box.polarization
                            );
                            return foundBox ? judge : null;
                        })
                    )
                ).filter((j): j is string => j !== null)
                : [];

            
            const connectedAddress = get(address);
            if(get(connected) && connectedAddress && game) {
                let creatorPK: string | undefined;
                isOwner = false;
                isResolver = false;
                isJudge = false;
                isNominatedJudge = false;

                const userPKBytes = ErgoAddress.fromBase58(connectedAddress).getPublicKeys()[0];
                const userPKHex = userPKBytes ? uint8ArrayToHex(userPKBytes) : null;

                if (game.status === 'Active') {
                    creatorPK = game.gameCreatorPK_Hex;
                    if(userPKHex) {
                        isResolver = userPKHex === game.gameCreatorPK_Hex;
                        const own_proof = get(reputation_proof);
                        if (own_proof) {
                            isNominatedJudge = game.judges.includes(own_proof.token_id);

                            const foundBox = own_proof.current_boxes.find((box: RPBox) => 
                                box.type.tokenId === GAME && 
                                box.object_pointer === game?.gameId && 
                                box.polarization
                            );
                            const exists = !!foundBox;
                            isJudge = isNominatedJudge && exists;
                        }
                    }
                }
                else if (game.status === 'Resolution') {
                    creatorPK = game.originalCreatorPK_Hex;
                    if(userPKHex) {
                        isResolver = userPKHex === game.resolverPK_Hex;
                        const own_proof = get(reputation_proof);
                        if (own_proof) {
                            isNominatedJudge = game.judges.includes(own_proof.token_id);

                            const foundBox = own_proof.current_boxes.find((box: RPBox) => 
                                box.type.tokenId === GAME && 
                                box.object_pointer === game?.gameId && 
                                box.polarization
                            );
                            const exists = !!foundBox;
                            isJudge = isNominatedJudge && exists;
                        }
                    }
                }
                
                if (creatorPK && userPKHex) {
                    isOwner = userPKHex === creatorPK;
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
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    async function handleResolveGame() {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            const valid_participations = participations.filter((p) => p.status === 'Submitted')
            transactionId = await platform.resolveGame(game, valid_participations as ValidParticipation[], secret_S_input_resolve, acceptedJudgeNominations);
        } catch (e: any) { errorMessage = e.message; } finally { isSubmitting = false; }
    }

    async function handleCancelGame() {
        if (game?.status !== 'Active') return;
        errorMessage = null; isSubmitting = true;
        try {
            transactionId = await platform.cancel_game(game, secret_S_input_cancel, get(address) ?? "");
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

    async function handleClaimRefund(participation: ValidParticipation) {
        if (game?.status !== 'Cancelled_Draining' || participation.status !== 'Submitted') return
        isClaimingRefundFor = participation.boxId;
        claimRefundError[participation.boxId] = null;
        try {
            const result = await platform.claimAfterCancellation(game as GameCancellation, participation);
            claimRefundSuccessTxId[participation.boxId] = result;
        } catch (e: any) {
            claimRefundError[participation.boxId] = e.message || "Error claiming refund.";
        } finally {
            isClaimingRefundFor = null;
        }
    }

    async function handleReclaimAfterGrace(participation: ValidParticipation) {
        if (game?.status !== 'Active' || participation.status !== 'Submitted') return;

        isReclaimingGraceFor = participation.boxId;
        reclaimGraceError[participation.boxId] = null;
        reclaimGraceSuccessTxId[participation.boxId] = null;

        try {
            const result = await platform.reclaimAfterGrace(game as GameActive, participation);
            reclaimGraceSuccessTxId[participation.boxId] = result;
        } catch (e: any) {
            reclaimGraceError[participation.boxId] = e.message || "Error reclaiming participation fee.";
        } finally {
            isReclaimingGraceFor = null;
        }
    }

    async function handleEndGame() {
        if (game?.status !== 'Resolution') return;
        errorMessage = null; 
        isSubmitting = true;
        try {
            const valid_participations = participations.filter((p) => p.status === 'Submitted');
            transactionId = await platform.endGame(game, valid_participations as ValidParticipation[]);
        } catch (e: any) { 
            errorMessage = e.message;
        } finally { 
            isSubmitting = false;
        }
    }

    async function handleJudgesInvalidate() {
        if (game?.status !== 'Resolution') return;
        errorMessage = null; isSubmitting = true;
        try {

            const winner_participation = participations.filter((p) => game.winnerCandidateCommitment === p.commitmentC_Hex)[0]

            const winnerVotes = participationVotes.get(game.winnerCandidateCommitment);
            if (!winnerVotes) throw new Error("No votes found.");

            const judgeInvalidVotesDataInputs = Array.from(winnerVotes.entries()).filter(([key, value]) => {
                return candidateParticipationInvalidVotes.includes(key);
            })

            const judgeInvalidVotesDataInputsBoxes = judgeInvalidVotesDataInputs.map(([Key, value]) => {
                return value.current_boxes.filter((box) => {
                    return box.polarization === false && box.object_pointer === game.winnerCandidateCommitment && box.type.tokenId === PARTICIPATION;
                })[0].box;
            });
            
            const otherParticipations: ValidParticipation[] = participations.filter((p) => p.commitmentC_Hex !== winner_participation.commitmentC_Hex && p.status === 'Submitted') as ValidParticipation[];

            transactionId = await platform.judgesInvalidate(game, winner_participation as ValidParticipation, otherParticipations, judgeInvalidVotesDataInputsBoxes);
        } catch (e: any) { errorMessage = e.message;
        } finally { isSubmitting = false; }
    }

    async function handleIncludeOmitted() {
        const selectedOmittedBoxId = "";
        if (game?.status !== 'Resolution' || !selectedOmittedBoxId) return;
        errorMessage = null; 
        isSubmitting = true;
        try {
            const omittedParticipation = participations.find(p => p.boxId === selectedOmittedBoxId);
            if (!omittedParticipation || omittedParticipation.status !== 'Submitted') {
                throw new Error("La participación seleccionada no se ha encontrado.");
            }

            const currentWinner = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment && p.status === 'Submitted') as ValidParticipation | undefined;
            if (!currentWinner) {
                throw new Error("Ganador no encontrado.");
            }

            const userAddress = get(address);
            if (!userAddress) {
                throw new Error("Cartera no conectada.");
            }
            const newResolverPkHex = uint8ArrayToHex(ErgoAddress.fromBase58(userAddress).getPublicKeys()[0]);
            transactionId = await platform.includeOmittedParticipations(game, omittedParticipation, currentWinner, newResolverPkHex);
        } catch (e: any) { 
            errorMessage = e.message;
        } finally { 
            isSubmitting = false;
        }
    }

    async function handleJudgeNomination() {
        if (game?.status !== 'Active') return;
        errorMessage = null;
        isSubmitting = true;
        try {
            transactionId = await platform.acceptJudgeNomination(game);
        } catch (e: any) {
            errorMessage = e.message || "Error accepting judge nomination.";
        } finally {
            isSubmitting = false;
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

	function handleJudgeDetails(judge: string) {
        if (game) {
            const obj = get(judges).data.get(judge);
            if (obj) {
                judge_detail.set(obj);
                game_detail.set(null);
            }
        }
    }

    // --- UI Utility Functions ---

    function setupActionModal(type: typeof currentActionType) {
        currentActionType = type;
        const titles = {
            submit_score: `Submit Score`,
            resolve_game: `Resolve Game`,
            cancel_game: `Cancel Game`,
            drain_stake: `Drain Creator Stake`,
            end_game: `Finalize Game`,
            invalidate_winner: `Judge Invalidation`,
            include_omitted: `Include Omitted Participation`,
            accept_judge_nomination: 'Accept Judge Nomination'
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

    function getActualScore(p: AnyParticipation, secretHex: Uint8Array | undefined): bigint | null {
        if (!p.box || !p.box.additionalRegisters || !secretHex) return null;
        const pBox_R5_commitmentHex = parseCollByteToHex(p.box.additionalRegisters.R5?.renderedValue);
        const pBox_R7_solverIdHex_raw = parseCollByteToHex(p.box.additionalRegisters.R7?.renderedValue);
        const pBox_R8_hashLogsHex_raw = parseCollByteToHex(p.box.additionalRegisters.R8?.renderedValue);
        let r9ParsedArray: any[] | null = null;
        const r9ScoreListRaw = p.box.additionalRegisters.R9?.renderedValue;
        if (typeof r9ScoreListRaw === 'string') {
            try { r9ParsedArray = JSON.parse(r9ScoreListRaw);
            } catch (e) { /* silent fail */ }
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

    onMount(async () => {
        await fetchJudges();
        if (game) loadGameDetailsAndTimers();
    })

    onDestroy(() => {
        cleanupTimers();
        unsubscribeGameDetail();
    });

        // Función de utilidad para limitar los porcentajes a [0, 100]
    function clampPct(v) {
        return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }

    // === Cálculo de distribución de premios ===
    // Datos base según el tipo de juego
    let creatorPct = 0;
    let judgesTotalPct = 0;
    let developersPct = 0;
    let winnerPct = 0;

    if (game.status === 'Active') {
        creatorPct = Number(game.commissionPercentage ?? 0);
        judgesTotalPct = Number(game.perJudgeComissionPercentage ?? 0n) * game.judges.length;
        developersPct = Number(dev_fee);
    } else if (game.status === 'Resolution') {
        creatorPct = Number(game.resolverCommission ?? 0);
        judgesTotalPct = Number(game.perJudgeComissionPercentage ?? 0n) * game.judges.length;
        developersPct = Number(dev_fee);
    }

    // El porcentaje del ganador es lo que queda
    const totalPct = creatorPct + judgesTotalPct + developersPct;
    winnerPct = Math.max(0, 100 - totalPct);

    const overAllocated = totalPct > 100 ? (totalPct - 100).toFixed(2) : 0;
</script>

{#if game}
<Return on:back={handleViewDetails} />

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
                            <Users class="stat-icon"/>
                            <span>{game.reputation}</span>
                            <span class="stat-label">Reputation</span>
                        </div>
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
            <h2 class="text-2xl font-semibold mb-6">Details</h2>
            {#if game}
                {@const creator_pk = game.status === 'Active' ? game.gameCreatorPK_Hex : game.originalCreatorPK_Hex}
                {@const creatorAddr = pkHexToBase58Address(creator_pk)}
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
                    <div class="info-block">
                        <span class="info-label">Competition ID (NFT)</span>
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
                    {#if game.status === 'Resolution' && game.revealedS_Hex}
                        <div class="info-block col-span-1 md:col-span-2 lg:col-span-3">
                            <span class="info-label">Revealed Secret (S)</span>
                            <span class="info-value font-mono text-xs break-all">{game.revealedS_Hex}</span>
                        </div>
                    {/if}

                    {#if game.status === 'Resolution' || game.status === 'Active'}
                        <div class="form-group lg:col-span-2">
                            <Label>Prize Distribution</Label>

                            <div class="distribution-bar">
                                <div class="bar-segment winner" style:width="{clampPct(winnerPct)}%" title="Winner(s): {winnerPct.toFixed(2)}%"></div>
                                <div class="bar-segment creator" style:width="{clampPct(creatorPct)}%" title="Creator: {creatorPct.toFixed(2)}%"></div>
                                <div class="bar-segment judges" style:width="{clampPct(judgesTotalPct)}%" title="Judges Total: {judgesTotalPct.toFixed(2)}%"></div>
                                <div class="bar-segment developers" style:width="{clampPct(developersPct)}%" title="Dev Fund: {developersPct.toFixed(2)}%"></div>
                            </div>

                            <div class="distribution-legend">
                                <div class="legend-item">
                                    <div class="legend-color winner"></div>
                                    <span>Winner(s) ({winnerPct.toFixed(2)}%)</span>
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color creator"></div>
                                    <span>{game.status === 'Resolution' ? 'Resolver' : 'Creator'} ({creatorPct.toFixed(2)}%)</span>
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color judges"></div>
                                    <span>Judges ({judgesTotalPct.toFixed(2)}%)</span>
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color developers"></div>
                                    <span>Dev Fund ({developersPct.toFixed(2)}%)</span>
                                </div>
                            </div>

                            {#if overAllocated > 0}
                                <p class="text-xs mt-2 text-red-500">
                                    Warning: Total commission exceeds 100% by {overAllocated}%! The winner's prize will be 0.
                                </p>
                            {/if}
                        </div>
                    {/if}


                </div>
            {/if}
        </section>

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
                <p class="text-xs {$mode === 'dark' ? 'text-slate-400' : 'text-gray-600'} mt-1">Contract Status: {game.status}</p>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 md:mt-8">
                    {#if game.judges && game.judges.length > 0}
                        <div class="info-block col-span-1 md:col-span-2 lg:col-span-3">
                            <p class="text {$mode === 'dark' ? 'text-slate-400' : 'text-gray-600'} mt-1">
                                {#if game.status === 'Active'}
                                    Nominated Judges {isNominatedJudge ? '(You are a nominated judge)' : ''}
                                {:else if game.status === 'Resolution'}
                                    Judges' Votes
                                {/if}
                            </p>
                            <div class="info-value font-mono text-xs break-all mt-2">
                                {#each game.judges as judge}
                                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                                    <!-- svelte-ignore a11y-invalid-attribute -->
                                    <a href="#" on:click|preventDefault={() => handleJudgeDetails(judge)} class="cursor-pointer hover:underline text-blue-400 hover:text-blue-300">
                                        {judge.slice(0, 12)}...{judge.slice(-6)}
                                        {#if game.status === 'Active' && acceptedJudgeNominations && acceptedJudgeNominations.includes(judge)}
                                            <span class="text-green-500"> (accepted)</span>
                                        {:else if game.status === 'Resolution' && participationVotes.get(game.winnerCandidateCommitment) && candidateParticipationInvalidVotes.includes(judge)}
                                            <span class="text-red-500"> (invalidated)</span>
                                        {:else if game.status === 'Resolution' && participationVotes.get(game.winnerCandidateCommitment) && candidateParticipationValidVotes.includes(judge)}
                                            <span class="text-green-500"> (validated)</span>
                                        {:else if game.status === 'Resolution'}
                                            <span class="text-yellow-500"> (pending)</span>
                                        {/if}
                                    </a>
                                {/each}
                            </div>
                            {#if game.status === 'Active'}
                                <p class="text-sm font-medium text-yellow-400 mt-2">
                                    Trust requires a majority of {Math.floor(game.judges.length / 2) + 1} out of {game.judges.length} judges.
                                </p>
                                <p class="text-sm font-medium {$mode === 'dark' ? 'text-slate-300' : 'text-gray-400'} mt-1">
                                    Verify judges' history with a script to check past performance.
                                </p>
                            {:else if game.status === 'Resolution'}
                                {#if new Date().getTime() < targetDate}
                                    <p class="text-sm font-medium mt-2">
                                        The candidate can be invalidated if more than {Math.floor(game.judges.length / 2)} out of {game.judges.length} judges vote to invalidate.
                                    </p>
                                {:else}
                                   <p class="text-sm font-medium mt-2">
                                        The candidate can no longer be invalidated as the voting period has ended.
                                    </p>
                                {/if}
                            {/if}
                        </div>
                    {:else}
                        <div class="info-block col-span-1 md:col-span-2 lg:col-span-3">
                            <p class="text {$mode === 'dark' ? 'text-slate-400' : 'text-gray-600'} mt-1 text-lg font-semibold">
                                No Judges Assigned
                            </p>
                            <p class="text-sm font-medium text-yellow-400 mt-1">
                                Participants must trust the creator.
                            </p>
                            <p class="text-sm font-medium {$mode === 'dark' ? 'text-slate-300' : 'text-gray-400'} mt-2">
                                Verify creator’s history with a script to check past competition honesty.
                            </p>
                        </div>
                    {/if}
                </div>
            </div>
        
            <div class="actions-side md:border-l {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'} md:pl-8">
                <h2 class="text-2xl font-semibold mb-4">Available Actions</h2>
                <div class="space-y-4">
                    {#if $connected}

                        {#if game.status === 'Active' && !participationIsEnded}
                            {#if isNominatedJudge && !isJudge} <!-- Could be added !isOwner -->
                                <Button on:click={() => setupActionModal('accept_judge_nomination')} class="w-full">
                                    <Gavel class="mr-2 h-4 w-4"/> Accept Judge Nomination
                                </Button>
                            {/if}
                            
                            <Button on:click={() => setupActionModal('submit_score')} class="w-full">
                                <Edit class="mr-2 h-4 w-4"/>Submit My Score
                            </Button>
                            
                            <Button on:click={() => setupActionModal('cancel_game')} variant="destructive" class="w-full">
                                <XCircle class="mr-2 h-4 w-4"/>Cancel Competition
                            </Button>
                        {/if}

                        {#if game.status === 'Active' && participationIsEnded && isOwner}
                            <Button on:click={() => setupActionModal('resolve_game')} class="w-full">
                                <CheckSquare class="mr-2 h-4 w-4"/>Resolve Competition
                            </Button>
                        {/if}

                        {#if game.status === 'Resolution'}
                            {@const isBeforeDeadline = new Date().getTime() < targetDate}
                            
                            {#if isResolver}
                                <Button on:click={() => setupActionModal('end_game')} disabled={isBeforeDeadline} class="w-full">
                                    <Trophy class="mr-2 h-4 w-4"/> End Competition & Distribute Prizes
                                </Button>
                            {/if}

                            <Button 
                                on:click={() => setupActionModal('include_omitted')} 
                                disabled={!isBeforeDeadline} 
                                variant="outline" 
                                class="w-full"
                                title="Anyone can execute this action to claim the resolver's commission.">
                                <Users class="mr-2 h-4 w-4"/> Include Omitted Participations
                            </Button>

                            {#if isJudge}
                                <Button 
                                    on:click={() => setupActionModal('invalidate_winner')} 
                                    disabled={!isBeforeDeadline} 
                                    variant="destructive" 
                                    class="w-full">
                                    <XCircle class="mr-2 h-4 w-4"/> Judges: Invalidate Winner
                                </Button>
                            {/if}
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
                        <p class="info-box">Connect your wallet to interact with the game competition.</p>
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

                        {@const isCurrentUserParticipant = $connected && $address === pkHexToBase58Address(p.playerPK_Hex)}
                        {@const canClaimCancellationRefund = (game.status === 'Cancelled_Draining') && isCurrentUserParticipant && p.status === 'Submitted'}
                        {@const isGracePeriodOver = game.status === GameState.Active && participationIsEnded && currentHeight > game.deadlineBlock + GRACE_PERIOD_IN_BLOCKS}
                        {@const canReclaimAfterGrace = isGracePeriodOver && isCurrentUserParticipant && !p.spent}
                        {@const reclaimedAfterGrace = isGracePeriodOver && isCurrentUserParticipant && p.spent}
                        {@const isMalformed = p.status === 'Malformed'}
                        {@const isSubmitted = p.status === 'Submitted'}
                        {@const isConsumedByWinner = p.status === 'Consumed' && p.reason === 'bywinner'}
                        {@const isConsumedByParticipant = p.status === 'Consumed' && p.reason === 'byparticipant'}
                        {@const isInvalidated = p.status === 'Consumed' && p.reason === 'invalidated'}
                        {@const isCancelled = p.status === 'Consumed' && p.reason === "cancelled"}

                        <div class="participation-card relative rounded-lg shadow-lg overflow-hidden border
                            {isCurrentParticipationWinner
                                ? 'winner-card border-green-500/50'
                                : ($mode === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200')}
                            {isMalformed ? ($mode === 'dark' ? 'bg-gray-700 border-gray-800 opacity-70' : 'bg-gray-200 border-gray-300 opacity-70') : ''}">

                            {#if isCurrentParticipationWinner}
                                <div class="winner-badge">
                                    <Trophy class="w-4 h-4 mr-2" />
                                    <span>WINNER CANDIDATE</span>
                                </div>
                            {/if}
                            
                            {#if isMalformed}
                                <div class="expired-badge absolute top-6 right-16 bg-gray-500 text-white px-2 py-1 rounded-full text-xs font-semibold">
                                    MALFORMED
                                </div>
                            {/if}

                            {#if isInvalidated}
                                <div class="expired-badge absolute top-6 right-16 bg-red-600 text-white px-2 py-1 rounded-full text-xs font-semibold">
                                    DISQUALIFIED
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

                            <div class="card-body p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                                <div class="info-block">
                                    <span class="info-label">Fee Paid</span>
                                    <span class="info-value">{formatErg(p.value)} ERG</span>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Solver ID</span>
                                    <span class="info-value font-mono text-xs" title={p.solverId_String || p.solverId_RawBytesHex}>
                                        {#if p.solverId_String}
                                            {p.solverId_String.slice(0, 10)}...{p.solverId_String.slice(-4)}
                                        {:else}
                                            N/A
                                        {/if}
                                    </span>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Transaction ID</span>
                                    <a href="{web_explorer_uri_tx + p.transactionId}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={p.transactionId}>
                                        {p.transactionId.slice(0, 10)}...{p.transactionId.slice(-4)}
                                    </a>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Commitment</span>
                                    <!-- svelte-ignore a11y-missing-attribute -->
                                    <a class="info-value font-mono text-xs" title={p.commitmentC_Hex}>
                                        {p.commitmentC_Hex.slice(0, 10)}...{p.commitmentC_Hex.slice(-4)}
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
                                                    {#if game.status == "Active"}
                                                        (one of these is the real one)
                                                    {:else}
                                                       (Real Score: {actualScoreForThisParticipation})
                                                    {/if}
                                                </span>
                                            {/if}
                                        {/if}
                                    </div>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Block</span>
                                    <!-- svelte-ignore a11y-missing-attribute -->
                                    <a class="info-value font-mono text-xs">
                                        {p.creationHeight}
                                    </a>
                                </div>

                                {#if canReclaimAfterGrace}
                                    <div class="info-block sm:col-span-2 lg:col-span-3 mt-4 pt-4 border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
                                        <p class="text-xs mb-2 {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                                            The game creator failed to resolve the game in time. You can now reclaim your participation fee.
                                        </p>
                                        <Button 
                                            on:click={() => handleReclaimAfterGrace(p)} 
                                            disabled={isReclaimingGraceFor === p.boxId}
                                            class="w-full text-base bg-orange-600 hover:bg-orange-700">
                                            {#if isReclaimingGraceFor === p.boxId}
                                                Reclaiming...
                                            {:else}
                                                <ShieldCheck class="mr-2 h-4 w-4"/> Reclaim Participation Fee
                                            {/if}
                                        </Button>

                                        {#if reclaimGraceSuccessTxId[p.boxId]}
                                            <div class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50">
                                                <strong>Success! Transaction ID:</strong><br/>
                                                <a href="{web_explorer_uri_tx + reclaimGraceSuccessTxId[p.boxId]}" target="_blank" rel="noopener noreferrer" class="underline break-all hover:text-slate-400">
                                                    {reclaimGraceSuccessTxId[p.boxId]}
                                                </a>
                                            </div>
                                        {/if}

                                        {#if reclaimGraceError[p.boxId]}
                                            <p class="text-xs mt-1 text-red-400">{reclaimGraceError[p.boxId]}</p>
                                        {/if}
                                    </div>
                                {/if}
                                {#if reclaimedAfterGrace}
                                    <div class="info-block sm:col-span-2 lg:col-span-3 mt-4 pt-4 border-t {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
                                        <div class="my-2 p-3 rounded-md text-sm bg-blue-600/30 text-blue-300 border border-blue-500/50 flex items-center">
                                            <CheckCircle class="mr-2 h-5 w-5"/> 
                                            <p class="font-medium">
                                                Your participation fee has been successfully reclaimed after the grace period.
                                            </p>
                                        </div>
                                    </div>
                                {/if}

                                {#if canClaimCancellationRefund}
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
                                {:else if isCancelled && isCurrentUserParticipant && (game.status === GameState.Cancelled_Draining || game.status === GameState.Finalized)}
                                    <div class="info-block sm:col-span-2 lg:col-span-3 mt-2">
                                        <div class="p-3 rounded-md text-sm text-center {$mode === 'dark' ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600'}">
                                            <Check class="inline-block mr-2 h-5 w-5 text-gray-500"/>
                                            A refund has already been requested.
                                        </div>
                                    </div>
                                {/if}
                            </div>

                            {#if isMalformed && isCurrentUserParticipant}
                                <div class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4">
                                    <p class="text-xs {$mode === 'dark' ? 'text-gray-400' : 'text-gray-500'}">
                                        The funds will be awarded to the winner if the competition concludes successfully. If there is no winner, the funds will be allocated to the creator/resolver. Participants may only claim a refund if the competition is canceled..
                                    </p>
                                </div>
                            {/if}

                            {#if isInvalidated && isCurrentUserParticipant}
                                <div class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4">
                                    <p class="text-xs {$mode === 'dark' ? 'text-red-400' : 'text-red-600'}">
                                        Your participation was <strong>disqualified</strong> because the majority of judges deemed it malicious after attempting to reproduce its result. 
                                        Since participations are deterministic, the judges invalidate any that cannot be correctly replicated.
                                    </p>
                                </div>
                            {/if}

                            {#if isMalformed}
                                <div class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4">
                                    {#if p.reason === 'expired'}
                                        <p class="text-xs {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                                            <strong>Invalid participation:</strong> The participation was received outside the participation period and could not be processed.
                                        </p>
                                    {:else if p.reason === 'wrongcommitment'}
                                        <p class="text-xs {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                                            <strong>Invalid participation:</strong> There was an inconsistency when verifying the participation's data.
                                        </p>
                                    {:else if p.reason === 'maxscores'}
                                        <p class="text-xs {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                                            <strong>Invalid participation:</strong> The participation reached the maximum possible score, which is not eligible for the prize according to the game rules.
                                        </p>
                                    {:else if p.reason === 'unknown'}
                                        <p class="text-xs {$mode === 'dark' ? 'text-orange-400' : 'text-orange-600'}">
                                            <strong>Invalid participation:</strong> The participation could not be processed due to an unknown error.
                                        </p>
                                    {/if}
                                </div>
                            {/if}
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
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"><strong>Warning:</strong> Cancelling the competition will incur penalties, charged to the creator, and require refunding participants.</p>
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
                {:else if currentActionType === 'end_game'}
                    <div class="space-y-4">
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'bg-blue-100 text-blue-700 border border-blue-200'}">
                            <strong>Action: End Game</strong><br>
                            This will finalize the game, distributing the prize pool to the winner, your resolver fee, and other commissions. This action is irreversible.
                        </p>
                        <Button on:click={handleEndGame} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold">
                            {isSubmitting ? 'Processing...' : 'Confirm & End Game'}
                        </Button>
                    </div>
                {:else if currentActionType === 'invalidate_winner'}
                    <div class="space-y-4">
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}">
                            <strong>Action: Judge Invalidation</strong><br>
                            As a judge, you are voting to invalidate the current winner candidate. This requires a majority of judges to perform the same action. If successful, the resolution deadline will be extended.
                        </p>
                        <Button on:click={handleJudgesInvalidate} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-yellow-500 hover:bg-yellow-600 text-white'} font-semibold">
                            {isSubmitting ? 'Processing...' : 'Confirm Invalidation Vote'}
                        </Button>
                    </div>
                {:else if currentActionType === 'include_omitted'}
                     <div class="space-y-4">
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-gray-600/20 text-gray-300 border border-gray-500/30' : 'bg-gray-100 text-gray-700 border border-gray-200'}">
                            <strong>Action: Include Omitted Participation</strong><br>
                            All missed entries before the deadline will be selected by default. This will designate you as the new 'resolver' and will allow you to claim the creator's commission when the game ends.
                        </p>
                        <Button on:click={handleIncludeOmitted} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-gray-600 hover:bg-gray-700 text-white' : 'bg-gray-500 hover:bg-gray-600 text-white'} font-semibold">
                            {isSubmitting ? 'Processing...' : 'Confirm Inclusion'}
                        </Button>
                    </div>
                {:else if currentActionType === 'accept_judge_nomination'}
                    <div class="space-y-4">
                        <p class="text-sm p-3 rounded-md {$mode === 'dark' ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'bg-blue-100 text-blue-700 border border-blue-200'}">
                            <strong>Action: Accept Judge Nomination</strong><br>
                            By accepting, you agree to participate as a judge in this game, with the responsibility to review and potentially invalidate the winner if necessary.
                        </p>
                        <Button on:click={handleJudgeNomination} disabled={isSubmitting} class="w-full mt-3 py-2.5 text-base {$mode === 'dark' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold">
                            {isSubmitting ? 'Processing...' : 'Confirm Judge Nomination'}
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

    .info-box {
        @apply text-sm text-center p-3 rounded-md bg-slate-500/50;
    }
    :global(.light) .info-box {
        @apply bg-gray-100 text-black;
    }

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

    /* Prize Distribution Bar Styles */
    .distribution-bar {
        @apply w-full h-4 flex overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800;
        border: 1px solid theme('colors.slate.500 / 0.2');
    }
    .bar-segment {
        @apply h-full transition-all duration-300 ease-in-out;
    }
    .bar-segment.winner { background-color: #22c55e; } /* green-500 */
    .bar-segment.creator { background-color: #3b82f6; } /* blue-500 */
    .bar-segment.judges { background-color: #eab308; } /* yellow-500 */
    .bar-segment.developers { background-color: #a855f7; } /* purple-500 */

    .distribution-legend {
        @apply flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground;
    }
    .legend-item {
        @apply flex items-center gap-2;
    }
    .legend-color {
        @apply w-3 h-3 rounded-full;
    }
    .legend-color.winner { background-color: #22c55e; }
    .legend-color.creator { background-color: #3b82f6; }
    .legend-color.judges { background-color: #eab308; }
    .legend-color.developers { background-color: #a855f7; }
</style>