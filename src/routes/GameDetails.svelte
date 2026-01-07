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
        isGameParticipationEnded,
        isGameEnded,
        isOpenCeremony,
        resolve_participation_commitment,
        calculateEffectiveScore,
    } from "$lib/common/game";
    import { marked } from "marked";
    import {
        address,
        connected,
        game_detail,
        judge_detail,
        judges,
        reputation_proof,
    } from "$lib/common/store";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { onDestroy, onMount } from "svelte";
    import { get, writable } from "svelte/store";
    import {
        fetchParticipations,
        fetch_token_details,
        fetchParticipationBatches,
    } from "$lib/ergo/fetch";
    // UI COMPONENTS
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    // ICONS
    import {
        ShieldCheck,
        Calendar,
        Trophy,
        Users,
        Share2,
        Edit,
        CheckSquare,
        XCircle,
        ExternalLink,
        Gavel,
        Check,
        CheckCircle,
        Sparkles,
        Info,
        Trash2,
        ChevronDown,
        X,
        Cpu,
        FileText,
        Settings,
        ArrowUp,
    } from "lucide-svelte";
    // UTILITIES
    import { format, formatDistanceToNow } from "date-fns";
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import {
        web_explorer_uri_tkn,
        web_explorer_uri_tx,
        web_explorer_uri_addr,
        explorer_uri,
    } from "$lib/ergo/envs";
    import { type Amount, type Box, ErgoAddress } from "@fleet-sdk/core";
    import { uint8ArrayToHex, pkHexToBase58Address } from "$lib/ergo/utils";
    import { mode } from "mode-watcher";

    // SOURCE APPLICATION IMPORTS
    import { FileCard, FileSourceCreation } from "source-application";
    import { fetchFileSourcesByHash } from "source-application";

    import {
        getDisplayStake,
        getParticipationFee,
        formatTokenBigInt,
    } from "$lib/utils";
    import {
        fetchJudges,
        fetchReputationProofByTokenId,
    } from "$lib/ergo/reputation/fetch";
    import { type RPBox, type ReputationProof } from "reputation-system";
    import { GAME, PARTICIPATION } from "$lib/ergo/reputation/types";
    import { Forum } from "forum-application";

    const strictMode = true;

    const PARTICIPATION_BATCH_THRESHOLD = 2;

    // --- COMPONENT STATE ---
    let game: AnyGame | null = null;
    let platform = new ErgoPlatform();
    let participations: AnyParticipation[] = [];
    let participationVotes: Map<
        string,
        Map<string, ReputationProof>
    > = new Map();
    let candidateParticipationValidVotes: string[] = [];
    let candidateParticipationInvalidVotes: string[] = [];
    let currentHeight: number = 0;
    let participationBatches: Box<Amount>[] = [];

    // UI State
    let transactionId: string | null = null;
    let modalTitle: string = "";
    let errorMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let isSubmitting: boolean = false;
    let showCopyMessage = false;
    let showInfoBlocks = false;

    // Game Status State
    let participationIsEnded = true;
    let deadlineDateDisplay = "N/A";
    let isOwner = false;
    let isResolver = false;
    let isJudge = false;
    let isNominatedJudge = false;
    let openCeremony = false;
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
    let daysValue = 0,
        hoursValue = 0,
        minutesValue = 0,
        secondsValue = 0;
    let targetDate: number;
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;

    // Modal State
    let showActionModal = false;
    let currentActionType:
        | "submit_score"
        | "resolve_game"
        | "cancel_game"
        | "drain_stake"
        | "end_game"
        | "invalidate_winner"
        | "include_omitted"
        | "accept_judge_nomination"
        | "open_ceremony"
        | "batch_participations"
        | "submit_creator_opinion"
        | null = null;
    let tokenSymbol = "ERG";
    let tokenDecimals = 9;

    // File Source Modal State
    let showFileSourceModal = false;
    let modalFileHash = "";
    let modalFileType: "image" | "service" | "paper" = "image";
    let imageSources: any[] = [];
    let serviceSources: any[] = [];
    let paperSources: any[] = [];
    let paperContent: string | null = null;
    let isPaperExpanded = false;
    let paperToc: { level: number; text: string; id: string }[] = [];

    function openFileSourceModal(
        hash: string,
        type: "image" | "service" | "paper",
    ) {
        modalFileHash = hash;
        modalFileType = type;
        showFileSourceModal = true;
    }

    function closeFileSourceModal() {
        showFileSourceModal = false;
        modalFileHash = "";
    }

    async function handleFileSourceAdded(txId: string) {
        console.log(`${modalFileType} source added:`, txId);
        closeFileSourceModal();
        if (modalFileHash) {
            // Refresh sources
            if (modalFileType === "image") {
                imageSources = await fetchFileSourcesByHash(
                    modalFileHash,
                    get(explorer_uri),
                );
            } else if (modalFileType === "service") {
                serviceSources = await fetchFileSourcesByHash(
                    modalFileHash,
                    get(explorer_uri),
                );
            } else if (modalFileType === "paper") {
                paperSources = await fetchFileSourcesByHash(
                    modalFileHash,
                    get(explorer_uri),
                );
            }
        }
    }

    // Form Inputs
    let commitmentC_input = "";
    let solverId_input = "";
    let hashLogs_input = "";
    let scores_input = "";
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";

    // Tabs State
    let activeTab: "participations" | "forum" = "participations";

    // --- LOGIC ---
    const unsubscribeGameDetail = game_detail.subscribe((value) => {
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

        currentHeight = await ergo.get_current_height();

        isSubmitting = false;
        transactionId = null;
        errorMessage = null;
        try {
            participationIsEnded = await isGameParticipationEnded(game);
            openCeremony = await isOpenCeremony(game);

            if (game.content.image) {
                imageSources = await fetchFileSourcesByHash(
                    game.content.image,
                    get(explorer_uri),
                );
            }
            if (game.content.serviceId) {
                serviceSources = await fetchFileSourcesByHash(
                    game.content.serviceId,
                    get(explorer_uri),
                );
            }
            if (game.content.paper) {
                paperSources = await fetchFileSourcesByHash(
                    game.content.paper,
                    get(explorer_uri),
                );
                if (paperSources.length > 0) {
                    try {
                        const response = await fetch(paperSources[0].sourceUrl);
                        if (response.ok) {
                            paperContent = await response.text();
                            extractToc(paperContent);
                        }
                    } catch (e) {
                        console.error("Error fetching paper content:", e);
                    }
                }
            }

            if (game.participationTokenId) {
                const tokenDetails = await fetch_token_details(
                    game.participationTokenId,
                );
                tokenSymbol = tokenDetails.name;
                tokenDecimals = tokenDetails.decimals;
            } else {
                tokenSymbol = "ERG";
                tokenDecimals = 9;
            }

            if (game.status === "Active") {
                participations = await fetchParticipations(game);
            } else if (game.status === "Resolution") {
                participations = await fetchParticipations(game);
                participationBatches = await fetchParticipationBatches(game);
                participations.forEach(async (item) => {
                    const participation = item.commitmentC_Hex;
                    const votes = new Map<string, ReputationProof>(
                        Array.from(get(judges).data.entries()).filter(
                            ([key, judge]) => {
                                return judge.current_boxes.some((box) => {
                                    return (
                                        box.object_pointer === participation &&
                                        box.type.tokenId === PARTICIPATION
                                    );
                                });
                            },
                        ),
                    );

                    participationVotes.set(participation, votes);
                });

                const candidate_participation_votes = Array.from(
                    participationVotes
                        .get(game.winnerCandidateCommitment)
                        ?.entries() ?? [],
                );
                if (candidate_participation_votes) {
                    candidateParticipationValidVotes =
                        candidate_participation_votes
                            .filter(([key, value]) => {
                                return value.current_boxes.some((box) => {
                                    return (
                                        box.object_pointer ===
                                            game.winnerCandidateCommitment &&
                                        box.type.tokenId === PARTICIPATION &&
                                        box.polarization === true
                                    );
                                });
                            })
                            .map(([key, value]) => key);

                    candidateParticipationInvalidVotes =
                        candidate_participation_votes
                            .filter(([key, value]) => {
                                return value.current_boxes.some((box) => {
                                    return (
                                        box.object_pointer ===
                                            game.winnerCandidateCommitment &&
                                        box.type.tokenId === PARTICIPATION &&
                                        box.polarization === false
                                    );
                                });
                            })
                            .map(([key, value]) => key);
                }
            } else if (game.status === GameState.Cancelled_Draining) {
                participations = await fetchParticipations(game);
            } else if (game.status === GameState.Finalized) {
                participations = await fetchParticipations(game);
            }

            if (game.status === "Active") {
                targetDate = await block_height_to_timestamp(
                    game.deadlineBlock,
                    platform,
                );
                deadlineDateDisplay = format(
                    new Date(targetDate),
                    "MMM d, yyyy 'at' HH:mm",
                );
            } else if (game.status === "Resolution") {
                targetDate = await block_height_to_timestamp(
                    game.resolutionDeadline,
                    platform,
                );
                deadlineDateDisplay = `Judge period ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else if (game.status === "Cancelled_Draining") {
                targetDate = await block_height_to_timestamp(
                    game.unlockHeight,
                    platform,
                );
                deadlineDateDisplay = `Stake unlocks ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else {
                deadlineDateDisplay = "N/A";
            }

            acceptedJudgeNominations =
                game.status === "Active"
                    ? (
                          await Promise.all(
                              game.judges.map(async (judge) => {
                                  const judge_proof =
                                      await fetchReputationProofByTokenId(
                                          judge,
                                      );
                                  if (!judge_proof) return null;

                                  const foundBox =
                                      judge_proof.current_boxes.find(
                                          (box: RPBox) =>
                                              box.type.tokenId === GAME &&
                                              box.object_pointer ===
                                                  game?.gameId &&
                                              box.polarization,
                                      );
                                  return foundBox ? judge : null;
                              }),
                          )
                      ).filter((j): j is string => j !== null)
                    : [];

            const connectedAddress = get(address);
            if (get(connected) && connectedAddress && game) {
                isResolver = false;
                isJudge = false;
                isNominatedJudge = false;

                const userPKBytes =
                    ErgoAddress.fromBase58(connectedAddress).getPublicKeys()[0];
                const userPKHex = userPKBytes
                    ? uint8ArrayToHex(userPKBytes)
                    : null;

                if (game.status === "Active") {
                    if (userPKHex) {
                        const own_proof = get(reputation_proof);
                        if (own_proof) {
                            isNominatedJudge = game.judges.includes(
                                own_proof.token_id,
                            );

                            const foundBox = own_proof.current_boxes.find(
                                (box: RPBox) =>
                                    box.type.tokenId === GAME &&
                                    box.object_pointer === game?.gameId &&
                                    box.polarization,
                            );
                            const exists = !!foundBox;
                            isJudge = isNominatedJudge && exists;
                        }
                    }
                } else if (game.status === "Resolution") {
                    if (userPKHex) {
                        isResolver = userPKHex === game.resolverPK_Hex;
                        const own_proof = get(reputation_proof);
                        if (own_proof) {
                            isNominatedJudge = game.judges.includes(
                                own_proof.token_id,
                            );

                            const foundBox = own_proof.current_boxes.find(
                                (box: RPBox) =>
                                    box.type.tokenId === GAME &&
                                    box.object_pointer === game?.gameId &&
                                    box.polarization,
                            );
                            const exists = !!foundBox;
                            isJudge = isNominatedJudge && exists;
                        }
                    }
                }
            }

            cleanupTimers();
            if (!participationIsEnded && game.status === "Active") {
                clockCountdownInterval = setInterval(
                    updateClockCountdown,
                    1000,
                );
                updateClockCountdown();
            }
        } catch (error: any) {
            errorMessage =
                "Could not load game details: " +
                (error.message || "Unknown error");
        }
    }

    // --- Action Handlers ---

    async function handleOpenCeremony() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            transactionId = await platform.contribute_to_ceremony(game);
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleSubmitScore() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const parsedScores = scores_input
                .split(",")
                .map((s) => BigInt(s.trim()));
            transactionId = await platform.submitScoreToGopGame(
                game,
                parsedScores,
                commitmentC_input,
                solverId_input,
                hashLogs_input,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleResolveGame() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const valid_participations = participations.filter(
                (p) => p.status === "Submitted",
            );
            transactionId = await platform.resolveGame(
                game,
                valid_participations as ValidParticipation[],
                secret_S_input_resolve,
                acceptedJudgeNominations,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleCancelGame() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            transactionId = await platform.cancel_game(
                game,
                secret_S_input_cancel,
                get(address) ?? "",
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleDrainStake() {
        if (!iGameDrainingStaking(game)) return;
        errorMessage = null;
        isSubmitting = true;
        try {
            transactionId = await platform.drain_cancelled_game_stake(
                game,
                get(address) ?? "",
            );
        } catch (e: any) {
            errorMessage = e.message || "Error draining stake.";
        } finally {
            isSubmitting = false;
        }
    }

    async function handleClaimRefund(participation: ValidParticipation) {
        if (
            game?.status !== "Cancelled_Draining" ||
            participation.status !== "Submitted"
        )
            return;
        isClaimingRefundFor = participation.boxId;
        claimRefundError[participation.boxId] = null;
        try {
            const result = await platform.claimAfterCancellation(
                game as GameCancellation,
                participation,
            );
            claimRefundSuccessTxId[participation.boxId] = result;
        } catch (e: any) {
            claimRefundError[participation.boxId] =
                e.message || "Error claiming refund.";
        } finally {
            isClaimingRefundFor = null;
        }
    }

    async function handleReclaimAfterGrace(participation: ValidParticipation) {
        if (game?.status !== "Active" || participation.status !== "Submitted")
            return;

        isReclaimingGraceFor = participation.boxId;
        reclaimGraceError[participation.boxId] = null;
        reclaimGraceSuccessTxId[participation.boxId] = null;

        try {
            const result = await platform.reclaimAfterGrace(
                game as GameActive,
                participation,
            );
            reclaimGraceSuccessTxId[participation.boxId] = result;
        } catch (e: any) {
            reclaimGraceError[participation.boxId] =
                e.message || "Error reclaiming participation fee.";
        } finally {
            isReclaimingGraceFor = null;
        }
    }

    async function handleEndGame() {
        if (game?.status !== "Resolution") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const valid_participations = participations.filter(
                (p) => p.status === "Submitted",
            );
            transactionId = await platform.endGame(
                game,
                valid_participations as ValidParticipation[],
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleBatchParticipations() {
        if (game?.status !== "Resolution") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const valid_participations = participations.filter(
                (p) => p.status === "Submitted",
            ) as ValidParticipation[];
            transactionId = await platform.batchParticipations(
                game,
                valid_participations,
                participationBatches,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJudgesInvalidate() {
        if (game?.status !== "Resolution") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const winner_participation = participations.filter(
                (p) => game.winnerCandidateCommitment === p.commitmentC_Hex,
            )[0];

            let judgeInvalidVotesDataInputsBoxes: Box<Amount>[] = [];
            const winnerVotes = participationVotes.get(
                game.winnerCandidateCommitment,
            );
            if (winnerVotes) {
                const judgeInvalidVotesDataInputs = Array.from(
                    winnerVotes.entries(),
                ).filter(([key, value]) => {
                    return candidateParticipationInvalidVotes.includes(key);
                });

                judgeInvalidVotesDataInputsBoxes =
                    judgeInvalidVotesDataInputs.map(([Key, value]) => {
                        return value.current_boxes.filter((box) => {
                            return (
                                box.polarization === false &&
                                box.object_pointer ===
                                    game.winnerCandidateCommitment &&
                                box.type.tokenId === PARTICIPATION
                            );
                        })[0].box;
                    });
            }

            const otherParticipations: ValidParticipation[] =
                participations.filter(
                    (p) =>
                        p.commitmentC_Hex !==
                            winner_participation.commitmentC_Hex &&
                        p.status === "Submitted",
                ) as ValidParticipation[];

            transactionId = await platform.judgesInvalidate(
                game,
                winner_participation as ValidParticipation,
                otherParticipations,
                judgeInvalidVotesDataInputsBoxes,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleIncludeOmitted() {
        console.log("handleIncludeOmitted called");

        if (!game || game.status !== "Resolution") return;

        errorMessage = null;
        isSubmitting = true;

        try {
            // Filtrar participaciones con estado "Submitted"
            const submittedParticipations = participations.filter(
                (p) => p.status === "Submitted",
            ) as ValidParticipation[];

            if (submittedParticipations.length === 0) {
                throw new Error("No hay participaciones enviadas.");
            }

            // Obtener la participación con el score más alto
            const omittedParticipation = submittedParticipations.reduce(
                (best, current) => {
                    const bestEffective = calculateEffectiveScore(
                        best.score,
                        game.deadlineBlock,
                        best.creationHeight,
                    );
                    const currentEffective = calculateEffectiveScore(
                        current.score,
                        game.deadlineBlock,
                        current.creationHeight,
                    );

                    if (currentEffective > bestEffective) return current;
                    if (
                        currentEffective === bestEffective &&
                        current.creationHeight < best.creationHeight
                    )
                        return current;
                    return best;
                },
            );

            // Buscar el ganador actual (puede no existir)
            const currentWinner = participations.find(
                (p) =>
                    p.commitmentC_Hex === game.winnerCandidateCommitment &&
                    p.status === "Submitted",
            ) as ValidParticipation | undefined;

            // Si ya hay ganador y es el mismo que la participación más alta, salimos
            if (
                currentWinner &&
                omittedParticipation.commitmentC_Hex ===
                    currentWinner.commitmentC_Hex
            ) {
                console.log(
                    "La participación con mayor score ya es el ganador actual. No se hace nada.",
                );
                return;
            }

            // Continuar con la inclusión de omitidos (tanto si no hay ganador como si el mejor no coincide)
            const userAddress = get(address);
            if (!userAddress) {
                throw new Error("Cartera no conectada.");
            }

            const newResolverPkHex = uint8ArrayToHex(
                ErgoAddress.fromBase58(userAddress).getPublicKeys()[0],
            );

            transactionId = await platform.includeOmittedParticipations(
                game,
                omittedParticipation,
                currentWinner ?? null, // pasa null si no hay ganador actual
                newResolverPkHex,
            );

            console.log("Transacción enviada:", transactionId);
        } catch (e: any) {
            errorMessage = e.message;
            console.error("Error en handleIncludeOmitted:", e);
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJudgeNomination() {
        if (game?.status !== "Active") return;
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

    async function handleSubmitCreatorOpinion() {
        if (!game) return;
        errorMessage = null;
        isSubmitting = true;
        try {
            transactionId = await platform.submitCreatorOpinion(game);
        } catch (e: any) {
            errorMessage = e.message || "Error submitting opinion.";
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJsonFileUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        jsonUploadError = null;
        errorMessage = null;
        if (target.files && target.files[0]) {
            const file = target.files[0];
            if (file.type === "application/json") {
                try {
                    const fileContent = await file.text();
                    const jsonData = JSON.parse(fileContent);
                    if (
                        jsonData.solver_id &&
                        typeof jsonData.solver_id === "string"
                    )
                        solverId_input = jsonData.solver_id;
                    else throw new Error("Missing 'solver_id'");
                    if (
                        jsonData.hash_logs_hex &&
                        typeof jsonData.hash_logs_hex === "string"
                    )
                        hashLogs_input = jsonData.hash_logs_hex;
                    else throw new Error("Missing 'hash_logs_hex'");
                    if (
                        jsonData.commitment_c_hex &&
                        typeof jsonData.commitment_c_hex === "string"
                    )
                        commitmentC_input = jsonData.commitment_c_hex;
                    else throw new Error("Missing 'commitment_c_hex'");
                    if (
                        jsonData.score_list &&
                        Array.isArray(jsonData.score_list) &&
                        jsonData.score_list.every(
                            (item: any) =>
                                typeof item === "number" ||
                                typeof item === "string",
                        )
                    ) {
                        scores_input = jsonData.score_list
                            .map((s: number | string) => s.toString())
                            .join(", ");
                    } else throw new Error("Missing or invalid 'score_list'");
                } catch (e: any) {
                    jsonUploadError = `Error reading JSON: ${e.message}`;
                    commitmentC_input = "";
                    solverId_input = "";
                    hashLogs_input = "";
                    scores_input = "";
                }
            } else
                jsonUploadError =
                    "Invalid file type. Please upload a .json file.";
            target.value = "";
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
        console.log("setupActionModal called with type:", type);
        currentActionType = type;
        const titles = {
            submit_score: `Submit Score`,
            resolve_game: `Resolve Game`,
            cancel_game: `Cancel Game`,
            drain_stake: `Drain Creator Stake`,
            end_game: `Finalize Game`,
            invalidate_winner: `Judge Invalidation`,
            include_omitted: `Include Omitted Participation`,
            accept_judge_nomination: "Accept Judge Nomination",
            open_ceremony: "Add Seed Randomness",
            batch_participations: "Batch Participations",
            submit_creator_opinion: "Verify Game (Creator Opinion)",
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
        navigator.clipboard
            .writeText(urlToCopy)
            .then(() => {
                showCopyMessage = true;
                setTimeout(() => {
                    showCopyMessage = false;
                }, 2500);
            })
            .catch((err) => console.error("Failed to copy game URL: ", err));
    }

    function updateClockCountdown() {
        if (!targetDate) return;
        const diff = targetDate - new Date().getTime();
        if (diff > 0) {
            daysValue = Math.floor(diff / (1000 * 60 * 60 * 24));
            hoursValue = Math.floor(
                (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
            );
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

    onMount(async () => {
        await fetchJudges();
        if (game) loadGameDetailsAndTimers();
    });

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

    if (game) {
        if (game.status === "Active") {
            creatorPct = Number(game.commissionPercentage ?? 0) / 10000;
            judgesTotalPct =
                (Number(game.perJudgeComissionPercentage ?? 0n) *
                    game.judges.length) /
                10000;
            developersPct = Number(
                game.constants.DEV_COMMISSION_PERCENTAGE ?? 0,
            );
        } else if (game.status === "Resolution") {
            creatorPct = Number(game.resolverCommission ?? 0) / 10000;
            judgesTotalPct =
                (Number(game.perJudgeComissionPercentage ?? 0n) *
                    game.judges.length) /
                10000;
            developersPct = Number(
                game.constants.DEV_COMMISSION_PERCENTAGE ?? 0,
            );
        }
    }

    // El porcentaje del ganador es lo que queda
    const totalPct = creatorPct + judgesTotalPct + developersPct;
    winnerPct = Math.max(0, 100 - totalPct);

    const overAllocated = totalPct > 100 ? (totalPct - 100).toFixed(2) : 0;

    // --- Image Resolution Logic ---
    let resolvedImageSrc = game?.content?.imageURL ?? "";
    $: {
        if (game?.content?.image) {
            if (imageSources.length > 0) {
                resolvedImageSrc = imageSources[0].url;
            } else {
                resolvedImageSrc = game?.content.imageURL ?? "";
            }
        } else {
            resolvedImageSrc = game?.content.imageURL ?? "";
        }
    }

    // --- Paper Content Logic ---
    const paperRenderer = new marked.Renderer();
    paperRenderer.heading = function ({
        text,
        depth,
    }: {
        text: string;
        depth: number;
    }) {
        const id = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .replace(/\s+/g, "-");
        // Add scroll-mt-24 to ensure header is not hidden behind fixed elements when scrolling
        return `<h${depth} id="${id}" class="scroll-mt-24">${text}</h${depth}>`;
    };

    function extractToc(markdown: string) {
        const lines = markdown.split("\n");
        const toc: { level: number; text: string; id: string }[] = [];
        // Regex to match headers: # Header, ## Header, etc.
        const headerRegex = /^(#{1,6})\s+(.*)$/;

        lines.forEach((line) => {
            const match = line.match(headerRegex);
            if (match) {
                const level = match[1].length;
                const text = match[2].trim();
                // Create a simple ID from text
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, "")
                    .replace(/\s+/g, "-");
                toc.push({ level, text, id });
            }
        });
        paperToc = toc;
    }

    function togglePaper() {
        isPaperExpanded = !isPaperExpanded;
        if (!isPaperExpanded) {
            const element = document.getElementById("paper-content-start");
            if (element) {
                element.scrollIntoView({ behavior: "smooth" });
            }
        }
    }

    function scrollToToc() {
        const element = document.getElementById("paper-toc");
        if (element) {
            element.scrollIntoView({ behavior: "smooth" });
        } else {
            // Fallback if TOC is not rendered or part of start
            const startElement = document.getElementById("paper-content-start");
            if (startElement) {
                startElement.scrollIntoView({ behavior: "smooth" });
            }
        }
    }

    function scrollToSection(id: string) {
        // We need to wait for the DOM to update if we are expanding
        if (!isPaperExpanded) {
            isPaperExpanded = true;
            setTimeout(() => {
                const element = document.getElementById(id);
                if (element) {
                    element.scrollIntoView({ behavior: "smooth" });
                }
            }, 100);
        } else {
            const element = document.getElementById(id);
            if (element) {
                element.scrollIntoView({ behavior: "smooth" });
            }
        }
    }
</script>

{#if game}
    <div
        class="game-detail-page min-h-screen {$mode === 'dark'
            ? 'bg-slate-900 text-gray-200'
            : 'bg-gray-50 text-gray-800'}"
    >
        <div
            class="game-container w-full md:max-w-[95%] mx-auto px-0 md:px-4 lg:px-8 py-0 md:py-8"
        >
            <section
                class="hero-section relative md:rounded-xl md:shadow-2xl overflow-hidden mb-6 md:mb-12"
            >
                <div class="hero-bg-image">
                    {#if resolvedImageSrc}
                        <img
                            src={resolvedImageSrc}
                            alt=""
                            class="absolute inset-0 w-full h-full object-cover blur-md scale-110"
                        />
                    {/if}
                    <div
                        class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/60 to-transparent"
                    ></div>
                </div>
                <div
                    class="relative z-10 p-4 md:p-12 flex flex-col md:flex-row gap-8 items-center text-white"
                >
                    {#if resolvedImageSrc}
                        <div class="md:w-1/3 flex-shrink-0">
                            <img
                                src={resolvedImageSrc}
                                alt="{game.content.title} banner"
                                class="w-full h-auto max-h-96 object-contain rounded-lg shadow-lg"
                            />
                        </div>
                    {/if}
                    <div
                        class="flex-1 text-center md:text-left mt-6 md:mt-0 ml-0 md:ml-6"
                    >
                        <h1
                            class="text-4xl lg:text-5xl font-bold font-['Russo_One'] mb-3 text-white"
                        >
                            {game.content.title}
                        </h1>

                        <div
                            class="stat-blocks-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4"
                        >
                            <div class="stat-block">
                                <Users class="stat-icon" />
                                <span>{game.reputation}</span>
                                <span class="stat-label">Reputation</span>
                            </div>
                            <div class="stat-block">
                                <Edit class="stat-icon" />
                                <span
                                    >{formatTokenBigInt(
                                        getParticipationFee(game),
                                        tokenDecimals,
                                    )}
                                    {tokenSymbol}</span
                                >
                                <span class="stat-label">Fee per Player</span>
                            </div>
                            <div class="stat-block">
                                <Users class="stat-icon" />
                                <span>{participations.length}</span>
                                <span class="stat-label">Participants</span>
                            </div>
                            <div class="stat-block">
                                <Trophy class="stat-icon" />
                                <span>
                                    {formatTokenBigInt(
                                        getParticipationFee(game) *
                                            BigInt(participations.length),
                                        tokenDecimals,
                                    )}
                                    {tokenSymbol}</span
                                >
                                <span class="stat-label">Prize Pool</span>
                            </div>
                            <div class="stat-block">
                                <ShieldCheck class="stat-icon" />
                                <span
                                    >{formatTokenBigInt(
                                        getDisplayStake(game),
                                        tokenDecimals,
                                    )}
                                    {tokenSymbol}</span
                                >
                                <span class="stat-label">Creator Stake</span>
                            </div>
                            <div class="stat-block">
                                <CheckSquare class="stat-icon" />
                                <span
                                    >{game.status == "Active"
                                        ? (
                                              game.commissionPercentage / 10000
                                          ).toFixed(4)
                                        : game.status == "Resolution"
                                          ? (
                                                game.resolverCommission / 10000
                                            ).toFixed(4)
                                          : "N/A"}%</span
                                >
                                <span class="stat-label"
                                    >Creator Commission</span
                                >
                            </div>
                        </div>
                        <div class="stat-block mt-4">
                            <Calendar class="stat-icon" />
                            <span>{deadlineDateDisplay.split(" at ")[0]}</span>
                            <!-- svelte-ignore a11y-missing-attribute -->
                            <a
                                >b.{game.status == "Active"
                                    ? game.deadlineBlock
                                    : game.status == "Resolution"
                                      ? game.resolutionDeadline
                                      : game.status == "Cancelled_Draining"
                                        ? game.unlockHeight
                                        : "N/A"}</a
                            >
                            <span class="stat-label">Deadline</span>
                        </div>

                        {#if !participationIsEnded && targetDate}
                            <div class="countdown-container">
                                <div
                                    class="timeleft {participationIsEnded
                                        ? 'ended'
                                        : ''}"
                                >
                                    <span class="timeleft-label">
                                        {#if participationIsEnded}
                                            TIME'S UP!
                                            <small class="secondary-text"
                                                >Awaiting resolution...</small
                                            >
                                        {:else}
                                            TIME LEFT
                                            <small class="secondary-text"
                                                >until participation ends</small
                                            >
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

                        <div
                            class="mt-8 flex items-center justify-center md:justify-start gap-3"
                        >
                            {#if game.content.webLink}
                                <a
                                    href={game.content.webLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Button
                                        class="text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                                    >
                                        <ExternalLink class="mr-2 h-4 w-4" />
                                        Visit Game Site
                                    </Button>
                                </a>
                            {/if}

                            <Button
                                on:click={shareGame}
                                class="text-sm text-white bg-white/10 backdrop-blur-sm border-none hover:bg-white/20 rounded-lg"
                            >
                                <Share2 class="mr-2 h-4 w-4" />
                                Share Game
                            </Button>
                            {#if showCopyMessage}
                                <span
                                    class="text-xs text-green-400 ml-2 transition-opacity duration-300"
                                    >Link Copied!</span
                                >
                            {/if}
                        </div>
                    </div>
                </div>
            </section>
        </div>

        <div
            class="game-container w-full md:max-w-[95%] mx-auto px-0 md:px-4 lg:px-8 py-0 md:py-8"
        >
            <section
                class="game-info-section mb-6 md:mb-12 p-4 md:p-6 md:rounded-xl md:shadow-lg bg-card border-y md:border border-border/50"
            >
                {#if game}
                    {@const creator = game.content.creatorReputationProof}
                    <div
                        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6"
                    >
                        <div
                            class="prose prose-sm {$mode === 'dark'
                                ? 'text-slate-300'
                                : 'text-gray-800'} max-w-none mb-6 md:col-span-2 lg:col-span-3"
                        >
                            {@html marked.parse(
                                game.content.description ||
                                    "No description available.",
                            )}

                            {#if paperContent}
                                <div
                                    class="mt-8 border-t border-border pt-8"
                                    id="paper-content-start"
                                >
                                    <div class="flex items-center gap-2 mb-4">
                                        <FileText
                                            class="w-5 h-5 text-amber-500"
                                        />
                                        <h3 class="text-lg font-semibold">
                                            Paper Content
                                        </h3>
                                    </div>

                                    <div class="relative">
                                        <div
                                            class="prose prose-sm {$mode ===
                                            'dark'
                                                ? 'prose-invert'
                                                : ''} max-w-none transition-all duration-500 ease-in-out {isPaperExpanded
                                                ? ''
                                                : 'max-h-96 overflow-hidden'}"
                                        >
                                            <!-- TOC -->
                                            {#if isPaperExpanded && paperToc.length > 0}
                                                <div
                                                    class="mb-6 p-4 bg-muted/50 rounded-lg"
                                                    id="paper-toc"
                                                >
                                                    <h4
                                                        class="text-sm font-semibold mb-2 uppercase tracking-wider text-muted-foreground"
                                                    >
                                                        Table of Contents
                                                    </h4>
                                                    <nav
                                                        class="flex flex-col gap-1"
                                                    >
                                                        {#each paperToc as item}
                                                            <button
                                                                class="text-left text-sm hover:text-primary transition-colors truncate w-full"
                                                                style="padding-left: {(item.level -
                                                                    1) *
                                                                    12}px"
                                                                on:click={() =>
                                                                    scrollToSection(
                                                                        item.id,
                                                                    )}
                                                            >
                                                                {item.text}
                                                            </button>
                                                        {/each}
                                                    </nav>
                                                </div>
                                            {/if}

                                            {@html marked.parse(paperContent, {
                                                renderer: paperRenderer,
                                            })}
                                        </div>

                                        {#if !isPaperExpanded}
                                            <div
                                                class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent flex items-end justify-center pb-4"
                                            >
                                                <Button
                                                    variant="secondary"
                                                    on:click={togglePaper}
                                                    class="shadow-lg"
                                                >
                                                    Read Full Paper
                                                    <ChevronDown
                                                        class="ml-2 w-4 h-4"
                                                    />
                                                </Button>
                                            </div>
                                        {/if}
                                    </div>

                                    {#if isPaperExpanded}
                                        <div
                                            class="sticky bottom-20 flex justify-center mt-8 pointer-events-none gap-4 z-10"
                                        >
                                            <Button
                                                variant="secondary"
                                                on:click={scrollToToc}
                                                class="shadow-lg pointer-events-auto opacity-90 hover:opacity-100"
                                                title="Back to Table of Contents"
                                            >
                                                <ArrowUp class="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                on:click={togglePaper}
                                                class="shadow-lg pointer-events-auto opacity-90 hover:opacity-100"
                                            >
                                                Collapse Paper
                                                <ChevronDown
                                                    class="ml-2 w-4 h-4 rotate-180"
                                                />
                                            </Button>
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>

                        <div class="form-group lg:col-span-2">
                            <div class="flex items-center gap-2 mb-3">
                                <Trophy class="w-5 h-5 text-amber-500" />
                                <span class="font-semibold"
                                    >Prize Distribution</span
                                >
                            </div>

                            <div class="distribution-bar">
                                <div
                                    class="bar-segment winner"
                                    style:width="{clampPct(winnerPct)}%"
                                    title="Winner(s): {winnerPct.toFixed(2)}%"
                                ></div>
                                <div
                                    class="bar-segment creator"
                                    style:width="{clampPct(creatorPct)}%"
                                    title="Creator: {creatorPct.toFixed(2)}%"
                                ></div>
                                <div
                                    class="bar-segment judges"
                                    style:width="{clampPct(judgesTotalPct)}%"
                                    title="Judges Total: {judgesTotalPct.toFixed(
                                        2,
                                    )}%"
                                ></div>
                                <div
                                    class="bar-segment developers"
                                    style:width="{clampPct(developersPct)}%"
                                    title="Dev Fund: {developersPct.toFixed(
                                        2,
                                    )}%"
                                ></div>
                            </div>

                            <div class="distribution-legend mt-4">
                                <div class="legend-item">
                                    <div class="legend-color winner"></div>
                                    <span
                                        >Winner(s) ({winnerPct.toFixed(
                                            2,
                                        )}%)</span
                                    >
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color creator"></div>
                                    <span
                                        >{game.status === "Resolution"
                                            ? "Resolver"
                                            : "Creator"} ({creatorPct.toFixed(
                                            2,
                                        )}%)</span
                                    >
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color judges"></div>
                                    <span
                                        >Judges ({judgesTotalPct.toFixed(
                                            2,
                                        )}%)</span
                                    >
                                </div>
                                <div class="legend-item">
                                    <div class="legend-color developers"></div>
                                    <span
                                        >Protocol fee ({developersPct.toFixed(
                                            2,
                                        )}%)</span
                                    >
                                </div>
                            </div>

                            {#if overAllocated > 0}
                                <p class="text-xs mt-2 text-red-500">
                                    Warning: Total commission exceeds 100% by {overAllocated}%!
                                    The winner's prize will be 0.
                                </p>
                            {/if}
                        </div>

                        <div
                            class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                        >
                            <details
                                class="group p-4 rounded-lg border bg-card shadow-sm {$mode ===
                                'dark'
                                    ? 'border-slate-700'
                                    : 'border-gray-200'}"
                            >
                                <summary
                                    class="flex justify-between items-center font-medium cursor-pointer list-none"
                                >
                                    <div class="flex items-center gap-2">
                                        <Settings
                                            class="w-5 h-5 text-gray-500"
                                        />
                                        <span>Technical Details</span>
                                    </div>
                                    <span
                                        class="transition group-open:rotate-180"
                                    >
                                        <ChevronDown class="w-5 h-5" />
                                    </span>
                                </summary>
                                <div
                                    class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 text-sm"
                                >
                                    <div
                                        class="info-block col-span-1 md:col-span-2"
                                    >
                                        <span class="info-label"
                                            >Creator Address {isOwner
                                                ? "(You)"
                                                : ""}</span
                                        >
                                        {#if creator}
                                            <a
                                                href={$web_explorer_uri_tkn +
                                                    creator}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="info-value font-mono text-xs break-all hover:underline"
                                                title={creator}
                                            >
                                                {creator.slice(
                                                    0,
                                                    12,
                                                )}...{creator.slice(-6)}
                                            </a>
                                        {:else}
                                            <span class="info-value">N/A</span>
                                        {/if}
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Competition ID (NFT)</span
                                        >
                                        <a
                                            href={$web_explorer_uri_tkn +
                                                game.gameId}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="info-value font-mono text-xs break-all hover:underline"
                                            title={game.gameId}
                                        >
                                            {game.gameId}
                                        </a>
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Service ID</span
                                        >
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                            title={game.content.serviceId}
                                        >
                                            {game.content.serviceId}
                                        </span>
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Indeterminism Index</span
                                        >
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                        >
                                            {game.content.indetermismIndex}
                                        </span>
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label">Seed</span>
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                        >
                                            {game.seed ?? "N/A"}
                                        </span>
                                    </div>

                                    {#if game.status === "Resolution" && game.revealedS_Hex}
                                        <div class="info-block md:col-span-2">
                                            <span class="info-label"
                                                >Revealed Secret (S)</span
                                            >
                                            <span
                                                class="info-value font-mono text-xs break-all"
                                            >
                                                {game.revealedS_Hex}
                                            </span>
                                        </div>
                                    {/if}
                                </div>
                            </details>
                        </div>

                        <!-- FILE SOURCES SECTIONS -->
                        {#if game.content.imageURL && game.content.imageURL.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    class="group p-4 rounded-lg border bg-card shadow-sm {$mode ===
                                    'dark'
                                        ? 'border-slate-700'
                                        : 'border-gray-200'}"
                                >
                                    <summary
                                        class="flex justify-between items-center font-medium cursor-pointer list-none"
                                    >
                                        <div class="flex items-center gap-2">
                                            <Sparkles
                                                class="w-5 h-5 text-blue-500"
                                            />
                                            <span>Game Image Sources</span>
                                        </div>
                                        <span
                                            class="transition group-open:rotate-180"
                                        >
                                            <ChevronDown class="w-5 h-5" />
                                        </span>
                                    </summary>

                                    <div class="mt-4 space-y-4">
                                        <p
                                            class="text-sm text-muted-foreground"
                                        >
                                            Community-verified download sources
                                            for the game image file (hash: <span
                                                class="font-mono text-xs"
                                                >{game.content.imageURL.slice(
                                                    0,
                                                    16,
                                                )}...</span
                                            >)
                                        </p>

                                        {#if $reputation_proof}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                on:click={() =>
                                                    openFileSourceModal(
                                                        game.content.imageURL,
                                                        "image",
                                                    )}
                                                class="w-full"
                                            >
                                                Add Download Source
                                            </Button>
                                        {:else}
                                            <p
                                                class="text-xs text-muted-foreground italic"
                                            >
                                                Create a reputation profile to
                                                add or manage download sources
                                            </p>
                                        {/if}

                                        <div
                                            class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4"
                                        >
                                            <FileCard
                                                class="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6"
                                                profile={$reputation_proof}
                                                fileHash={game.content.imageURL}
                                                sources={imageSources}
                                                explorerUri={$explorer_uri}
                                                webExplorerUriTkn={$web_explorer_uri_tkn}
                                            />
                                        </div>

                                        {#if imageSources.length === 0}
                                            <p
                                                class="text-xs text-muted-foreground italic text-center py-4"
                                            >
                                                No sources found for this file.
                                            </p>
                                        {/if}
                                    </div>
                                </details>
                            </div>
                        {/if}

                        {#if game.content.serviceId && game.content.serviceId.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    class="group p-4 rounded-lg border bg-card shadow-sm {$mode ===
                                    'dark'
                                        ? 'border-slate-700'
                                        : 'border-gray-200'}"
                                >
                                    <summary
                                        class="flex justify-between items-center font-medium cursor-pointer list-none"
                                    >
                                        <div class="flex items-center gap-2">
                                            <Cpu
                                                class="w-5 h-5 text-purple-500"
                                            />
                                            <span>Game Service Sources</span>
                                        </div>
                                        <span
                                            class="transition group-open:rotate-180"
                                        >
                                            <ChevronDown class="w-5 h-5" />
                                        </span>
                                    </summary>

                                    <div class="mt-4 space-y-4">
                                        <p
                                            class="text-sm text-muted-foreground"
                                        >
                                            Community-verified download sources
                                            for the game service executable
                                            (hash: <span
                                                class="font-mono text-xs"
                                                >{game.content.serviceId.slice(
                                                    0,
                                                    16,
                                                )}...</span
                                            >)
                                        </p>

                                        {#if $reputation_proof}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                on:click={() =>
                                                    openFileSourceModal(
                                                        game.content.serviceId,
                                                        "service",
                                                    )}
                                                class="w-full"
                                            >
                                                Add Download Source
                                            </Button>
                                        {:else}
                                            <p
                                                class="text-xs text-muted-foreground italic"
                                            >
                                                Create a reputation profile to
                                                add or manage download sources
                                            </p>
                                        {/if}

                                        <FileCard
                                            profile={$reputation_proof}
                                            fileHash={game.content.serviceId}
                                            sources={serviceSources}
                                            explorerUri={$explorer_uri}
                                            webExplorerUriTkn={$web_explorer_uri_tkn}
                                        />
                                    </div>
                                </details>
                            </div>
                        {/if}

                        {#if game.content.paper && game.content.paper.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    class="group p-4 rounded-lg border bg-card shadow-sm {$mode ===
                                    'dark'
                                        ? 'border-slate-700'
                                        : 'border-gray-200'}"
                                >
                                    <summary
                                        class="flex justify-between items-center font-medium cursor-pointer list-none"
                                    >
                                        <div class="flex items-center gap-2">
                                            <FileText
                                                class="w-5 h-5 text-amber-500"
                                            />
                                            <span>Game Paper Sources</span>
                                        </div>
                                        <span
                                            class="transition group-open:rotate-180"
                                        >
                                            <ChevronDown class="w-5 h-5" />
                                        </span>
                                    </summary>

                                    <div class="mt-4 space-y-4">
                                        <p
                                            class="text-sm text-muted-foreground"
                                        >
                                            Community-verified download sources
                                            for the detailed game documentation
                                            markdown file (hash: <span
                                                class="font-mono text-xs"
                                                >{game.content.paper.slice(
                                                    0,
                                                    16,
                                                )}...</span
                                            >)
                                        </p>

                                        {#if $reputation_proof}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                on:click={() =>
                                                    openFileSourceModal(
                                                        game.content.paper,
                                                        "paper",
                                                    )}
                                                class="w-full"
                                            >
                                                Add Download Source
                                            </Button>
                                        {:else}
                                            <p
                                                class="text-xs text-muted-foreground italic"
                                            >
                                                Create a reputation profile to
                                                add or manage download sources
                                            </p>
                                        {/if}

                                        <FileCard
                                            profile={$reputation_proof}
                                            fileHash={game.content.paper}
                                            sources={paperSources}
                                            explorerUri={$explorer_uri}
                                            webExplorerUriTkn={$web_explorer_uri_tkn}
                                        />
                                    </div>
                                </details>
                            </div>
                        {/if}
                    </div>
                {/if}
            </section>

            <section
                class="game-status status-actions-panel grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12 p-6 md:p-8 shadow-lg rounded-xl bg-card border border-border/50"
            >
                <div class="status-side">
                    <div class="flex items-center justify-between mb-6">
                        <h2 class="text-2xl font-semibold">Game Progress</h2>
                    </div>

                    <!-- Game Phase Stepper -->
                    <div
                        class="relative flex items-center justify-between mb-8 w-full px-4"
                    >
                        <!-- Progress Lines Background -->
                        <div
                            class="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 dark:bg-gray-700 -z-10 mx-4"
                        ></div>

                        {#if game.status === "Cancelled_Draining"}
                            <!-- CANCELLED FLOW: Active -> Cancelled -> Draining -->

                            <!-- Line 1: Active -> Cancelled (Always Red in this state) -->
                            <div
                                class="absolute left-0 top-1/2 transform -translate-y-1/2 h-1 -z-10 mx-4 bg-red-500"
                                style="width: 50%;"
                            ></div>

                            <!-- Line 2: Cancelled -> Draining (Orange) -->
                            <div
                                class="absolute left-1/2 top-1/2 transform -translate-y-1/2 h-1 -z-10 bg-orange-500"
                                style="width: 50%;"
                            ></div>

                            <!-- Step 1: Active (Completed) -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 bg-green-500 border-green-500 text-white"
                                >
                                    <Check class="w-6 h-6" />
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                                    >Active</span
                                >
                            </div>

                            <!-- Step 2: Cancelled (Completed Event) -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 bg-red-600 border-red-600 text-white shadow-lg scale-110"
                                >
                                    <XCircle class="w-6 h-6" />
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider text-red-600"
                                    >Cancelled</span
                                >
                            </div>

                            <!-- Step 3: Draining (Active State) -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 bg-orange-500 border-orange-500 text-white shadow-lg scale-110 animate-pulse"
                                >
                                    <ShieldCheck class="w-5 h-5" />
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider text-orange-500"
                                    >Draining</span
                                >
                            </div>
                        {:else}
                            <!-- STANDARD FLOW: Ceremony -> Active -> Resolution -> Finalized -->

                            <!-- Line 1: Active -> Resolution -->
                            <div
                                class="absolute left-0 top-1/2 transform -translate-y-1/2 h-1 -z-10 mx-4 transition-all duration-500 {game.status !==
                                'Active'
                                    ? 'bg-blue-500'
                                    : 'w-0'}"
                                style="width: {game.status !== 'Active'
                                    ? '50%'
                                    : '0%'};"
                            ></div>

                            <!-- Line 2: Resolution -> Finalized -->
                            <div
                                class="absolute left-1/2 top-1/2 transform -translate-y-1/2 h-1 -z-10 transition-all duration-500 {game.status ===
                                'Finalized'
                                    ? 'bg-green-500'
                                    : 'w-0'}"
                                style="width: {game.status === 'Finalized'
                                    ? '50%'
                                    : '0%'};"
                            ></div>

                            <!-- Step 1: Active -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 {game.status ===
                                    'Active'
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-lg scale-110'
                                        : 'bg-green-500 border-green-500 text-white'}"
                                >
                                    {#if game.status !== "Active"}
                                        <Check class="w-6 h-6" />
                                    {:else}
                                        <span class="text-base font-bold"
                                            >1</span
                                        >
                                    {/if}
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider {game.status ===
                                    'Active'
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-gray-500 dark:text-gray-400'}"
                                    >Active</span
                                >
                            </div>

                            <!-- Step 2: Resolution -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 {game.status ===
                                    'Resolution'
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-lg scale-110'
                                        : game.status === 'Finalized'
                                          ? 'bg-green-500 border-green-500 text-white'
                                          : 'bg-gray-200 border-gray-300 text-gray-400 dark:bg-gray-700 dark:border-gray-600'}"
                                >
                                    {#if game.status === "Finalized"}
                                        <Check class="w-6 h-6" />
                                    {:else if game.status === "Resolution"}
                                        <Gavel class="w-5 h-5" />
                                    {:else}
                                        <span class="text-base font-bold"
                                            >2</span
                                        >
                                    {/if}
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider {game.status ===
                                    'Resolution'
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-gray-500 dark:text-gray-400'}"
                                    >Resolution</span
                                >
                            </div>

                            <!-- Step 3: Finalized -->
                            <div
                                class="flex flex-col items-center bg-transparent z-10 px-2"
                            >
                                <div
                                    class="w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 {game.status ===
                                    'Finalized'
                                        ? 'bg-green-600 border-green-600 text-white shadow-lg scale-110'
                                        : 'bg-gray-200 border-gray-300 text-gray-400 dark:bg-gray-700 dark:border-gray-600'}"
                                >
                                    {#if game.status === "Finalized"}
                                        <Trophy class="w-5 h-5" />
                                    {:else}
                                        <span class="text-base font-bold"
                                            >3</span
                                        >
                                    {/if}
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider {game.status ===
                                    'Finalized'
                                        ? 'text-green-600 dark:text-green-400'
                                        : 'text-gray-500 dark:text-gray-400'}"
                                    >Finalized</span
                                >
                            </div>
                        {/if}
                    </div>

                    <div
                        class="status-description mb-8 rounded-xl border bg-card overflow-hidden {$mode ===
                        'dark'
                            ? 'border-slate-700'
                            : 'border-gray-200'} shadow-sm"
                    >
                        <!-- Header with State Title -->
                        <div
                            class="p-4 border-b {$mode === 'dark'
                                ? 'border-slate-700'
                                : 'border-gray-100'} flex items-center gap-3"
                        >
                            <div
                                class="p-2 rounded-lg {game.status ===
                                    'Active' && openCeremony
                                    ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                                    : game.status === 'Active'
                                      ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
                                      : game.status === 'Resolution'
                                        ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                                        : game.status === 'Finalized'
                                          ? 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
                                          : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}"
                            >
                                {#if game.status === "Active"}
                                    <Sparkles class="w-5 h-5" />
                                {:else if game.status === "Resolution"}
                                    <Gavel class="w-5 h-5" />
                                {:else if game.status === "Finalized"}
                                    <Trophy class="w-5 h-5" />
                                {:else}
                                    <XCircle class="w-5 h-5" />
                                {/if}
                            </div>
                            <div>
                                <h3
                                    class="text-lg font-bold flex items-center gap-2 {game.status ===
                                        'Active' && openCeremony
                                        ? 'text-purple-600 dark:text-purple-400'
                                        : game.status === 'Active'
                                          ? 'text-green-600 dark:text-green-400'
                                          : game.status === 'Resolution'
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : game.status === 'Finalized'
                                              ? 'text-gray-600 dark:text-gray-400'
                                              : 'text-red-600 dark:text-red-400'}"
                                >
                                    {#if game.status === "Active" && openCeremony}
                                        SEED CEREMONY
                                    {:else if game.status === "Active" && !participationIsEnded}
                                        PLAYING
                                    {:else if game.status === "Active" && participationIsEnded}
                                        AWAITING RESOLUTION
                                    {:else if game.status === "Resolution"}
                                        {@const isBeforeDeadline =
                                            new Date().getTime() < targetDate}
                                        {#if isBeforeDeadline}
                                            JUDGE PERIOD
                                        {:else}
                                            READY TO FINALIZE
                                        {/if}
                                    {:else if game.status === "Finalized"}
                                        FINALIZED STATE
                                    {:else}
                                        CANCELLED (DRAINING)
                                    {/if}
                                    <button
                                        on:click={() =>
                                            (showInfoBlocks = !showInfoBlocks)}
                                        class="ml-2 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors animate-pulse"
                                        title="Toggle Information"
                                    >
                                        <Info class="w-4 h-4" />
                                    </button>
                                </h3>
                                <p
                                    class="text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {#if game.status === "Active" && openCeremony}
                                        Seed ceremony is open. Collaborate to
                                        ensure a random seed.
                                    {:else if game.status === "Active" && !participationIsEnded}
                                        The game is live. Solvers can submit
                                        their scores until the deadline.
                                    {:else if game.status === "Active" && participationIsEnded}
                                        Time is up. The creator must now resolve
                                        the game.
                                    {:else if game.status === "Resolution"}
                                        {@const isBeforeDeadline =
                                            new Date().getTime() < targetDate}
                                        {#if isBeforeDeadline}
                                            Judges are validating the winner.
                                            New candidates can be proposed.
                                        {:else}
                                            Judge period ended. The game can be
                                            finalized.
                                        {/if}
                                    {:else if game.status === "Finalized"}
                                        The competition has ended and prizes
                                        have been distributed.
                                    {:else}
                                        The game was cancelled after the
                                        creator’s secret was compromised.
                                    {/if}
                                </p>
                            </div>
                        </div>

                        <!-- Content Grid: Allowed vs Restricted -->
                        {#if showInfoBlocks}
                            <div
                                class="grid grid-cols-1 md:grid-cols-1 divide-y md:divide-y-0 md:divide-x {$mode ===
                                'dark'
                                    ? 'divide-slate-700'
                                    : 'divide-gray-100'}"
                            >
                                <!-- Allowed Actions -->
                                <div class="p-4">
                                    <h4
                                        class="text-sm font-semibold uppercase tracking-wider text-green-600 dark:text-green-400 mb-3 flex items-center"
                                    >
                                        <CheckCircle class="w-4 h-4 mr-2" />
                                        What can happen?
                                    </h4>
                                    <ul class="space-y-2">
                                        {#if game.status === "Active" && openCeremony}
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                > Contribute to the random number
                                                generation process (free) to ensure
                                                the game's seed is random.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Cancel the game by revealing the
                                                secret and receive a portion of the
                                                creator’s stake.
                                            </li>
                                        {:else if game.status === "Active"}
                                            {#if openCeremony}
                                                <!-- CEREMONY PHASE -->
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Contribute to the random number
                                                    generation process (free).
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Cancel the game (if secret leaked).
                                                </li>
                                            {:else if !participationIsEnded}
                                                <!-- PLAYING PHASE -->
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Players:</span
                                                    >
                                                    Join the game and submit scores.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Cancel the game (if secret leaked).
                                                </li>
                                            {:else}
                                                <!-- AWAITING RESOLUTION PHASE -->
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Creator:</span
                                                    >
                                                    Resolve the game by revealing
                                                    the secret.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Cancel the game (if secret leaked).
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Rescue funds (if stuck after
                                                    grace period).
                                                </li>
                                            {/if}
                                        {:else if game.status === "Resolution"}
                                            {@const isBeforeDeadline =
                                                new Date().getTime() <
                                                targetDate}
                                            {#if isBeforeDeadline}
                                                <!-- JUDGE PERIOD -->
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Judges:</span
                                                    >
                                                    Validate or invalidate the candidate.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Propose a new winner (if higher
                                                    score).
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Anyone:</span
                                                    >
                                                    Include omitted participations.
                                                </li>
                                            {:else}
                                                <!-- POST-JUDGE PERIOD -->
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Winner/Resolver:</span
                                                    >
                                                    Finalize the game and distribute
                                                    prizes.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                                >
                                                    <span
                                                        class="font-medium text-gray-900 dark:text-gray-100"
                                                        >Participants:</span
                                                    >
                                                    Claim refunds (if grace period
                                                    passes).
                                                </li>
                                            {/if}
                                        {:else if game.status === "Finalized"}
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Everyone:</span
                                                > View results and history.
                                            </li>
                                        {:else}
                                            <!-- Cancelled -->
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Players:</span
                                                > Claim full refund immediately.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Creator:</span
                                                > Drain stake (slowly, over time).
                                            </li>
                                        {/if}
                                    </ul>
                                </div>

                                <!-- Restricted Actions -->
                                <div class="p-4">
                                    <h4
                                        class="text-sm font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 mb-3 flex items-center"
                                    >
                                        <XCircle class="w-4 h-4 mr-2" />
                                        What cannot happen?
                                    </h4>
                                    <ul class="space-y-2">
                                        {#if game.status === "Active"}
                                            {#if openCeremony}
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Submit Score:</span
                                                    >
                                                    Wait for ceremony to end.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Resolve Game:</span
                                                    >
                                                    Cannot resolve during ceremony.
                                                </li>
                                            {:else if !participationIsEnded}
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Resolve Game:</span
                                                    >
                                                    Wait for deadline to expire.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Ceremony:</span
                                                    >
                                                    Ceremony is closed.
                                                </li>
                                            {:else}
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Submit Score:</span
                                                    >
                                                    Deadline has passed.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Ceremony:</span
                                                    >
                                                    Ceremony is closed.
                                                </li>
                                            {/if}
                                        {:else if game.status === "Resolution"}
                                            {@const isBeforeDeadline =
                                                new Date().getTime() <
                                                targetDate}
                                            {#if isBeforeDeadline}
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Finalize Game:</span
                                                    >
                                                    Wait for judge period to end.
                                                </li>
                                            {:else}
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Invalidate Winner:</span
                                                    >
                                                    Judge period has ended.
                                                </li>
                                                <li
                                                    class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                                >
                                                    <span class="font-medium"
                                                        >Propose Winner:</span
                                                    >
                                                    Judge period has ended.
                                                </li>
                                            {/if}
                                        {:else if game.status === "Finalized"}
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Modifying state:</span
                                                > The game is closed.
                                            </li>
                                        {:else}
                                            <!-- Cancelled -->
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Winning:</span
                                                > No winner can be declared.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Resuming:</span
                                                > The game is permanently invalid.
                                            </li>
                                        {/if}
                                    </ul>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

                <div
                    class="actions-side md:border-l {$mode === 'dark'
                        ? 'border-slate-700'
                        : 'border-gray-200'} md:pl-8"
                >
                    <h2 class="text-xl font-semibold mb-4 flex items-center">
                        <ShieldCheck class="w-5 h-5 mr-2 text-blue-500" />
                        Trust & Security
                    </h2>

                    <div class="grid grid-cols-1 gap-y-6">
                        {#if game.judges && game.judges.length > 0}
                            <div class="info-block">
                                <div
                                    class="mb-4 p-3 rounded bg-green-500/10 border border-green-500/20"
                                >
                                    <span
                                        class="text-sm font-bold text-green-500"
                                        >Risk Level: Low (Decentralized Jury)</span
                                    >
                                    <p
                                        class="text-xs text-gray-500 dark:text-gray-400 mt-1"
                                    >
                                        This game uses a decentralized jury
                                        system. The creator cannot arbitrarily
                                        decide the winner; a majority of judges
                                        must agree.
                                    </p>
                                </div>

                                <p
                                    class="text {$mode === 'dark'
                                        ? 'text-slate-400'
                                        : 'text-gray-600'} mt-1"
                                >
                                    {#if game.status === "Active"}
                                        Nominated Judges {isNominatedJudge
                                            ? "(You are a nominated judge)"
                                            : ""}
                                    {:else if game.status === "Resolution"}
                                        Judges' Votes
                                    {/if}
                                </p>
                                <div
                                    class="info-value font-mono text-xs break-all mt-2"
                                >
                                    {#each game.judges as judge}
                                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                                        <!-- svelte-ignore a11y-invalid-attribute -->
                                        <a
                                            href="#"
                                            on:click|preventDefault={() =>
                                                handleJudgeDetails(judge)}
                                            class="cursor-pointer hover:underline text-blue-400 hover:text-blue-300"
                                        >
                                            {judge.slice(0, 12)}...{judge.slice(
                                                -6,
                                            )}
                                            {#if game.status === "Active" && acceptedJudgeNominations && acceptedJudgeNominations.includes(judge)}
                                                <span class="text-green-500">
                                                    (accepted)</span
                                                >
                                            {:else if game.status === "Resolution" && participationVotes.get(game.winnerCandidateCommitment) && candidateParticipationInvalidVotes.includes(judge)}
                                                <span class="text-red-500">
                                                    (invalidated)</span
                                                >
                                            {:else if game.status === "Resolution" && participationVotes.get(game.winnerCandidateCommitment) && candidateParticipationValidVotes.includes(judge)}
                                                <span class="text-green-500">
                                                    (validated)</span
                                                >
                                            {:else if game.status === "Resolution" && new Date().getTime() < targetDate}
                                                <span class="text-yellow-500">
                                                    (pending)</span
                                                >
                                            {/if}
                                        </a>
                                    {/each}
                                </div>
                                {#if game.status === "Active"}
                                    <p
                                        class="text-sm font-medium text-yellow-600 dark:text-yellow-400 mt-2"
                                    >
                                        Trust requires a majority of {Math.floor(
                                            game.judges.length / 2,
                                        ) + 1} out of {game.judges.length} judges.
                                    </p>
                                    <p
                                        class="text-xs italic opacity-75 mt-1 {$mode ===
                                        'dark'
                                            ? 'text-slate-400'
                                            : 'text-gray-500'}"
                                    >
                                        Advanced: You can verify judges' past
                                        performance using external scripts.
                                    </p>
                                {:else if game.status === "Resolution"}
                                    {#if new Date().getTime() < targetDate}
                                        <p class="text-sm font-medium mt-2">
                                            The candidate can be invalidated if
                                            more than {Math.floor(
                                                game.judges.length / 2,
                                            )} out of {game.judges.length} judges
                                            vote to invalidate.
                                        </p>
                                    {:else}
                                        <p class="text-sm font-medium mt-2">
                                            The candidate can no longer be
                                            invalidated as the voting period has
                                            ended.
                                        </p>
                                    {/if}
                                {/if}
                            </div>
                        {:else}
                            <div class="info-block">
                                <div
                                    class="mb-4 p-3 rounded bg-yellow-500/10 border border-yellow-500/20"
                                >
                                    <span
                                        class="text-sm font-bold text-yellow-500"
                                        >Risk Level: High (Trust Creator)</span
                                    >
                                    <p
                                        class="text-xs text-gray-500 dark:text-gray-400 mt-1"
                                    >
                                        This game relies entirely on the
                                        creator's honesty. If the creator acts
                                        maliciously, there are no judges to
                                        intervene.
                                    </p>
                                </div>

                                <p
                                    class="text {$mode === 'dark'
                                        ? 'text-slate-400'
                                        : 'text-gray-600'} mt-1 text-lg font-semibold"
                                >
                                    No Judges Assigned
                                </p>
                                <p
                                    class="text-sm font-medium text-yellow-400 mt-1"
                                >
                                    Participants must trust the creator.
                                </p>
                                <p
                                    class="text-xs italic opacity-75 mt-2 {$mode ===
                                    'dark'
                                        ? 'text-slate-400'
                                        : 'text-gray-500'}"
                                >
                                    Advanced: You can verify the creator's
                                    history using external scripts.
                                </p>
                            </div>
                        {/if}
                        {#if true}
                            {@const creatorPositiveOpinion = game.content
                                .creatorTokenId
                                ? game.reputationOpinions.find(
                                      (op) =>
                                          op.token_id ===
                                              game.content.creatorTokenId &&
                                          op.polarization === true,
                                  )
                                : null}
                            {#if creatorPositiveOpinion}
                                <div
                                    class="info-block mt-4 pt-4 border-t {$mode ===
                                    'dark'
                                        ? 'border-slate-700'
                                        : 'border-gray-200'}"
                                >
                                    <p class="text-sm font-medium mb-2">
                                        Creator Verification
                                    </p>
                                    <div
                                        class="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/20"
                                    >
                                        <ShieldCheck
                                            class="h-5 w-5 text-green-500"
                                        />
                                        <span
                                            class="text-sm font-bold text-green-500"
                                            >Verified by Creator</span
                                        >
                                    </div>
                                    <p
                                        class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                    >
                                        The creator has submitted a positive
                                        opinion verifying this game.
                                    </p>
                                </div>
                            {:else if game.content.creatorTokenId && $reputation_proof && game.content.creatorTokenId === $reputation_proof.token_id}
                                <div
                                    class="info-block mt-4 pt-4 border-t {$mode ===
                                    'dark'
                                        ? 'border-slate-700'
                                        : 'border-gray-200'}"
                                >
                                    <p class="text-sm font-medium mb-2">
                                        Creator Verification
                                    </p>
                                    <Button
                                        on:click={() =>
                                            setupActionModal(
                                                "submit_creator_opinion",
                                            )}
                                        variant="outline"
                                        class="w-full border-green-500 text-green-500 hover:bg-green-500 hover:text-white"
                                    >
                                        <ShieldCheck class="mr-2 h-4 w-4" />
                                        Verify as Creator
                                    </Button>
                                    <p
                                        class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                    >
                                        Submit a positive opinion to verify this
                                        game as the creator.
                                    </p>
                                </div>
                            {/if}
                        {/if}
                    </div>
                </div>

                {#if !isGameEnded(game)}
                    <div class="col-span-1 lg:col-span-2">
                        <div
                            class="actions-section mt-8 pt-8 border-t {$mode ===
                            'dark'
                                ? 'border-slate-700'
                                : 'border-gray-200'}"
                        >
                            <h2 class="text-2xl font-semibold mb-6">
                                Available Actions
                            </h2>
                            <div class="space-y-4">
                                {#if $connected}
                                    {#if game.status === "Active"}
                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "open_ceremony",
                                                    )}
                                                disabled={!openCeremony}
                                                class="w-full bg-purple-600 hover:bg-purple-700 text-white"
                                            >
                                                <!-- svelte-ignore missing-declaration -->
                                                <Sparkles
                                                    class="mr-2 h-4 w-4"
                                                /> Add Seed Randomness
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                {#if openCeremony}
                                                    Add entropy to the game
                                                    seed. Available because the
                                                    ceremony period is open.
                                                {:else}
                                                    Adding randomness is no
                                                    longer available (ceremony
                                                    period ended).
                                                {/if}
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "accept_judge_nomination",
                                                    )}
                                                disabled={!isNominatedJudge ||
                                                    isJudge}
                                                class="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                            >
                                                <Gavel class="mr-2 h-4 w-4" /> Accept
                                                Judge Nomination
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                {#if !isNominatedJudge}
                                                    You are not nominated as a
                                                    judge.
                                                {:else if isJudge}
                                                    You are already a judge.
                                                {:else}
                                                    You are nominated as a
                                                    judge. Accept to participate
                                                    in the resolution process.
                                                {/if}
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "submit_score",
                                                    )}
                                                disabled={participationIsEnded ||
                                                    (strictMode &&
                                                        openCeremony)}
                                                class="w-full bg-slate-500 hover:bg-slate-600 text-white"
                                            >
                                                <Edit
                                                    class="mr-2 h-4 w-4"
                                                />Submit My Score
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                Submit your solution and score.
                                                {#if strictMode && openCeremony}
                                                    Disabled because the
                                                    ceremony period is open.
                                                {:else if participationIsEnded}
                                                    Disabled because the
                                                    deadline has passed.
                                                {/if}
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "cancel_game",
                                                    )}
                                                variant="destructive"
                                                class="w-full bg-red-600 hover:bg-red-700 text-white"
                                            >
                                                <XCircle
                                                    class="mr-2 h-4 w-4"
                                                />Cancel Competition
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                Cancel the game if the secret
                                                has been revealed prematurely.
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "resolve_game",
                                                    )}
                                                disabled={!participationIsEnded}
                                                class="w-full bg-slate-600 hover:bg-slate-700 text-white"
                                            >
                                                <CheckSquare
                                                    class="mr-2 h-4 w-4"
                                                />Resolve Competition
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                {#if participationIsEnded}
                                                    The participation period has
                                                    ended. The creator can now
                                                    resolve the game and declare
                                                    a winner.
                                                {:else}
                                                    Available after the
                                                    participation deadline.
                                                {/if}
                                            </p>
                                        </div>
                                    {/if}

                                    {#if game.status === "Resolution"}
                                        {@const isBeforeDeadline =
                                            new Date().getTime() < targetDate}

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "include_omitted",
                                                    )}
                                                variant="outline"
                                                disabled={!isBeforeDeadline}
                                                class="w-full bg-gray-600 hover:bg-gray-700 text-white"
                                                title="Anyone can execute this action to claim the resolver's commission."
                                            >
                                                <Users class="mr-2 h-4 w-4" /> Include
                                                Omitted Participations
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                If a valid participation was
                                                omitted by the creator, you can
                                                include it now.
                                                {#if !isBeforeDeadline}
                                                    Disabled because judge
                                                    period has ended.
                                                {/if}
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "invalidate_winner",
                                                    )}
                                                disabled={!isJudge ||
                                                    !isBeforeDeadline}
                                                variant="destructive"
                                                class="w-full bg-yellow-600 hover:bg-yellow-700 text-white"
                                            >
                                                <XCircle class="mr-2 h-4 w-4" />
                                                Judges: Invalidate Winner
                                            </Button>
                                            <p
                                                class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                            >
                                                {#if isJudge}
                                                    As a judge, you can vote to
                                                    invalidate the winner if the
                                                    solution is incorrect.
                                                {:else}
                                                    Only judges can invalidate
                                                    the winner.
                                                {/if}
                                                {#if !isBeforeDeadline}
                                                    Disabled because judge
                                                    period has ended.
                                                {/if}
                                            </p>
                                        </div>

                                        <div class="action-item">
                                            {#if participations.filter((p) => p.status === "Submitted").length + participationBatches.length > PARTICIPATION_BATCH_THRESHOLD}
                                                <Button
                                                    on:click={() =>
                                                        setupActionModal(
                                                            "batch_participations",
                                                        )}
                                                    disabled={isBeforeDeadline}
                                                    variant="outline"
                                                    class="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                                >
                                                    <Trophy
                                                        class="mr-2 h-4 w-4"
                                                    />
                                                    Batch Participations ({participations.filter(
                                                        (p) =>
                                                            p.status ===
                                                            "Submitted",
                                                    ).length} pending, {participationBatches.length}
                                                    batches)
                                                </Button>
                                                <p
                                                    class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                                >
                                                    There are too many
                                                    participations to finalize
                                                    at once. Please batch them
                                                    first.
                                                    {#if isBeforeDeadline}
                                                        Disabled because judge
                                                        period is still active.
                                                    {/if}
                                                </p>
                                            {:else}
                                                <Button
                                                    on:click={() =>
                                                        setupActionModal(
                                                            "end_game",
                                                        )}
                                                    disabled={isBeforeDeadline}
                                                    class="w-full bg-blue-600 hover:bg-blue-700 text-white"
                                                >
                                                    <Trophy
                                                        class="mr-2 h-4 w-4"
                                                    /> End Competition & Distribute
                                                    Prizes
                                                </Button>
                                                <p
                                                    class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                                >
                                                    The resolution period has
                                                    ended. Finalize the game to
                                                    distribute prizes.
                                                    {#if isBeforeDeadline}
                                                        Disabled because judge
                                                        period is still active.
                                                    {/if}
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}

                                    {#if iGameDrainingStaking(game)}
                                        {#await isGameDrainingAllowed(game) then isAllowed}
                                            <div class="action-item">
                                                <Button
                                                    on:click={() =>
                                                        setupActionModal(
                                                            "drain_stake",
                                                        )}
                                                    disabled={!isAllowed}
                                                    class="w-full bg-orange-600 hover:bg-orange-700 text-white"
                                                >
                                                    <Trophy
                                                        class="mr-2 h-4 w-4"
                                                    />Drain Creator Stake
                                                </Button>
                                                <p
                                                    class="text-xs mt-1 text-gray-500 dark:text-gray-400"
                                                >
                                                    {#if isAllowed}
                                                        The game was cancelled.
                                                        You can drain the
                                                        creator's stake.
                                                    {:else}
                                                        Draining stake is not
                                                        yet available.
                                                    {/if}
                                                </p>
                                            </div>
                                        {/await}
                                    {/if}
                                {:else}
                                    <p class="info-box">
                                        Connect your wallet to interact with the
                                        game competition.
                                    </p>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            </section>

            <section class="mb-12">
                <div class="filter-menu">
                    <button
                        class="filter-badge"
                        class:active={activeTab === "participations"}
                        on:click={() => (activeTab = "participations")}
                    >
                        Participations ({participations.length})
                    </button>
                    <button
                        class="filter-badge"
                        class:active={activeTab === "forum"}
                        on:click={() => (activeTab = "forum")}
                    >
                        Comments
                    </button>
                </div>

                {#if activeTab === "participations"}
                    {#if participations && participations.length > 0}
                        <div class="flex flex-col gap-6">
                            {#each participations as p (p.boxId)}
                                {@const isCurrentParticipationWinner =
                                    (game.status === "Resolution" ||
                                        game.status === "Finalized") &&
                                    game.winnerCandidateCommitment ===
                                        p.commitmentC_Hex}
                                {@const actualScoreForThisParticipation =
                                    game.status === "Resolution" ||
                                    game.status === "Finalized"
                                        ? resolve_participation_commitment(
                                              p,
                                              game.revealedS_Hex,
                                              game.seed,
                                          )
                                        : null}
                                {@const effectiveScore =
                                    actualScoreForThisParticipation !== null
                                        ? calculateEffectiveScore(
                                              actualScoreForThisParticipation,
                                              game.deadlineBlock,
                                              p.creationHeight,
                                          )
                                        : null}

                                {@const isCurrentUserParticipant =
                                    $connected &&
                                    $address ===
                                        pkHexToBase58Address(p.playerPK_Hex)}
                                {@const canClaimCancellationRefund =
                                    game.status === "Cancelled_Draining" &&
                                    isCurrentUserParticipant &&
                                    p.status === "Submitted"}

                                <!-- Grace Period because owner doesn't interact -->
                                {@const isGracePeriodOver =
                                    game.status === GameState.Active &&
                                    currentHeight >
                                        game.deadlineBlock +
                                            game.constants
                                                .PARTICIPATION_GRACE_PERIOD_IN_BLOCKS}
                                {@const canReclaimAfterGrace =
                                    isGracePeriodOver &&
                                    isCurrentUserParticipant &&
                                    !p.spent}
                                {@const reclaimedAfterGrace =
                                    isGracePeriodOver &&
                                    isCurrentUserParticipant &&
                                    p.spent}

                                <!-- States -->
                                {@const isMalformed = p.status === "Malformed"}
                                {@const isSubmitted = p.status === "Submitted"}
                                {@const isConsumedByWinner =
                                    p.status === "Consumed" &&
                                    p.reason === "bywinner"}
                                {@const isConsumedByParticipant =
                                    p.status === "Consumed" &&
                                    p.reason === "byparticipant"}
                                {@const isInvalidated =
                                    p.status === "Consumed" &&
                                    p.reason === "invalidated"}
                                {@const isCancelled =
                                    p.status === "Consumed" &&
                                    p.reason === "cancelled"}

                                <div
                                    class="participation-card relative rounded-lg shadow-lg overflow-hidden border bg-card
                            {isCurrentParticipationWinner
                                        ? 'winner-card border-green-500/50'
                                        : 'border-border/50'}
                            {isMalformed
                                        ? $mode === 'dark'
                                            ? 'bg-gray-700 border-gray-800 opacity-70'
                                            : 'bg-gray-200 border-gray-300 opacity-70'
                                        : ''}"
                                >
                                    {#if isCurrentParticipationWinner}
                                        <div class="winner-badge">
                                            <Trophy class="w-4 h-4 mr-2" />
                                            <span>WINNER CANDIDATE</span>
                                        </div>
                                    {/if}

                                    {#if isMalformed}
                                        <div
                                            class="expired-badge absolute top-6 right-16 bg-gray-500 text-white px-2 py-1 rounded-full text-xs font-semibold"
                                        >
                                            MALFORMED
                                        </div>
                                    {/if}

                                    {#if isInvalidated}
                                        <div
                                            class="expired-badge absolute top-6 right-16 bg-red-600 text-white px-2 py-1 rounded-full text-xs font-semibold"
                                        >
                                            DISQUALIFIED
                                        </div>
                                    {/if}

                                    <div
                                        class="card-header p-4 border-b {$mode ===
                                        'dark'
                                            ? 'border-slate-700'
                                            : 'border-gray-200'}"
                                    >
                                        <div
                                            class="flex items-center justify-between"
                                        >
                                            <div>
                                                <div
                                                    class="text-xs uppercase text-slate-500 dark:text-slate-400"
                                                >
                                                    Player Address
                                                </div>
                                                <a
                                                    href={$web_explorer_uri_addr +
                                                        pkHexToBase58Address(
                                                            p.playerPK_Hex,
                                                        )}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="font-mono text-sm break-all {$mode ===
                                                    'dark'
                                                        ? 'text-slate-300 hover:text-white'
                                                        : 'text-slate-700 hover:text-black'}"
                                                    title={pkHexToBase58Address(
                                                        p.playerPK_Hex,
                                                    )}
                                                >
                                                    {pkHexToBase58Address(
                                                        p.playerPK_Hex,
                                                    )}
                                                </a>
                                            </div>
                                            {#if $connected && $address === pkHexToBase58Address(p.playerPK_Hex)}
                                                <span
                                                    class="
                                            text-xs font-semibold ml-4 px-2 py-1 rounded-full
                                            {$mode === 'dark'
                                                        ? 'bg-blue-500 text-white'
                                                        : 'bg-blue-200 text-blue-800'}
                                            {isCurrentParticipationWinner
                                                        ? 'inline-block mt-6'
                                                        : ''}
                                            "
                                                >
                                                    You
                                                </span>
                                            {/if}
                                        </div>
                                    </div>

                                    <div
                                        class="card-body p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4"
                                    >
                                        <div class="info-block">
                                            <span class="info-label"
                                                >Fee Paid</span
                                            >
                                            <span class="info-value"
                                                >{formatTokenBigInt(
                                                    p.value,
                                                    tokenDecimals,
                                                )}
                                                {tokenSymbol}</span
                                            >
                                        </div>
                                        <div class="info-block">
                                            <span class="info-label"
                                                >Solver ID</span
                                            >
                                            <span
                                                class="info-value font-mono text-xs"
                                                title={p.solverId_String ||
                                                    p.solverId_RawBytesHex}
                                            >
                                                {#if p.solverId_String}
                                                    {p.solverId_String.slice(
                                                        0,
                                                        10,
                                                    )}...{p.solverId_String.slice(
                                                        -4,
                                                    )}
                                                {:else}
                                                    N/A
                                                {/if}
                                            </span>
                                        </div>
                                        <div class="info-block">
                                            <span class="info-label"
                                                >Transaction ID</span
                                            >
                                            <a
                                                href={$web_explorer_uri_tx +
                                                    p.transactionId}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="info-value font-mono text-xs break-all hover:underline"
                                                title={p.transactionId}
                                            >
                                                {p.transactionId.slice(
                                                    0,
                                                    10,
                                                )}...{p.transactionId.slice(-4)}
                                            </a>
                                        </div>
                                        <div class="info-block">
                                            <span class="info-label"
                                                >Commitment</span
                                            >
                                            <!-- svelte-ignore a11y-missing-attribute -->
                                            <a
                                                class="info-value font-mono text-xs"
                                                title={p.commitmentC_Hex}
                                            >
                                                {p.commitmentC_Hex.slice(
                                                    0,
                                                    10,
                                                )}...{p.commitmentC_Hex.slice(
                                                    -4,
                                                )}
                                            </a>
                                        </div>
                                        <div class="info-block">
                                            <span class="info-label"
                                                >Hash logs</span
                                            >
                                            <!-- svelte-ignore a11y-missing-attribute -->
                                            <a
                                                class="info-value font-mono text-xs"
                                                title={p.hashLogs_Hex}
                                            >
                                                {p.hashLogs_Hex.slice(
                                                    0,
                                                    10,
                                                )}...{p.hashLogs_Hex.slice(-4)}
                                            </a>
                                        </div>
                                        <div
                                            class="info-block sm:col-span-2 lg:col-span-3"
                                        >
                                            <span class="info-label"
                                                >Score List</span
                                            >
                                            <div
                                                class="font-mono text-xs {$mode ===
                                                'dark'
                                                    ? 'text-lime-400'
                                                    : 'text-lime-600'}"
                                            >
                                                {#if p.scoreList && p.scoreList.length > 0}
                                                    {#each p.scoreList as score, i}
                                                        <span
                                                            class:font-bold={actualScoreForThisParticipation !==
                                                                null &&
                                                                score ===
                                                                    actualScoreForThisParticipation}
                                                            class:opacity-50={actualScoreForThisParticipation !==
                                                                null &&
                                                                score !==
                                                                    actualScoreForThisParticipation}
                                                        >
                                                            {score.toString()}
                                                        </span>{#if i < p.scoreList.length - 1}<span
                                                                class={$mode ===
                                                                "dark"
                                                                    ? "text-slate-500"
                                                                    : "text-gray-400"}
                                                                >,
                                                            </span>{/if}
                                                    {/each}
                                                    <span
                                                        class="text-xs italic {$mode ===
                                                        'dark'
                                                            ? 'text-gray-400'
                                                            : 'text-gray-500'} ml-2"
                                                    >
                                                        {#if actualScoreForThisParticipation === null}
                                                            (one of these is the
                                                            real one)
                                                        {:else}
                                                            (Real Score: {actualScoreForThisParticipation})
                                                            {#if effectiveScore !== null && effectiveScore !== actualScoreForThisParticipation}
                                                                <br />(Effective
                                                                Score: {effectiveScore})
                                                            {/if}
                                                        {/if}
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>
                                        <div class="info-block">
                                            <span class="info-label">Block</span
                                            >
                                            <!-- svelte-ignore a11y-missing-attribute -->
                                            <a
                                                class="info-value font-mono text-xs"
                                            >
                                                {p.creationHeight}
                                            </a>
                                        </div>

                                        {#if canReclaimAfterGrace}
                                            <div
                                                class="info-block sm:col-span-2 lg:col-span-3 mt-4 pt-4 border-t {$mode ===
                                                'dark'
                                                    ? 'border-slate-700'
                                                    : 'border-gray-200'}"
                                            >
                                                <p
                                                    class="text-xs mb-2 {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    The game creator failed to
                                                    resolve the game in time.
                                                    You can now reclaim your
                                                    participation fee.
                                                </p>
                                                <Button
                                                    on:click={() =>
                                                        handleReclaimAfterGrace(
                                                            p,
                                                        )}
                                                    disabled={isReclaimingGraceFor ===
                                                        p.boxId}
                                                    class="w-full text-base bg-orange-600 hover:bg-orange-700"
                                                >
                                                    {#if isReclaimingGraceFor === p.boxId}
                                                        Reclaiming...
                                                    {:else}
                                                        <ShieldCheck
                                                            class="mr-2 h-4 w-4"
                                                        /> Reclaim Participation
                                                        Fee
                                                    {/if}
                                                </Button>

                                                {#if reclaimGraceSuccessTxId[p.boxId]}
                                                    <div
                                                        class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50"
                                                    >
                                                        <strong
                                                            >Success!
                                                            Transaction ID:</strong
                                                        ><br />
                                                        <a
                                                            href={$web_explorer_uri_tx +
                                                                reclaimGraceSuccessTxId[
                                                                    p.boxId
                                                                ]}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            class="underline break-all hover:text-slate-400"
                                                        >
                                                            {reclaimGraceSuccessTxId[
                                                                p.boxId
                                                            ]}
                                                        </a>
                                                    </div>
                                                {/if}

                                                {#if reclaimGraceError[p.boxId]}
                                                    <p
                                                        class="text-xs mt-1 text-red-400"
                                                    >
                                                        {reclaimGraceError[
                                                            p.boxId
                                                        ]}
                                                    </p>
                                                {/if}
                                            </div>
                                        {/if}

                                        {#if reclaimedAfterGrace && false}
                                            <!-- TODO Needs to check exactly if the spent participation was reclaimed by the user. Maybe was spent during the End Competition action. -->
                                            <div
                                                class="info-block sm:col-span-2 lg:col-span-3 mt-4 pt-4 border-t {$mode ===
                                                'dark'
                                                    ? 'border-slate-700'
                                                    : 'border-gray-200'}"
                                            >
                                                <div
                                                    class="my-2 p-3 rounded-md text-sm bg-blue-600/30 text-blue-300 border border-blue-500/50 flex items-center"
                                                >
                                                    <CheckCircle
                                                        class="mr-2 h-5 w-5"
                                                    />
                                                    <p class="font-medium">
                                                        Your participation fee
                                                        has been successfully
                                                        reclaimed after the
                                                        grace period.
                                                    </p>
                                                </div>
                                            </div>
                                        {/if}

                                        {#if canClaimCancellationRefund}
                                            <div
                                                class="info-block sm:col-span-2 lg:col-span-3 mt-2"
                                            >
                                                <p
                                                    class="text-xs mb-2 {$mode ===
                                                    'dark'
                                                        ? 'text-blue-400'
                                                        : 'text-blue-600'}"
                                                >
                                                    With the secret now
                                                    revealed, the game has been
                                                    canceled. Please claim a
                                                    refund of your participation
                                                    fee.
                                                </p>
                                                <Button
                                                    on:click={() =>
                                                        handleClaimRefund(p)}
                                                    disabled={isClaimingRefundFor ===
                                                        p.boxId}
                                                    class="w-full text-base bg-blue-600 hover:bg-blue-700"
                                                >
                                                    {#if isClaimingRefundFor === p.boxId}
                                                        Processing...
                                                    {:else}
                                                        <Trophy
                                                            class="mr-2 h-4 w-4"
                                                        /> Claim Refund
                                                    {/if}
                                                </Button>

                                                {#if claimRefundSuccessTxId[p.boxId]}
                                                    <div
                                                        class="my-2 p-2 rounded-md text-xs bg-green-600/30 text-green-300 border border-green-500/50"
                                                    >
                                                        <strong
                                                            >Success!
                                                            Transaction ID:</strong
                                                        ><br />
                                                        <a
                                                            href={$web_explorer_uri_tx +
                                                                claimRefundSuccessTxId[
                                                                    p.boxId
                                                                ]}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            class="underline break-all hover:text-slate-400"
                                                        >
                                                            {claimRefundSuccessTxId[
                                                                p.boxId
                                                            ]}
                                                        </a>
                                                    </div>
                                                {/if}

                                                {#if claimRefundError[p.boxId]}
                                                    <p
                                                        class="text-xs mt-1 text-red-400"
                                                    >
                                                        {claimRefundError[
                                                            p.boxId
                                                        ]}
                                                    </p>
                                                {/if}
                                            </div>
                                        {:else if isCancelled && isCurrentUserParticipant && (game.status === GameState.Cancelled_Draining || game.status === GameState.Finalized)}
                                            <div
                                                class="info-block sm:col-span-2 lg:col-span-3 mt-2"
                                            >
                                                <div
                                                    class="p-3 rounded-md text-sm text-center {$mode ===
                                                    'dark'
                                                        ? 'bg-slate-700 text-slate-400'
                                                        : 'bg-slate-200 text-slate-600'}"
                                                >
                                                    <Check
                                                        class="inline-block mr-2 h-5 w-5 text-gray-500"
                                                    />
                                                    A refund has already been requested.
                                                </div>
                                            </div>
                                        {/if}
                                    </div>

                                    {#if isMalformed && isCurrentUserParticipant}
                                        <div
                                            class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4"
                                        >
                                            <p
                                                class="text-xs {$mode === 'dark'
                                                    ? 'text-gray-400'
                                                    : 'text-gray-500'}"
                                            >
                                                The funds will be awarded to the
                                                winner if the competition
                                                concludes successfully. If there
                                                is no winner, the funds will be
                                                allocated to the
                                                creator/resolver.
                                            </p>
                                        </div>
                                    {/if}

                                    {#if isInvalidated && isCurrentUserParticipant}
                                        <div
                                            class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4"
                                        >
                                            <p
                                                class="text-xs {$mode === 'dark'
                                                    ? 'text-red-400'
                                                    : 'text-red-600'}"
                                            >
                                                Your participation was <strong
                                                    >disqualified</strong
                                                > because the majority of judges
                                                deemed it malicious after attempting
                                                to reproduce its result. Since participations
                                                are deterministic, the judges invalidate
                                                any that cannot be correctly replicated.
                                            </p>
                                        </div>
                                    {/if}

                                    {#if isMalformed}
                                        <div
                                            class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4"
                                        >
                                            {#if p.reason === "expired"}
                                                <p
                                                    class="text-xs {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    <strong
                                                        >Invalid participation:</strong
                                                    > The participation was received
                                                    outside the participation period
                                                    and could not be processed.
                                                </p>
                                            {:else if p.reason === "wrongcommitment"}
                                                <p
                                                    class="text-xs {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    <strong
                                                        >Invalid participation:</strong
                                                    > There was an inconsistency
                                                    when verifying the participation's
                                                    data.
                                                </p>
                                            {:else if p.reason === "maxscores"}
                                                <p
                                                    class="text-xs {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    <strong
                                                        >Invalid participation:</strong
                                                    > The participation reached the
                                                    maximum possible score, which
                                                    is not eligible for the prize
                                                    according to the game rules.
                                                </p>
                                            {:else if p.reason === "unknown"}
                                                <p
                                                    class="text-xs {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    <strong
                                                        >Invalid participation:</strong
                                                    > The participation could not
                                                    be processed due to an unknown
                                                    error.
                                                </p>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <p
                            class="text-center text-gray-500 dark:text-gray-400 py-8"
                        >
                            No participations yet.
                        </p>
                    {/if}
                {:else if activeTab === "forum"}
                    <div class="forum-container">
                        <Forum
                            topic_id={game.gameId}
                            {web_explorer_uri_tx}
                            {web_explorer_uri_addr}
                            {web_explorer_uri_tkn}
                            {explorer_uri}
                            maxWidth="100%"
                            profile={$reputation_proof}
                            connected={$connected}
                        />
                    </div>
                {/if}
            </section>
        </div>

        {#if showActionModal && game}
            <div
                class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm"
                on:click|self={closeModal}
                role="presentation"
            >
                <div
                    class="modal-content {$mode === 'dark'
                        ? 'bg-slate-800 text-gray-200 border border-slate-700'
                        : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-4xl transform transition-all"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="modal-title"
                >
                    <div class="flex justify-between items-center mb-6">
                        <h3
                            id="modal-title"
                            class="text-2xl font-semibold {$mode === 'dark'
                                ? 'text-slate-400'
                                : 'text-slate-600'}"
                        >
                            {modalTitle}
                        </h3>
                        <Button
                            variant="ghost"
                            size="icon"
                            on:click={closeModal}
                            aria-label="Close modal"
                            class="{$mode === 'dark'
                                ? 'text-gray-400 hover:text-white'
                                : 'text-gray-500 hover:text-gray-800'} -mr-2 -mt-2"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="28"
                                height="28"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><line x1="18" y1="6" x2="6" y2="18"
                                ></line><line x1="6" y1="6" x2="18" y2="18"
                                ></line></svg
                            >
                        </Button>
                    </div>

                    <div class="modal-form-body">
                        {#if currentActionType === "submit_score"}
                            <div class="space-y-4">
                                <div
                                    class="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4"
                                >
                                    <div class="lg:col-span-2">
                                        <Label
                                            for="jsonFile"
                                            class="block text-sm font-medium mb-1 {$mode ===
                                            'dark'
                                                ? 'text-gray-300'
                                                : 'text-gray-700'}"
                                            >Load Data from JSON File (Optional)</Label
                                        >
                                        <Input
                                            id="jsonFile"
                                            type="file"
                                            accept=".json"
                                            on:change={handleJsonFileUpload}
                                            class="w-full text-sm rounded-md shadow-sm border {$mode ===
                                            'dark'
                                                ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-400'
                                                : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'} file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-medium {$mode ===
                                            'dark'
                                                ? 'file:bg-slate-500 file:text-slate-900 hover:file:bg-slate-400 file:rounded-l-sm'
                                                : 'file:bg-gray-200 file:text-gray-700 hover:file:bg-gray-300 file:rounded-l-sm'} cursor-pointer focus-visible:outline-none focus-visible:ring-2 {$mode ===
                                            'dark'
                                                ? 'focus-visible:ring-slate-500'
                                                : 'focus-visible:ring-slate-400'} focus-visible:ring-offset-2 {$mode ===
                                            'dark'
                                                ? 'focus-visible:ring-offset-slate-900'
                                                : 'focus-visible:ring-offset-white'}"
                                        />
                                        <p
                                            class="text-xs {$mode === 'dark'
                                                ? 'text-gray-500'
                                                : 'text-gray-600'} mt-1.5"
                                        >
                                            Expected fields: `solver_id`,
                                            `hash_logs_hex`, `commitment_c_hex`,
                                            `score_list` (array of numbers).
                                        </p>
                                        {#if jsonUploadError}
                                            <p
                                                class="text-xs mt-1 {$mode ===
                                                'dark'
                                                    ? 'text-red-400'
                                                    : 'text-red-600'}"
                                            >
                                                {jsonUploadError}
                                            </p>
                                        {/if}
                                    </div>

                                    <div
                                        class="lg:col-span-2 flex items-center my-1"
                                    >
                                        <span
                                            class="flex-grow border-t {$mode ===
                                            'dark'
                                                ? 'border-slate-700'
                                                : 'border-gray-300'}"
                                        ></span><span
                                            class="mx-3 text-xs uppercase {$mode ===
                                            'dark'
                                                ? 'text-slate-500'
                                                : 'text-gray-500'}"
                                            >Or Fill Manually</span
                                        ><span
                                            class="flex-grow border-t {$mode ===
                                            'dark'
                                                ? 'border-slate-700'
                                                : 'border-gray-300'}"
                                        ></span>
                                    </div>

                                    <div class="lg:col-span-2">
                                        <Label
                                            for="commitmentC"
                                            class="block text-sm font-medium mb-1 {$mode ===
                                            'dark'
                                                ? 'text-gray-300'
                                                : 'text-gray-700'}"
                                            >Commitment Code (from game service)</Label
                                        >
                                        <Textarea
                                            id="commitmentC"
                                            bind:value={commitmentC_input}
                                            rows={3}
                                            placeholder="Enter the long hexadecimal commitment code provided by the game service after playing."
                                            class="w-full text-sm {$mode ===
                                            'dark'
                                                ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                                : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                        />
                                    </div>

                                    <div>
                                        <Label
                                            for="solverId"
                                            class="block text-sm font-medium mb-1 {$mode ===
                                            'dark'
                                                ? 'text-gray-300'
                                                : 'text-gray-700'}"
                                            >Solver ID / Name</Label
                                        >
                                        <Input
                                            id="solverId"
                                            type="text"
                                            bind:value={solverId_input}
                                            placeholder="e.g., my_solver.celaut.bee or YourPlayerName"
                                            class="w-full text-sm {$mode ===
                                            'dark'
                                                ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                                : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                        />
                                    </div>

                                    <div>
                                        <Label
                                            for="hashLogs"
                                            class="block text-sm font-medium mb-1 {$mode ===
                                            'dark'
                                                ? 'text-gray-300'
                                                : 'text-gray-700'}"
                                            >Hash of Logs (Hex)</Label
                                        >
                                        <Input
                                            id="hashLogs"
                                            type="text"
                                            bind:value={hashLogs_input}
                                            placeholder="Enter the Blake2b-256 hash of your game logs."
                                            class="w-full text-sm {$mode ===
                                            'dark'
                                                ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                                : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                        />
                                    </div>

                                    <div class="lg:col-span-2">
                                        <Label
                                            for="scores"
                                            class="block text-sm font-medium mb-1 {$mode ===
                                            'dark'
                                                ? 'text-gray-300'
                                                : 'text-gray-700'}"
                                            >Scores (comma-separated)</Label
                                        >
                                        <Input
                                            id="scores"
                                            type="text"
                                            bind:value={scores_input}
                                            placeholder="e.g., 100, 25, -10, 0"
                                            class="w-full text-sm {$mode ===
                                            'dark'
                                                ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                                : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                        />
                                        <p
                                            class="text-xs {$mode === 'dark'
                                                ? 'text-gray-500'
                                                : 'text-gray-600'} mt-1"
                                        >
                                            Enter a comma-separated list of
                                            numerical scores.
                                        </p>
                                    </div>
                                </div>
                                <p
                                    class="text-sm {$mode === 'dark'
                                        ? 'text-gray-400'
                                        : 'text-gray-600'} pt-2"
                                >
                                    A participation fee of <strong
                                        >{formatTokenBigInt(
                                            game.participationFeeAmount,
                                            tokenDecimals,
                                        )}
                                        {tokenSymbol}</strong
                                    > will be paid.
                                </p>
                                <Button
                                    on:click={handleSubmitScore}
                                    disabled={isSubmitting ||
                                        !commitmentC_input.trim() ||
                                        !solverId_input.trim() ||
                                        !hashLogs_input.trim() ||
                                        !scores_input.trim()}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-slate-500 hover:bg-slate-600 text-white'
                                        : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold"
                                    >{isSubmitting
                                        ? "Processing..."
                                        : "Confirm & Submit Score"}</Button
                                >
                            </div>
                        {:else if currentActionType === "resolve_game"}
                            <div class="space-y-4">
                                <div>
                                    <Label
                                        for="secret_S_resolve"
                                        class="block text-sm font-medium mb-1 {$mode ===
                                        'dark'
                                            ? 'text-gray-300'
                                            : 'text-gray-700'}"
                                        >Game Secret (S)</Label
                                    ><Textarea
                                        id="secret_S_resolve"
                                        bind:value={secret_S_input_resolve}
                                        rows={3}
                                        placeholder="Enter the original game secret to decrypt scores and resolve."
                                        class="w-full text-sm {$mode === 'dark'
                                            ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                            : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                    />
                                </div>
                                <Button
                                    on:click={handleResolveGame}
                                    disabled={isSubmitting ||
                                        !secret_S_input_resolve.trim()}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-slate-600 hover:bg-slate-700 text-white'
                                        : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold"
                                    >{isSubmitting
                                        ? "Processing..."
                                        : "Resolve Game"}</Button
                                >
                            </div>
                        {:else if currentActionType === "cancel_game"}
                            <div class="space-y-4">
                                <div>
                                    <Label
                                        for="secret_S_cancel"
                                        class="block text-sm font-medium mb-1 {$mode ===
                                        'dark'
                                            ? 'text-gray-300'
                                            : 'text-gray-700'}"
                                        >Game Secret (S)</Label
                                    ><Textarea
                                        id="secret_S_cancel"
                                        bind:value={secret_S_input_cancel}
                                        rows={3}
                                        placeholder="Enter the original game secret to initiate cancellation."
                                        class="w-full text-sm {$mode === 'dark'
                                            ? 'bg-slate-700 border-slate-600 placeholder-slate-500'
                                            : 'bg-gray-50 border-gray-300 placeholder-gray-400'}"
                                    />
                                </div>
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30'
                                        : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"
                                >
                                    <strong>Warning:</strong> Cancelling the competition
                                    will incur penalties, charged to the creator,
                                    and require refunding participants.
                                </p>
                                <Button
                                    on:click={handleCancelGame}
                                    disabled={isSubmitting ||
                                        !secret_S_input_cancel.trim()}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-red-600 hover:bg-red-700 text-white'
                                        : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold"
                                    >{isSubmitting
                                        ? "Processing..."
                                        : "Confirm Game Cancellation"}</Button
                                >
                            </div>
                        {:else if currentActionType === "drain_stake"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
                                        : 'bg-orange-100 text-orange-700 border border-orange-200'}"
                                >
                                    <strong>Action: Drain Stake</strong><br />
                                    You are about to claim a portion of the creator's
                                    stake from this cancelled game. This action is
                                    available periodically as a penalty for the game
                                    creator revealing the secret before the deadline.
                                </p>
                                <p
                                    class="text-sm {$mode === 'dark'
                                        ? 'text-gray-400'
                                        : 'text-gray-600'}"
                                >
                                    This will submit a transaction to the
                                    blockchain. No further input is needed.
                                </p>
                                <Button
                                    on:click={handleDrainStake}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                        : 'bg-orange-500 hover:bg-orange-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm & Drain Stake"}
                                </Button>
                            </div>
                        {:else if currentActionType === "batch_participations"}
                            <p class="text-sm text-muted-foreground mb-4">
                                There are too many participations to process in
                                a single transaction. You need to batch them
                                first.
                            </p>
                            <p class="text-sm text-muted-foreground mb-4">
                                Pending Participations: {participations.filter(
                                    (p) => p.status === "Submitted",
                                ).length}
                                <br />
                                Existing Batches: {participationBatches.length}
                            </p>
                            <div class="flex justify-end gap-2">
                                <Button variant="outline" on:click={closeModal}
                                    >Cancel</Button
                                >
                                <Button
                                    on:click={handleBatchParticipations}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Process Batch"}
                                </Button>
                            </div>
                        {:else if currentActionType === "end_game"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                                        : 'bg-blue-100 text-blue-700 border border-blue-200'}"
                                >
                                    <strong>Action: End Game</strong><br />
                                    This will finalize the game, distributing the
                                    prize pool to the winner, your resolver fee,
                                    and other commissions. This action is irreversible.
                                </p>
                                <Button
                                    on:click={handleEndGame}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm & End Game"}
                                </Button>
                            </div>
                        {:else if currentActionType === "invalidate_winner"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30'
                                        : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"
                                >
                                    <strong>Action: Judge Invalidation</strong
                                    ><br />
                                    As a judge, you are voting to invalidate the
                                    current winner candidate. This requires a majority
                                    of judges to perform the same action. If successful,
                                    the resolution deadline will be extended.
                                </p>
                                <Button
                                    on:click={handleJudgesInvalidate}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                                        : 'bg-yellow-500 hover:bg-yellow-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Invalidation Vote"}
                                </Button>
                            </div>
                        {:else if currentActionType === "include_omitted"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-gray-600/20 text-gray-300 border border-gray-500/30'
                                        : 'bg-gray-100 text-gray-700 border border-gray-200'}"
                                >
                                    <strong
                                        >Action: Include Omitted Participation</strong
                                    ><br />
                                    All missed entries before the deadline will be
                                    selected by default. This will designate you
                                    as the new 'resolver' and will allow you to claim
                                    the creator's commission when the game ends.
                                </p>
                                <Button
                                    on:click={handleIncludeOmitted}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-gray-600 hover:bg-gray-700 text-white'
                                        : 'bg-gray-500 hover:bg-gray-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Inclusion"}
                                </Button>
                            </div>
                        {:else if currentActionType === "submit_creator_opinion"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-green-600/20 text-green-300 border border-green-500/30'
                                        : 'bg-green-100 text-green-700 border border-green-200'}"
                                >
                                    <strong>Action: Verify Game</strong><br />
                                    As the creator of this game (holding the creator
                                    token), you can submit a positive opinion to
                                    verify its authenticity. This helps build trust
                                    with participants.
                                </p>
                                <Button
                                    on:click={handleSubmitCreatorOpinion}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                        : 'bg-green-500 hover:bg-green-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Verification"}
                                </Button>
                            </div>
                        {:else if currentActionType === "accept_judge_nomination"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                                        : 'bg-blue-100 text-blue-700 border border-blue-200'}"
                                >
                                    <strong
                                        >Action: Accept Judge Nomination</strong
                                    ><br />
                                    By accepting, you agree to participate as a judge
                                    in this game, with the responsibility to review
                                    and potentially invalidate the winner if necessary.
                                </p>
                                <Button
                                    on:click={handleJudgeNomination}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Judge Nomination"}
                                </Button>
                            </div>
                        {:else if currentActionType === "open_ceremony"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                                        : 'bg-purple-100 text-purple-700 border border-purple-200'}"
                                >
                                    <strong>Action: Open Ceremony</strong><br />
                                    This action re-spends the active game box before
                                    the <strong>ceremony deadline</strong> to
                                    update its <code>gameSeed</code>, adding new
                                    entropy. It helps ensure fairness and
                                    unpredictability of the final game state.
                                </p>
                                <p
                                    class="text-sm {$mode === 'dark'
                                        ? 'text-gray-400'
                                        : 'text-gray-600'}"
                                >
                                    The new seed will be computed as: <code
                                        >blake2b256(old_seed ++ INPUTS(0).id)</code
                                    >.<br />
                                    No extra input is required — this transaction
                                    simply refreshes the game seed.
                                </p>
                                <Button
                                    on:click={handleOpenCeremony}
                                    disabled={isSubmitting}
                                    class="w-full mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                        : 'bg-purple-500 hover:bg-purple-600 text-white'} font-semibold"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm & Open Ceremony"}
                                </Button>
                            </div>
                        {/if}

                        {#if transactionId && !isSubmitting && showActionModal}
                            <div
                                class="mt-6 p-3 rounded-md text-sm {$mode ===
                                'dark'
                                    ? 'bg-green-600/30 text-green-300 border border-green-500/50'
                                    : 'bg-green-100 text-green-700 border border-green-200'}"
                            >
                                <strong>Success! Transaction ID:</strong><br
                                /><a
                                    href={$web_explorer_uri_tx + transactionId}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="underline break-all hover:text-slate-400"
                                    >{transactionId}</a
                                >
                                <p class="mt-2 text-xs">
                                    You can close this modal. Data will update
                                    after block confirmation.
                                </p>
                            </div>
                        {/if}
                        {#if errorMessage && !isSubmitting && showActionModal}
                            <div
                                class="mt-6 p-3 rounded-md text-sm {$mode ===
                                'dark'
                                    ? 'bg-red-600/30 text-red-300 border border-red-500/50'
                                    : 'bg-red-100 text-red-700 border border-red-200'}"
                            >
                                <strong>Error:</strong>
                                {errorMessage}
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        {/if}
    </div>
{:else}
    <div
        class="flex flex-col items-center justify-center min-h-[calc(100vh-200px)] {$mode ===
        'dark'
            ? 'text-gray-500'
            : 'text-gray-500'} p-8 text-center"
    >
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mb-4 opacity-50"
            ><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line
                x1="8"
                y1="16"
                x2="8"
                y2="16"
            ></line><line x1="8" y1="12" x2="8" y2="12"></line><line
                x1="8"
                y1="8"
                x2="8"
                y2="8"
            ></line><line x1="12" y1="16" x2="12" y2="16"></line><line
                x1="12"
                y1="12"
                x2="12"
                y2="12"
            ></line><line x1="16" y1="16" x2="16" y2="16"></line></svg
        >
        <p class="text-xl font-medium">No game selected.</p>
        <p class="text-sm">
            Please choose a game from the list to see its details, or check if
            it's still loading.
        </p>
    </div>
{/if}

<!-- File Source Modal -->
{#if showFileSourceModal}
    <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        on:click={closeFileSourceModal}
        on:keydown={(e) => e.key === "Escape" && closeFileSourceModal()}
        role="button"
        tabindex="0"
    >
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div on:click|stopPropagation>
            <FileSourceCreation
                profile={$reputation_proof}
                explorerUri={$explorer_uri}
                onSourceAdded={handleFileSourceAdded}
                hash={writable(modalFileHash)}
                class="{$mode === 'dark'
                    ? 'bg-slate-900'
                    : 'bg-white'} border border-border rounded-lg shadow-xl w-full max-w-3xl mx-4 p-6"
            />
        </div>
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

    .game-status,
    .game-info-section {
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
        background-image: linear-gradient(
            to top right,
            rgba(16, 185, 129, 0.15),
            rgba(16, 185, 129, 0)
        );
    }
    :global(.light) .winner-card {
        background-image: linear-gradient(
            to top right,
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
        background: linear-gradient(135deg, #10b981, #059669);
    }

    .modal-content {
        animation: fadeInScale 0.2s ease-out forwards;
    }
    @keyframes fadeInScale {
        from {
            opacity: 0.7;
            transform: scale(0.98) translateY(10px);
        }
        to {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
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
        border: 1px solid theme("colors.slate.500 / 0.2");
    }
    .bar-segment {
        @apply h-full transition-all duration-300 ease-in-out;
    }
    .bar-segment.winner {
        background-color: #22c55e;
    } /* green-500 */
    .bar-segment.creator {
        background-color: #3b82f6;
    } /* blue-500 */
    .bar-segment.judges {
        background-color: #eab308;
    } /* yellow-500 */
    .bar-segment.developers {
        background-color: #a855f7;
    } /* purple-500 */

    .distribution-legend {
        @apply flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground;
    }
    .legend-item {
        @apply flex items-center gap-2;
    }
    .legend-color {
        @apply w-3 h-3 rounded-full;
    }
    .legend-color.winner {
        background-color: #22c55e;
    }
    .legend-color.creator {
        background-color: #3b82f6;
    }
    .legend-color.judges {
        background-color: #eab308;
    }
    .legend-color.developers {
        background-color: #a855f7;
    }
</style>
