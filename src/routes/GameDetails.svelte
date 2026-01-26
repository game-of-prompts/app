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
        muted,
        audio_element,
        user_volume,
    } from "$lib/common/store";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { onDestroy, onMount, tick } from "svelte";
    import { get, writable } from "svelte/store";
    import {
        fetchParticipations,
        fetch_token_details,
        fetchParticipationBatches,
        fetchSolverIdBox,
    } from "$lib/ergo/fetch";
    import { remove_opinion } from "reputation-system";
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
        AlertTriangle,
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
        Lock as LockIcon,
        Wand2,
        Music,
        VolumeX,
        Terminal,
        ArrowRight,
        Copy,
    } from "lucide-svelte";
    // UTILITIES
    import { format, formatDistanceToNow } from "date-fns";
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import {
        web_explorer_uri_tkn,
        web_explorer_uri_tx,
        web_explorer_uri_addr,
        explorer_uri,
        source_explorer_url,
        forum_explorer_url,
        USE_CHAINED_TRANSACTIONS,
    } from "$lib/ergo/envs";
    import { type Amount, type Box, ErgoAddress } from "@fleet-sdk/core";
    import {
        uint8ArrayToHex,
        pkHexToBase58Address,
        hexToBytes,
    } from "$lib/ergo/utils";
    import { mode } from "mode-watcher";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { isDevMode } from "$lib/ergo/envs";

    // SOURCE APPLICATION IMPORTS
    import { FileCard, FileSourceCreation } from "source-application";
    import { fetchFileSourcesByHash } from "source-application";

    import {
        getDisplayStake,
        getParticipationFee,
        formatTokenBigInt,
        prependHexPrefix,
    } from "$lib/utils";
    import {
        fetchJudges,
        fetchReputationProofByTokenId,
    } from "$lib/ergo/reputation/fetch";
    import { type RPBox, type ReputationProof } from "reputation-system";
    import { GAME, PARTICIPATION } from "$lib/ergo/reputation/types";
    import { Forum } from "forum-application";
    import ShareModal from "./ShareModal.svelte";

    const strictMode = true;

    const PARTICIPATION_BATCH_THRESHOLD = 2;

    // --- COMPONENT STATE ---
    let game: AnyGame | null = null;
    let primaryAction: string | null = null;

    $: isBeforeDeadline = targetDate
        ? new Date().getTime() < targetDate
        : false;
    $: primaryAction = getPrimaryAction(
        game,
        openCeremony,
        participationIsEnded,
        isNominatedJudge,
        isJudge,
        isBeforeDeadline,
    );

    function getPrimaryAction(
        game: AnyGame | null,
        openCeremony: boolean,
        participationIsEnded: boolean,
        isNominatedJudge: boolean,
        isJudge: boolean,
        isBeforeDeadline: boolean,
    ): string | null {
        if (!game) return null;

        if (game.status === "Active") {
            if (openCeremony) return "open_ceremony";
            if (!participationIsEnded) return "submit_score";
            return "resolve_game";
        }

        if (game.status === "Resolution") {
            if (!isBeforeDeadline) return "end_game";
            return null; // No primary action during judge period (only secondary/destructive)
        }

        if (game.status === "Cancelled_Draining") return "drain_stake";

        return null;
    }

    $: secondaryActions = getSecondaryActions(
        game,
        isNominatedJudge,
        isJudge,
        isBeforeDeadline,
        $reputation_proof,
        candidateParticipationInvalidVotes,
        candidateParticipationUnavailableVotes,
        $address,
    );

    $: disabledActions = getDisabledActions(
        game,
        openCeremony,
        participationIsEnded,
        isBeforeDeadline,
        strictMode,
    );

    $: if (soundtrackUrl) loadedHandlerAdded = false;
    $: if (soundtrackUrl && audioElement && !$muted && !loadedHandlerAdded) {
        loadedHandlerAdded = true;
        audioElement.addEventListener("loadeddata", () => {
            if (!$muted) {
                audioElement.volume = 0;
                audioElement.play().catch(() => {});
                fadeInAudio(audioElement, $user_volume);
            }
        });
        audioElement.load();
    }
    $: if (audioElement) {
        audioElement.volume = $user_volume;
        audioElement.muted = $muted;
    }

    function getSecondaryActions(
        game: AnyGame | null,
        isNominatedJudge: boolean,
        isJudge: boolean,
        isBeforeDeadline: boolean,
        reputationProof: ReputationProof | null,
        candidateParticipationInvalidVotes: string[],
        candidateParticipationUnavailableVotes: string[],
        address: string,
    ) {
        if (!game) return [];
        const actions = [];

        if (game.status === "Active") {
            if (isNominatedJudge && !isJudge) {
                actions.push({
                    id: "accept_judge_nomination",
                    label: "Accept Judge Nomination",
                    icon: Gavel,
                    variant: "outline",
                });
            }
            actions.push({
                id: "cancel_game",
                label: "Cancel Competition",
                icon: XCircle,
                variant: "destructive",
            });
        }

        if (game.status === "Resolution" && isBeforeDeadline) {
            actions.push({
                id: "include_omitted",
                label: "Include Omitted Participations",
                icon: Users,
                variant: "outline",
            });
            // Only allow judge actions if there's a winner candidate
            if (isJudge && game.winnerCandidateCommitment) {
                actions.push({
                    id: "invalidate_winner",
                    label: "Invalidate Winner",
                    icon: XCircle,
                    variant: "destructive",
                });
                actions.push({
                    id: "judge_unavailable",
                    label: "Mark Winner Service Unavailable",
                    icon: AlertTriangle,
                    variant: "outline",
                });
                if (
                    candidateParticipationInvalidVotes.includes(address) ||
                    candidateParticipationUnavailableVotes.includes(address)
                ) {
                    actions.push({
                        id: "remove_opinion",
                        label: "Mark Winner Service Available",
                        icon: Trash2,
                        variant: "outline",
                    });
                }
            }
        }

        // Creator Verification
        if (
            game.content.creatorTokenId &&
            reputationProof &&
            game.content.creatorTokenId === reputationProof.token_id
        ) {
            const creatorPositiveOpinion = game.reputationOpinions?.find(
                (op) =>
                    op.token_id === game.content.creatorTokenId &&
                    op.polarization === true,
            );
            if (!creatorPositiveOpinion) {
                actions.push({
                    id: "submit_creator_opinion",
                    label: "Verify as Creator",
                    icon: ShieldCheck,
                    variant: "outline",
                    class: "border-green-500 text-green-500 hover:bg-green-50 hover:text-green-600",
                });
            }
        }

        return actions;
    }

    function getDisabledActions(
        game: AnyGame | null,
        openCeremony: boolean,
        participationIsEnded: boolean,
        isBeforeDeadline: boolean,
        strictMode: boolean,
    ) {
        if (!game) return [];
        const actions = [];

        if (game.status === "Active") {
            if (!openCeremony) {
                actions.push({
                    label: "Add Seed Randomness",
                    reason: "Ceremony period ended",
                    icon: Sparkles,
                });
            }
            if (participationIsEnded) {
                actions.push({
                    label: "Submit Score",
                    reason: "Deadline has passed",
                    icon: Edit,
                });
            } else if (strictMode && openCeremony) {
                actions.push({
                    label: "Submit Score",
                    reason: "Ceremony period is open",
                    icon: Edit,
                });
            }

            if (!participationIsEnded) {
                actions.push({
                    label: "Resolve Competition",
                    reason: "Wait for participation deadline",
                    icon: CheckSquare,
                });
            }
        }

        if (game.status === "Resolution") {
            if (isBeforeDeadline) {
                actions.push({
                    label: "End Competition",
                    reason: "Judge period active",
                    icon: Trophy,
                });
            } else {
                actions.push({
                    label: "Invalidate Winner",
                    reason: "Judge period ended",
                    icon: XCircle,
                });
                actions.push({
                    label: "Include Omitted",
                    reason: "Judge period ended",
                    icon: Users,
                });
            }
        }

        return actions;
    }
    let platform = new ErgoPlatform();
    let participations: AnyParticipation[] = [];
    let participationVotes: Map<
        string,
        Map<string, ReputationProof>
    > = new Map();
    let participationUnavailableVotes: Map<
        string,
        Map<string, ReputationProof>
    > = new Map();
    let candidateParticipationValidVotes: string[] = [];
    let candidateParticipationInvalidVotes: string[] = [];
    let candidateParticipationUnavailableVotes: string[] = [];
    let currentHeight: number = 0;
    let participationBatches: Box<Amount>[] = [];

    // UI State
    let transactionId: string | null = null;
    let modalTitle: string = "";
    let errorMessage: string | null = null;
    let warningMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let isSubmitting: boolean = false;
    let showShareModal = false;
    let showInfoBlocks = true;

    // Game Status State
    let participationIsEnded = true;
    let deadlineDateDisplay = "N/A";
    let isOwner = false;
    let isResolver = false;
    let isJudge = false;
    let isNominatedJudge = false;
    let openCeremony = false;
    let acceptedJudgeNominations: string[] = [];
    let isInvalidationMajorityReached = false;

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
    let clockLabel: string = "TIME LEFT";
    let clockInformation: string = "Depends on game status";
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;
    let createdDateDisplay: string = "";

    // Modal State
    let showActionModal = false;
    let showParticipantGuide = true;
    let showSolverIdStep = false;
    let showJudgeGuide = true;
    let currentActionType:
        | "submit_score"
        | "resolve_game"
        | "cancel_game"
        | "drain_stake"
        | "end_game"
        | "invalidate_winner"
        | "judge_unavailable"
        | "remove_opinion"
        | "include_omitted"
        | "accept_judge_nomination"
        | "open_ceremony"
        | "batch_participations"
        | "submit_creator_opinion"
        | null = null;

    // Didactic Modal State
    let showDidacticModal = false;
    let didacticModalTitle = "";
    let didacticModalText = "";

    function openDidacticModal(title: string, text: string) {
        didacticModalTitle = title;
        didacticModalText = text;
        showDidacticModal = true;
    }

    function closeDidacticModal() {
        showDidacticModal = false;
    }

    function fadeInAudio(
        audio: HTMLAudioElement,
        targetVolume: number,
        duration: number = 2000,
    ) {
        const startVolume = 0;
        const steps = 50;
        const stepDuration = duration / steps;
        const volumeStep = (targetVolume - startVolume) / steps;
        let currentStep = 0;
        const interval = setInterval(() => {
            currentStep++;
            audio.volume = Math.min(
                startVolume + volumeStep * currentStep,
                targetVolume,
            );
            if (currentStep >= steps) {
                clearInterval(interval);
            }
        }, stepDuration);
    }

    let tokenSymbol = "ERG";
    let tokenDecimals = 9;

    // File Source Modal State
    let showFileSourceModal = false;
    let modalFileHash = "";
    let modalFileType: "image" | "service" | "paper" | "soundtrack" = "image";
    let imageSources: any[] = [];
    let serviceSources: any[] = [];
    let paperSources: any[] = [];
    let paperContent: string | null = null;
    let isPaperExpanded = false;
    let paperToc: { level: number; text: string; id: string }[] = [];
    let soundtrackSources: any[] = [];
    let soundtrackUrl: string | null = null;
    let audioElement: HTMLAudioElement;
    let showAudioControls = false;
    let loadedHandlerAdded = false;

    $: audio_element.set(audioElement || null);

    function openFileSourceModal(
        hash: string,
        type: "image" | "service" | "paper" | "soundtrack",
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
            } else if (modalFileType === "soundtrack") {
                soundtrackSources = await fetchFileSourcesByHash(
                    modalFileHash,
                    get(explorer_uri),
                );
            }
        }
    }

    // Form Inputs
    let commitmentC_input = "";
    let solverId_input = "";
    let solverId_box_found = false;
    let solverId_check_loading = false;
    let solverId_check_error: string | null = null;
    let hashLogs_input = "";
    let user_score: number | null = null;
    let scores_list: number[] = [];
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";

    let isAutoFilling = false;

    // Reactivity: Each time 'user_score' changes, we regenerate the rivals
    $: if (!isAutoFilling && user_score !== null && user_score !== undefined) {
        // Generate 6 random numbers between 0 and 100
        const random_scores = Array.from({ length: 6 }, () =>
            Math.floor(Math.random() * 100),
        );

        // Combine user score with rivals in a random position
        const full_list = [...random_scores];
        const randomIndex = Math.floor(Math.random() * (full_list.length + 1));
        full_list.splice(randomIndex, 0, user_score);
        scores_list = full_list;
    } else {
        scores_list = [];
    }

    // DEV MODE STATE
    let devGenScore = 100;
    let devGenErrorType: "none" | "wrong_commitment" | "wrong_score" = "none";
    let isDevModeExpanded = false;

    async function generateDevParticipation() {
        try {
            // 1. Generate Random Values
            const randomBytes = new Uint8Array(32);
            window.crypto.getRandomValues(randomBytes);
            const solverId = uint8ArrayToHex(randomBytes);

            window.crypto.getRandomValues(randomBytes);
            const hashLogs = uint8ArrayToHex(randomBytes);

            const seed = game?.seed;

            // 2. Get Constants/Context
            const secretS = game?.content.serviceId; // Dev competitions typically use the serviceId as secretS

            const playerAddressString = await ergo.get_change_address();
            if (!playerAddressString) {
                throw new Error(
                    "Could not get the player's address from the wallet.",
                );
            }
            const playerP2PKAddress =
                ErgoAddress.fromBase58(playerAddressString);
            const playerPkBytes = playerP2PKAddress.getPublicKeys()[0];
            if (!playerPkBytes) {
                throw new Error(
                    `Could not extract the public key from the player's address (${playerAddressString}).`,
                );
            }
            const ergoTree = prependHexPrefix(playerPkBytes);

            // 3. Generate Score List with Decoys
            const numScores = 7; // Total scores in the list (1 real + 6 decoys)
            const scores: bigint[] = [];
            const realScoreIndex = Math.floor(Math.random() * numScores); // Random position for real score

            for (let i = 0; i < numScores; i++) {
                if (i === realScoreIndex) {
                    scores.push(BigInt(devGenScore));
                } else {
                    // Generate random decoy score (always positive, 0-200)
                    const decoyScore = Math.floor(Math.random() * 201);
                    scores.push(BigInt(decoyScore));
                }
            }

            // 4. Prepare Data for Hashing (using the real score for commitment)
            // Order: solver_id + seed + score + hash_logs + ergoTree + secret_s

            const solverIdBytes = hexToBytes(solverId);
            const seedBytes = hexToBytes(seed); // Assuming hex seed

            // Real score to 8 bytes big endian
            const scoreBytes = new Uint8Array(8);
            const view = new DataView(scoreBytes.buffer);
            view.setBigInt64(0, BigInt(devGenScore), false); // false for big-endian

            const hashLogsBytes = hexToBytes(hashLogs);
            const ergoTreeBytes = ergoTree;
            const secretSBytes = hexToBytes(secretS);

            if (
                !solverIdBytes ||
                !seedBytes ||
                !hashLogsBytes ||
                !ergoTreeBytes ||
                !secretSBytes
            ) {
                console.log(
                    solverIdBytes,
                    seedBytes,
                    hashLogsBytes,
                    ergoTreeBytes,
                    secretSBytes,
                );
                throw new Error("Failed to convert hex to bytes");
            }

            const concatenated = new Uint8Array(
                solverIdBytes.length +
                    seedBytes.length +
                    scoreBytes.length +
                    hashLogsBytes.length +
                    ergoTreeBytes.length +
                    secretSBytes.length,
            );

            let offset = 0;
            concatenated.set(solverIdBytes, offset);
            offset += solverIdBytes.length;
            concatenated.set(seedBytes, offset);
            offset += seedBytes.length;
            concatenated.set(scoreBytes, offset);
            offset += scoreBytes.length;
            concatenated.set(hashLogsBytes, offset);
            offset += hashLogsBytes.length;
            concatenated.set(ergoTreeBytes, offset);
            offset += ergoTreeBytes.length;
            concatenated.set(secretSBytes, offset);
            offset += secretSBytes.length;

            // 5. Hash
            const commitment = uint8ArrayToHex(fleetBlake2b256(concatenated));

            // 6. Apply Errors if requested
            let finalCommitment = commitment;
            let finalScores = [...scores];

            if (devGenErrorType === "wrong_commitment") {
                // Change last char
                finalCommitment =
                    finalCommitment.slice(0, -1) +
                    (finalCommitment.endsWith("a") ? "b" : "a");
            } else if (devGenErrorType === "wrong_score") {
                // Change the real score in the list
                finalScores[realScoreIndex] = BigInt(devGenScore + 1);
            }

            // 7. Fill Inputs
            isAutoFilling = true;
            solverId_input = solverId;
            hashLogs_input = hashLogs;
            commitmentC_input = finalCommitment;
            user_score = devGenScore;
            scores_list = finalScores.map((s) => Number(s));

            tick().then(() => {
                isAutoFilling = false;
            });

            console.log("Dev Generation Complete", {
                solverId,
                seed,
                realScore: devGenScore,
                realScoreIndex,
                scores: finalScores.map((s) => s.toString()),
                hashLogs,
                ergoTree,
                secretS,
                commitment,
                finalCommitment,
                finalScores: finalScores.map((s) => s.toString()),
            });
        } catch (e) {
            console.error("Dev Generation Error", e);
            alert("Error generating participation: " + e);
        }
    }

    async function checkSolverIdBox() {
        if (!solverId_input) {
            solverId_check_error = "Please enter a Solver ID.";
            return;
        }
        solverId_check_loading = true;
        solverId_check_error = null;
        try {
            const box = await fetchSolverIdBox(solverId_input);
            if (box) {
                solverId_box_found = true;
            } else {
                solverId_box_found = false;
                solverId_check_error =
                    "Solver ID box not found. Please publish it first.";
            }
        } catch (e) {
            console.error("Error checking solver ID box:", e);
            solverId_check_error = "Error checking solver ID box.";
        } finally {
            solverId_check_loading = false;
        }
    }

    async function handlePublishSolverId() {
        if (!solverId_input) {
            // Generate random if empty? No, better force user to have one or generate one explicitly.
            // Let's generate one if empty for convenience
            const randomBytes = new Uint8Array(32);
            window.crypto.getRandomValues(randomBytes);
            solverId_input = uint8ArrayToHex(randomBytes);
        }

        isSubmitting = true;
        errorMessage = null;
        try {
            const txId = await platform.publishSolverId(solverId_input);
            if (txId) {
                transactionId = txId;
                // Optimistically assume it will be found (or user can wait)
                // We can't immediately find it until it's in mempool/mined and explorer sees it.
                // For now, let's just show success and let user click "Continue" which checks again.
                // Or we can set a flag "solverIdPublished" to allow proceeding?
                // The checkSolverIdBox might fail if explorer is slow.
                // Let's just show the txId and tell user to wait a bit.
            }
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

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

    async function loadGameDetailsAndTimers() {
        if (!game) {
            cleanupTimers();
            return;
        }

        currentHeight = await platform.get_current_height();

        isSubmitting = false;
        transactionId = null;
        errorMessage = null;
        warningMessage = null;
        try {
            participationIsEnded = await isGameParticipationEnded(game);
            openCeremony = await isOpenCeremony(game);

            soundtrackUrl = game.content.soundtrackURL;

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
            if (game.content.soundtrack) {
                soundtrackSources = await fetchFileSourcesByHash(
                    game.content.soundtrack,
                    get(explorer_uri),
                );
                if (soundtrackSources.length > 0) {
                    soundtrackUrl = soundtrackSources[0].sourceUrl;
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

                    const unavailableVotes = new Map<string, ReputationProof>(
                        Array.from(get(judges).data.entries()).filter(
                            ([key, judge]) => {
                                return judge.current_boxes.some((box) => {
                                    return (
                                        box.object_pointer === participation &&
                                        box.type.tokenId ===
                                            game?.constants
                                                .PARTICIPATION_UNAVAILABLE_TYPE_ID
                                    );
                                });
                            },
                        ),
                    );

                    participationUnavailableVotes.set(
                        participation,
                        unavailableVotes,
                    );
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

                    const candidate_unavailable_votes = Array.from(
                        participationUnavailableVotes
                            .get(game.winnerCandidateCommitment)
                            ?.entries() ?? [],
                    );

                    candidateParticipationUnavailableVotes =
                        candidate_unavailable_votes
                            .filter(([key, value]) => {
                                return value.current_boxes.some((box) => {
                                    return (
                                        box.object_pointer ===
                                            game.winnerCandidateCommitment &&
                                        box.type.tokenId ===
                                            game.constants
                                                .PARTICIPATION_UNAVAILABLE_TYPE_ID
                                    );
                                });
                            })
                            .map(([key, value]) => key);

                    const requiredVotes =
                        Math.floor(game.judges.length / 2) + 1;
                    isInvalidationMajorityReached =
                        candidateParticipationInvalidVotes.length >=
                        requiredVotes;
                }
            } else if (game.status === GameState.Cancelled_Draining) {
                participations = await fetchParticipations(game);
            } else if (game.status === GameState.Finalized) {
                participations = await fetchParticipations(game);
            }

            if (game.status === "Active") {
                if (openCeremony) {
                    targetDate = await block_height_to_timestamp(
                        game.ceremonyDeadline,
                        platform,
                    );
                    clockLabel = "Ceremony Deadline";
                } else if (currentHeight < game.deadlineBlock) {
                    targetDate = await block_height_to_timestamp(
                        game.deadlineBlock,
                        platform,
                    );
                    clockLabel = "Participation Deadline";
                    clockInformation =
                        "Block limit for submissions. After this block, no new participations will be accepted.";
                } else {
                    // Grace Period
                    targetDate = await block_height_to_timestamp(
                        game.deadlineBlock +
                            game.constants.PARTICIPATION_GRACE_PERIOD,
                        platform,
                    );
                    clockLabel = "Grace Period";
                }

                deadlineDateDisplay = format(
                    new Date(targetDate),
                    "MMM d, yyyy 'at' HH:mm",
                );
            } else if (game.status === "Resolution") {
                if (currentHeight < game.resolutionDeadline) {
                    targetDate = await block_height_to_timestamp(
                        game.resolutionDeadline,
                        platform,
                    );
                    clockLabel = "Resolution Deadline";
                } else {
                    // Grace Period for Resolution
                    targetDate = await block_height_to_timestamp(
                        game.resolutionDeadline +
                            game.constants.END_GAME_AUTH_GRACE_PERIOD,
                        platform,
                    );
                    clockLabel = "Grace Period";
                }
                deadlineDateDisplay = `${clockLabel} ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else if (game.status === "Cancelled_Draining") {
                targetDate = await block_height_to_timestamp(
                    game.unlockHeight,
                    platform,
                );
                clockLabel = "Stake Unlocks";
                deadlineDateDisplay = `Stake unlocks ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else {
                deadlineDateDisplay = "N/A";
            }

            if (game.createdAt) {
                const createdTimestamp = await block_height_to_timestamp(
                    game.createdAt,
                    platform,
                );
                createdDateDisplay = format(
                    new Date(createdTimestamp),
                    "MMM d, yyyy",
                );
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
            cleanupTimers();
            if (game.status !== "Finalized" && targetDate) {
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
            const parsedScores = scores_list.map((s) => BigInt(s));
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
        if (!game) return;
        errorMessage = null;
        isSubmitting = true;

        try {
            if (game.status === "Resolution") {
                const valid_participations = participations.filter(
                    (p) => p.status === "Submitted",
                ) as ValidParticipation[];

                if (!game.isEndGame) {
                    if (USE_CHAINED_TRANSACTIONS) {
                        // Use chained transaction: Resolution -> EndGame -> Finalize
                        const txIds = await platform.toEndGameChained(
                            game,
                            valid_participations,
                        );
                        transactionId = txIds ? txIds.join(", ") : null;
                    } else {
                        // First, transition to EndGame (intermediate state)
                        transactionId = await platform.toEndGame(game);
                    }
                } else {
                    // Game is already in EndGame state, just finalize
                    transactionId = await platform.endGame(
                        game,
                        valid_participations,
                    );
                }
            }
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
                judgeInvalidVotesDataInputsBoxes,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJudgesInvalidateUnavailable() {
        if (game?.status !== "Resolution") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const winner_participation = participations.filter(
                (p) => game.winnerCandidateCommitment === p.commitmentC_Hex,
            )[0];

            let judgeUnavailableVotesDataInputsBoxes: Box<Amount>[] = [];
            const winnerVotes = participationUnavailableVotes.get(
                game.winnerCandidateCommitment,
            );
            if (winnerVotes) {
                const judgeUnavailableVotesDataInputs = Array.from(
                    winnerVotes.entries(),
                ).filter(([key, value]) => {
                    return candidateParticipationUnavailableVotes.includes(key);
                });

                judgeUnavailableVotesDataInputsBoxes =
                    judgeUnavailableVotesDataInputs.map(([Key, value]) => {
                        return value.current_boxes.filter((box) => {
                            return (
                                box.object_pointer ===
                                    game.winnerCandidateCommitment &&
                                box.type.tokenId ===
                                    game.constants
                                        .PARTICIPATION_UNAVAILABLE_TYPE_ID
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

            transactionId = await platform.judgesInvalidateUnavailable(
                game,
                winner_participation as ValidParticipation,
                judgeUnavailableVotesDataInputsBoxes,
            );
        } catch (e: any) {
            errorMessage = e.message;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleRemoveOpinion() {
        if (game?.status !== "Resolution" || !$reputation_proof) return;
        errorMessage = null;
        isSubmitting = true;
        try {
            // Find the opinion box for this judge and participation
            const opinionBox = $reputation_proof.boxes.find(
                (box) =>
                    box.object_pointer === game.winnerCandidateCommitment &&
                    box.polarization === false &&
                    (box.type.tokenId === PARTICIPATION ||
                        box.type.tokenId ===
                            game.constants.PARTICIPATION_UNAVAILABLE_TYPE_ID),
            );
            if (!opinionBox) {
                throw new Error("No opinion box found for this participation.");
            }
            // Find the main reputation box
            const mainBox = $reputation_proof.boxes.find(
                (box) => box.type.tokenId === $reputation_proof.token_id,
            );
            if (!mainBox) {
                throw new Error("Main reputation box not found.");
            }
            transactionId = await remove_opinion(
                explorer_uri,
                opinionBox,
                mainBox,
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
                        scores_list = jsonData.score_list.map((s: any) =>
                            Number(s),
                        );
                        if (scores_list.length > 0) {
                            user_score = scores_list[0];
                        }
                    } else throw new Error("Missing or invalid 'score_list'");
                } catch (e: any) {
                    jsonUploadError = `Error reading JSON: ${e.message}`;
                    commitmentC_input = "";
                    solverId_input = "";
                    hashLogs_input = "";
                    user_score = null;
                    scores_list = [];
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
            resolve_game: `Resolve Competition`,
            cancel_game: `Cancel Competition`,
            drain_stake: `Drain Creator Stake`,
            end_game: `Finalize Competition`,
            invalidate_winner: `Judge Invalidation`,
            judge_unavailable: `Judge Mark Unavailable`,
            include_omitted: `Include Omitted Participation`,
            accept_judge_nomination: "Accept Judge Nomination",
            open_ceremony: "Add Seed Randomness",
            batch_participations: "Batch Participations",
            submit_creator_opinion: "Verify Competition (Creator Opinion)",
            remove_opinion: "Judge Mark Available",
        };
        modalTitle = titles[type] || "Action";
        errorMessage = null;
        warningMessage = null;
        isSubmitting = false;
        transactionId = null;

        // Reset guide states
        if (type === "invalidate_winner" || type === "judge_unavailable") {
            showJudgeGuide = true;
        }

        showActionModal = true;
    }

    function closeModal() {
        showActionModal = false;
        currentActionType = null;
    }

    function shareGame() {
        if (!game) return;
        showShareModal = true;
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

    // --- Risk Level Logic ---
    $: uniqueJudges = game?.judges
        ? [...new Set(game.judges)].filter(
              (j) => j !== game?.content?.creatorTokenId,
          )
        : [];

    $: riskLevel =
        uniqueJudges.length === 0
            ? "High"
            : uniqueJudges.length <= 5
              ? "Medium"
              : "Low";

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
    <ShareModal
        bind:open={showShareModal}
        projectName={game.content.title}
        projectId={game.gameId}
        projectStatus={game.status}
        description={game.content.description}
    />
{/if}

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
                                <span class="stat-label"
                                    >Reputation<button
                                        type="button"
                                        class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                "Reputation",
                                                "The game's reputation score based on the reputation of the winner and nominated judges.",
                                            )}
                                    >
                                        <Info class="w-3.5 h-3.5" />
                                    </button></span
                                >
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
                                <span class="stat-label"
                                    >Entry Fee<button
                                        type="button"
                                        class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                "Entry Fee",
                                                "The cost each player must pay to participate. This amount accumulates in the Prize Pool.",
                                            )}
                                    >
                                        <Info class="w-3.5 h-3.5" />
                                    </button></span
                                >
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
                                <span class="stat-label"
                                    >Prize Pool<button
                                        type="button"
                                        class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                "Prize Pool",
                                                "The accumulated participation fees. Distributed to the winner and commissions upon finalization.",
                                            )}
                                    >
                                        <Info class="w-3.5 h-3.5" />
                                    </button></span
                                >
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
                                <span class="stat-label"
                                    >Creator Stake<button
                                        type="button"
                                        class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                "Creator Stake",
                                                "Guarantee deposited by the creator. Lost if the secret is revealed or discovered prematurely, incentivizing the creator to keep it safe.",
                                            )}
                                    >
                                        <Info class="w-3.5 h-3.5" />
                                    </button></span
                                >
                            </div>
                            <div class="stat-block">
                                <CheckSquare class="stat-icon" />
                                <span
                                    >{game.status == "Active"
                                        ? (
                                              game.commissionPercentage / 10000
                                          ).toFixed(4)
                                        : game.status == "Resolution" ||
                                            game.status == "EndGame"
                                          ? (
                                                game.resolverCommission / 10000
                                            ).toFixed(4)
                                          : "N/A"}%</span
                                >
                                <span class="stat-label"
                                    >Commission<button
                                        type="button"
                                        class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                "Commission",
                                                "Percentage of the Prize Pool received by the creator (or resolver) upon successful game finalization.",
                                            )}
                                    >
                                        <Info class="w-3.5 h-3.5" />
                                    </button></span
                                >
                            </div>
                            {#if createdDateDisplay}
                                <div class="stat-block">
                                    <Calendar class="stat-icon" />
                                    <span>{createdDateDisplay}</span>
                                    <span class="stat-label">Created At</span>
                                </div>
                            {/if}
                        </div>
                        <div class="stat-block mt-4">
                            <Calendar class="stat-icon" />
                            <span>{deadlineDateDisplay.split(" at ")[0]}</span>
                            <!-- svelte-ignore a11y-missing-attribute -->
                            <a
                                >b.{game.status == "Active"
                                    ? game.deadlineBlock
                                    : game.status == "Resolution" ||
                                        game.status == "EndGame"
                                      ? game.resolutionDeadline
                                      : game.status == "Cancelled_Draining"
                                        ? game.unlockHeight
                                        : "N/A"}</a
                            >
                            <span class="stat-label"
                                >{clockLabel}<button
                                    type="button"
                                    class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                    on:click|stopPropagation={() =>
                                        openDidacticModal(
                                            clockLabel,
                                            clockInformation,
                                        )}
                                >
                                    <Info class="w-3.5 h-3.5" />
                                </button></span
                            >
                        </div>

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

                            {#if soundtrackUrl}
                                <div
                                    class="mt-8 border-t border-border pt-8 hidden"
                                >
                                    <div class="flex items-center gap-2 mb-2">
                                        <Music class="w-5 h-5 text-green-500" />
                                        <h3 class="text-lg font-semibold">
                                            Soundtrack
                                        </h3>
                                        {#if $reputation_proof && game.content.soundtrack}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                on:click={() =>
                                                    openFileSourceModal(
                                                        game.content.soundtrack,
                                                        "soundtrack",
                                                    )}
                                            >
                                                Add Source
                                            </Button>
                                        {/if}
                                    </div>
                                    <div class="mb-4">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            on:click={() =>
                                                (showAudioControls =
                                                    !showAudioControls)}
                                        >
                                            {showAudioControls
                                                ? "Hide"
                                                : "Show"} Controls
                                        </Button>
                                    </div>
                                    <audio
                                        bind:this={audioElement}
                                        controls={showAudioControls}
                                        class="w-full {showAudioControls
                                            ? ''
                                            : 'absolute left-[-9999px]'} "
                                        muted={$muted}
                                    >
                                        <source
                                            src={soundtrackUrl}
                                            type="audio/mpeg"
                                        />
                                        Your browser does not support the audio element.
                                    </audio>
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
                                        >{game.status === "Resolution" ||
                                        game.status === "EndGame"
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
                                            >Creator Reputation Token ID {isOwner
                                                ? "(You)"
                                                : ""}</span
                                        >
                                        {#if game.content.creatorTokenId}
                                            <a
                                                href={$web_explorer_uri_tkn +
                                                    game.content.creatorTokenId}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="info-value font-mono text-xs break-all hover:underline"
                                                title={game.content
                                                    .creatorTokenId}
                                            >
                                                {game.content.creatorTokenId}
                                            </a>
                                        {:else}
                                            <span class="info-value">N/A</span>
                                        {/if}
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Competition ID (NFT)<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Competition ID (NFT)",
                                                        "Unique token identifying this game on the blockchain. Tracks the game's history and is awarded to the winner as a trophy.",
                                                    )}
                                            >
                                                <Info class="w-3.5 h-3.5" />
                                            </button></span
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
                                            >Service ID<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Service ID",
                                                        "Hash of the Celaut service running the game. Players must execute it on their own computer to play and can verify they use the same game.",
                                                    )}
                                            >
                                                <Info class="w-3.5 h-3.5" />
                                            </button></span
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
                                            >Indeterminism Index<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Indeterminism Index",
                                                        "Number of times judges will test your participation to verify if it reproduces your game logs. If judges cannot reproduce the logs, the participation is invalidated.",
                                                    )}
                                            >
                                                <Info class="w-3.5 h-3.5" />
                                            </button></span
                                        >
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                        >
                                            {game.content.indetermismIndex}
                                        </span>
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Seed<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Seed",
                                                        "Random seed determining the game scenario. Generated during the initial ceremony where anyone can participate.",
                                                    )}
                                            >
                                                <Info class="w-3.5 h-3.5" />
                                            </button></span
                                        >
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                        >
                                            {game.seed ?? "N/A"}
                                        </span>
                                    </div>

                                    {#if game.status === "Resolution" && game.revealedS_Hex}
                                        <div class="info-block md:col-span-2">
                                            <span class="info-label"
                                                >Revealed Secret (S)<button
                                                    type="button"
                                                    class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                    on:click|stopPropagation={() =>
                                                        openDidacticModal(
                                                            "Revealed Secret (S)",
                                                            "The creator's secret, revealed when resolving the game. Allows validation of all participation scores.",
                                                        )}
                                                >
                                                    <Info class="w-3.5 h-3.5" />
                                                </button></span
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
                                                source_explorer_url={$source_explorer_url}
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
                                            source_explorer_url={$source_explorer_url}
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
                                            source_explorer_url={$source_explorer_url}
                                            webExplorerUriTkn={$web_explorer_uri_tkn}
                                        />
                                    </div>
                                </details>
                            </div>
                        {/if}

                        {#if game.content.soundtrack && game.content.soundtrack.length === 64}
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
                                            <Music
                                                class="w-5 h-5 text-green-500"
                                            />
                                            <span>Game Soundtrack Sources</span>
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
                                            for the game soundtrack audio file
                                            (hash: <span
                                                class="font-mono text-xs"
                                                >{game.content.soundtrack.slice(
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
                                                        game.content.soundtrack,
                                                        "soundtrack",
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
                                            fileHash={game.content.soundtrack}
                                            sources={soundtrackSources}
                                            explorerUri={$explorer_uri}
                                            source_explorer_url={$source_explorer_url}
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
                                        ? 'bg-green-500 border-green-500 text-white shadow-lg scale-110'
                                        : 'bg-gray-200 border-gray-300 text-gray-400 dark:bg-gray-700 dark:border-gray-600'}"
                                >
                                    {#if game.status === "Finalized"}
                                        <Check class="w-6 h-6" />
                                    {:else}
                                        <span class="text-base font-bold"
                                            >3</span
                                        >
                                    {/if}
                                </div>
                                <span
                                    class="mt-2 text-xs font-bold uppercase tracking-wider {game.status ===
                                    'Finalized'
                                        ? 'text-green-500'
                                        : 'text-gray-500 dark:text-gray-400'}"
                                    >Finalized</span
                                >
                            </div>
                        {/if}
                    </div>

                    {#if !participationIsEnded && targetDate}
                        <div class="countdown-container mb-8">
                            <div class="timeleft">
                                <span class="timeleft-label">
                                    {clockLabel}
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
                                </h3>
                                <p
                                    class="text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {#if game.status === "Active" && openCeremony}
                                        Seed ceremony is open. Collaborate to
                                        ensure a random seed.
                                    {:else if game.status === "Active" && !participationIsEnded}
                                        The competition is live. Solvers can
                                        submit their scores until the deadline.
                                    {:else if game.status === "Active" && participationIsEnded}
                                        Time is up. The creator must now resolve
                                        the competition.
                                    {:else if game.status === "Resolution"}
                                        {@const isBeforeDeadline =
                                            new Date().getTime() < targetDate}
                                        {#if isBeforeDeadline}
                                            Judges are validating the winner.
                                            New candidates can be proposed.
                                        {:else}
                                            Judge period ended. The competition
                                            can be finalized.
                                        {/if}
                                    {:else if game.status === "Finalized"}
                                        The competition has ended and prizes
                                        have been distributed.
                                    {:else}
                                        The competition was cancelled after the
                                        creator’s secret was compromised.
                                    {/if}
                                </p>
                            </div>
                        </div>

                        <!-- Content Grid: Allowed vs Restricted -->

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
                                            > Contribute to the random number generation
                                            process (free) to ensure the competition's
                                            seed is random.
                                        </li>
                                        <li
                                            class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                        >
                                            <span
                                                class="font-medium text-gray-900 dark:text-gray-100"
                                                >Anyone:</span
                                            >
                                            Cancel the competition by revealing the
                                            secret and receive a portion of the creator’s
                                            stake.
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
                                                Contribute to the random number generation
                                                process (free).
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Cancel the competition (if secret
                                                leaked).
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
                                                Join the competition and submit scores.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Cancel the competition (if secret
                                                leaked).
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
                                                Resolve the game by revealing the
                                                secret.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Cancel the competition (if secret
                                                leaked).
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Rescue funds (if stuck after grace
                                                period).
                                            </li>
                                        {/if}
                                    {:else if game.status === "Resolution"}
                                        {@const isBeforeDeadline =
                                            new Date().getTime() < targetDate}
                                        {#if isBeforeDeadline}
                                            <!-- JUDGE PERIOD -->
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Judges:</span
                                                >
                                                Validate, invalidate, or mark the
                                                candidate's service as unavailable.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Anyone:</span
                                                >
                                                Propose a new winner (if higher score).
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
                                                Finalize the competition and distribute
                                                prizes.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                            >
                                                <span
                                                    class="font-medium text-gray-900 dark:text-gray-100"
                                                    >Participants:</span
                                                >
                                                Claim refunds (if grace period passes).
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
                                                    >Resolve Competition:</span
                                                >
                                                Cannot resolve during ceremony.
                                            </li>
                                        {:else if !participationIsEnded}
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Resolve Competition:</span
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
                                            new Date().getTime() < targetDate}
                                        {#if isBeforeDeadline}
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Submit participation:</span
                                                >
                                                Participation period has ended.
                                            </li>
                                            <li
                                                class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                            >
                                                <span class="font-medium"
                                                    >Finalize Competition:</span
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
                                            > The competition is closed.
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
                                            > The competition is permanently invalid.
                                        </li>
                                    {/if}
                                </ul>
                            </div>
                        </div>
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
                        {#if riskLevel === "Low"}
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
                                        This competition uses a decentralized
                                        jury system with {uniqueJudges.length} unique
                                        judges. The creator cannot arbitrarily decide
                                        the winner; a majority of judges must agree.
                                    </p>
                                </div>
                            </div>
                        {:else if riskLevel === "Medium"}
                            <div class="info-block">
                                <div
                                    class="mb-4 p-3 rounded bg-yellow-500/10 border border-yellow-500/20"
                                >
                                    <span
                                        class="text-sm font-bold text-yellow-500"
                                        >Risk Level: Medium (Small Jury)</span
                                    >
                                    <p
                                        class="text-xs text-gray-500 dark:text-gray-400 mt-1"
                                    >
                                        This competition has a small jury of {uniqueJudges.length}
                                        judges. While better than no jury, collusion
                                        is easier than with a large decentralized
                                        jury.
                                    </p>
                                </div>
                            </div>
                        {:else}
                            <div class="info-block">
                                <div
                                    class="mb-4 p-3 rounded bg-red-500/10 border border-red-500/20"
                                >
                                    <span class="text-sm font-bold text-red-500"
                                        >Risk Level: High (Trust Creator)</span
                                    >
                                    <p
                                        class="text-xs text-gray-500 dark:text-gray-400 mt-1"
                                    >
                                        This competition relies entirely on the
                                        creator's honesty (0 judges). If the
                                        creator acts maliciously, there are no
                                        independent judges to intervene.
                                    </p>
                                </div>
                            </div>
                        {/if}

                        {#if uniqueJudges.length > 0}
                            <div class="info-block">
                                <p
                                    class="text {$mode === 'dark'
                                        ? 'text-slate-400'
                                        : 'text-gray-600'} mt-1"
                                >
                                    {#if game.status === "Active"}
                                        Nominated Judges<button
                                            type="button"
                                            class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                            on:click|stopPropagation={() =>
                                                openDidacticModal(
                                                    "Nominated Judges",
                                                    "Nominated arbiters who can invalidate fraudulent participations. Requires majority to invalidate. All nominated judges must accept before resolution, ensuring participants can trust the jury or withdraw.",
                                                )}
                                        >
                                            <Info class="w-3.5 h-3.5" />
                                        </button>
                                        {isNominatedJudge
                                            ? "(You are a nominated judge)"
                                            : ""}
                                    {:else if game.status === "Resolution"}
                                        Judges' Votes<button
                                            type="button"
                                            class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                            on:click|stopPropagation={() =>
                                                openDidacticModal(
                                                    "Judges' Votes",
                                                    "Nominated arbiters who can invalidate fraudulent participations. Requires majority to invalidate.",
                                                )}
                                        >
                                            <Info class="w-3.5 h-3.5" />
                                        </button>
                                    {/if}
                                </p>
                                <div
                                    class="info-value font-mono text-xs break-all mt-2"
                                >
                                    {#each uniqueJudges as judge}
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
                                            {:else if game.status === "Resolution" && participationVotes.get(game.winnerCandidateCommitment) && candidateParticipationUnavailableVotes.includes(judge)}
                                                <span class="text-orange-500">
                                                    (unavailable)</span
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
                                        <br />
                                    {/each}
                                </div>
                                {#if game.status === "Active"}
                                    <p
                                        class="text-sm font-medium text-yellow-600 dark:text-yellow-400 mt-2"
                                    >
                                        Trust requires a majority of {Math.floor(
                                            uniqueJudges.length / 2,
                                        ) + 1} out of {uniqueJudges.length} judges.
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
                                {:else if game.status === "Resolution" || game.status === "EndGame"}
                                    {#if new Date().getTime() < targetDate}
                                        <p class="text-sm font-medium mt-2">
                                            The candidate can be invalidated if
                                            more than {Math.floor(
                                                uniqueJudges.length / 2,
                                            )} out of {uniqueJudges.length} judges
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
                                        opinion verifying this competition.
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

                            <!-- ZONE A: PRIMARY ACTION (HERO) -->
                            {#if primaryAction}
                                <div class="mb-8">
                                    {#if primaryAction === "open_ceremony"}
                                        <Button
                                            on:click={() =>
                                                setupActionModal(
                                                    "open_ceremony",
                                                )}
                                            class="w-full py-6 text-xl font-bold shadow-lg bg-purple-600 hover:bg-purple-700 text-white transition-all hover:scale-[1.01]"
                                        >
                                            <Sparkles class="mr-3 h-6 w-6" /> Add
                                            Seed Randomness
                                        </Button>
                                        <p
                                            class="text-sm text-center mt-2 text-muted-foreground"
                                        >
                                            Add entropy to the competition seed.
                                        </p>
                                    {:else if primaryAction === "submit_score"}
                                        <Button
                                            on:click={() =>
                                                setupActionModal(
                                                    "submit_score",
                                                )}
                                            class="w-full py-6 text-xl font-bold shadow-lg bg-blue-600 hover:bg-blue-700 text-white transition-all hover:scale-[1.01]"
                                        >
                                            <Edit class="mr-3 h-6 w-6" /> Submit
                                            My Score
                                        </Button>
                                        <p
                                            class="text-sm text-center mt-2 text-muted-foreground"
                                        >
                                            Submit your solution and score
                                            before the deadline.
                                        </p>
                                    {:else if primaryAction === "resolve_game"}
                                        <Button
                                            on:click={() =>
                                                setupActionModal(
                                                    "resolve_game",
                                                )}
                                            class="w-full py-6 text-xl font-bold shadow-lg bg-green-600 hover:bg-green-700 text-white transition-all hover:scale-[1.01]"
                                        >
                                            <CheckSquare class="mr-3 h-6 w-6" />
                                            Resolve Competition
                                        </Button>
                                        <p
                                            class="text-sm text-center mt-2 text-muted-foreground"
                                        >
                                            Declare the winner and reveal the
                                            secret.
                                        </p>
                                    {:else if primaryAction === "end_game"}
                                        <Button
                                            on:click={() =>
                                                setupActionModal("end_game")}
                                            class="w-full py-6 text-xl font-bold shadow-lg bg-blue-600 hover:bg-blue-700 text-white transition-all hover:scale-[1.01]"
                                        >
                                            <Trophy class="mr-3 h-6 w-6" /> End Competition
                                            & Distribute Prizes
                                        </Button>
                                        <p
                                            class="text-sm text-center mt-2 text-muted-foreground"
                                        >
                                            Finalize the competition and
                                            distribute rewards.
                                        </p>
                                    {:else if primaryAction === "drain_stake"}
                                        <Button
                                            on:click={() =>
                                                setupActionModal("drain_stake")}
                                            class="w-full py-6 text-xl font-bold shadow-lg bg-orange-600 hover:bg-orange-700 text-white transition-all hover:scale-[1.01]"
                                        >
                                            <Trophy class="mr-3 h-6 w-6" /> Drain
                                            Resolver Stake
                                        </Button>
                                    {/if}
                                </div>
                            {/if}

                            <!-- ZONE B: SECONDARY ACTIONS (GRID) -->
                            {#if secondaryActions.length > 0}
                                <div class="mb-8">
                                    <h3
                                        class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
                                    >
                                        Other Options
                                    </h3>
                                    <div
                                        class="grid grid-cols-1 md:grid-cols-2 gap-3"
                                    >
                                        {#each secondaryActions as action}
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(action.id)}
                                                variant={action.variant ||
                                                    "outline"}
                                                class="w-full justify-start {action.class ||
                                                    ''}"
                                            >
                                                <svelte:component
                                                    this={action.icon}
                                                    class="mr-2 h-4 w-4"
                                                />
                                                {action.label}
                                            </Button>
                                        {/each}

                                        {#if participations.filter((p) => p.status === "Submitted").length + participationBatches.length > PARTICIPATION_BATCH_THRESHOLD && game.status === "Resolution" && !isBeforeDeadline}
                                            <Button
                                                on:click={() =>
                                                    setupActionModal(
                                                        "batch_participations",
                                                    )}
                                                class="w-full justify-start bg-blue-600 hover:bg-blue-700 text-white"
                                            >
                                                <Trophy class="mr-2 h-4 w-4" />
                                                Batch Participations
                                            </Button>
                                        {/if}
                                    </div>
                                </div>
                            {/if}

                            <!-- ZONE C: STATUS & RESTRICTIONS (LIST) -->
                            {#if disabledActions.length > 0}
                                <div class="bg-muted/30 rounded-lg p-4">
                                    <h3
                                        class="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2"
                                    >
                                        <LockIcon class="w-3 h-3" /> Unavailable
                                        Actions
                                    </h3>
                                    <ul class="space-y-3">
                                        {#each disabledActions as action}
                                            <li
                                                class="flex items-center gap-3 text-sm text-muted-foreground opacity-75"
                                            >
                                                <div
                                                    class="p-1.5 rounded-full bg-muted"
                                                >
                                                    <svelte:component
                                                        this={action.icon}
                                                        class="w-3 h-3"
                                                    />
                                                </div>
                                                <div class="flex flex-col">
                                                    <span
                                                        class="font-medium text-foreground/80"
                                                        >{action.label}</span
                                                    >
                                                    <span class="text-xs"
                                                        >{action.reason}</span
                                                    >
                                                </div>
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            {/if}

                            {#if !$connected}
                                <div
                                    class="p-6 text-center bg-muted/30 rounded-lg border border-dashed"
                                >
                                    <p class="text-muted-foreground">
                                        Connect your wallet to interact with the
                                        game competition.
                                    </p>
                                </div>
                            {/if}
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
                                        game.status === "EndGame" ||
                                        game.status === "Finalized") &&
                                    game.winnerCandidateCommitment ===
                                        p.commitmentC_Hex}
                                {@const actualScoreForThisParticipation =
                                    game.status === "Resolution" ||
                                    game.status === "EndGame" ||
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
                                              Number(game.timeWeight),
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
                                                .PARTICIPATION_GRACE_PERIOD}
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
                                {@const isUnavailable =
                                    p.status === "Consumed" &&
                                    p.reason === "unavailable"}
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

                                    {#if isUnavailable}
                                        <div
                                            class="expired-badge absolute top-6 right-16 bg-orange-600 text-white px-2 py-1 rounded-full text-xs font-semibold"
                                        >
                                            UNAVAILABLE
                                        </div>
                                    {/if}

                                    {#if isCancelled}
                                        <div
                                            class="expired-badge absolute top-6 right-16 bg-gray-600 text-white px-2 py-1 rounded-full text-xs font-semibold"
                                        >
                                            CANCELLED
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
                                                                <br />
                                                                <div
                                                                    class="flex items-center gap-1"
                                                                >
                                                                    (Effective
                                                                    Score: {effectiveScore})
                                                                    <div
                                                                        class="group relative inline-block"
                                                                    >
                                                                        <Info
                                                                            class="w-3 h-3 cursor-help text-gray-400"
                                                                        />
                                                                        <div
                                                                            class="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-xl text-left"
                                                                        >
                                                                            <div
                                                                                class="font-semibold mb-2 border-b border-gray-700 pb-1"
                                                                            >
                                                                                Effective
                                                                                Score
                                                                                Calculation
                                                                            </div>
                                                                            <div
                                                                                class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-2"
                                                                            >
                                                                                <span
                                                                                    class="text-gray-400"
                                                                                    >Base
                                                                                    Score:</span
                                                                                >
                                                                                <span
                                                                                    class="font-mono text-right"
                                                                                    >{actualScoreForThisParticipation}</span
                                                                                >

                                                                                <span
                                                                                    class="text-gray-400"
                                                                                    >Time
                                                                                    Factor:</span
                                                                                >
                                                                                <span
                                                                                    class="font-mono text-right"
                                                                                    >{Number(
                                                                                        game.timeWeight,
                                                                                    )}</span
                                                                                >

                                                                                <span
                                                                                    class="text-gray-400"
                                                                                    >Deadline
                                                                                    Block:</span
                                                                                >
                                                                                <span
                                                                                    class="font-mono text-right"
                                                                                    >{game.deadlineBlock}</span
                                                                                >

                                                                                <span
                                                                                    class="text-gray-400"
                                                                                    >Submission
                                                                                    Block:</span
                                                                                >
                                                                                <span
                                                                                    class="font-mono text-right"
                                                                                    >{p.creationHeight}</span
                                                                                >
                                                                            </div>

                                                                            <div
                                                                                class="text-[10px] text-gray-400 italic border-t border-gray-700 pt-1 mt-1"
                                                                            >
                                                                                Formula:
                                                                                Score
                                                                                *
                                                                                (TimeFactor
                                                                                +
                                                                                Deadline
                                                                                -
                                                                                Submission)
                                                                            </div>
                                                                            <!-- Arrow -->
                                                                            <div
                                                                                class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"
                                                                            ></div>
                                                                        </div>
                                                                    </div>
                                                                </div>
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

                                    {#if isUnavailable && isCurrentUserParticipant}
                                        <div
                                            class="info-block sm:col-span-2 lg:col-span-4 mt-4 mx-4 mb-4"
                                        >
                                            <p
                                                class="text-xs {$mode === 'dark'
                                                    ? 'text-red-400'
                                                    : 'text-red-600'}"
                                            >
                                                Your participation was marked as <strong
                                                    >unavailable</strong
                                                > by the majority of judges. This
                                                indicates that there were issues
                                                obtaining your robot service from
                                                the source you provided, preventing
                                                judges from validating your participation.
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
                            forum_explorer_url={$forum_explorer_url}
                            showTopicInput={false}
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
                        : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-4xl transform transition-all flex flex-col max-h-[90vh]"
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

                    <div class="modal-form-body overflow-y-auto flex-1 min-h-0">
                        {#if currentActionType === "submit_score"}
                            {#if showParticipantGuide}
                                <div
                                    class="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Participate in the Challenge
                                        </h3>
                                        <p class="text-muted-foreground">
                                            Follow these steps to create your
                                            bot and submit your solution.
                                        </p>
                                    </div>

                                    <div
                                        class="grid grid-cols-1 md:grid-cols-2 gap-6"
                                    >
                                        <!-- Step 1: Check Judges -->
                                        <div
                                            class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm"
                                        >
                                            <div
                                                class="flex items-center gap-3 mb-3"
                                            >
                                                <div
                                                    class="p-2 bg-blue-500/10 rounded-lg text-blue-500"
                                                >
                                                    <ShieldCheck
                                                        class="w-6 h-6"
                                                    />
                                                </div>
                                                <h4
                                                    class="font-semibold text-lg"
                                                >
                                                    1. Check Judges
                                                </h4>
                                            </div>
                                            <p
                                                class="text-sm text-muted-foreground mb-4"
                                            >
                                                Verify the reputation of the
                                                judges to ensure fair play.
                                            </p>
                                            <div
                                                class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                            >
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() =>
                                                        navigator.clipboard.writeText(
                                                            `nodo gop_judges_check ${game?.boxId}`,
                                                        )}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary"
                                                    >nodo</span
                                                >
                                                gop_judges_check {game?.boxId.slice(
                                                    0,
                                                    10,
                                                )}...
                                            </div>
                                        </div>

                                        <!-- Step 2: Create Bot -->
                                        <div
                                            class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm"
                                        >
                                            <div
                                                class="flex items-center gap-3 mb-3"
                                            >
                                                <div
                                                    class="p-2 bg-purple-500/10 rounded-lg text-purple-500"
                                                >
                                                    <Terminal class="w-6 h-6" />
                                                </div>
                                                <h4
                                                    class="font-semibold text-lg"
                                                >
                                                    2. Create Bot
                                                </h4>
                                            </div>
                                            <p
                                                class="text-sm text-muted-foreground mb-4"
                                            >
                                                Use the CLI to generate your bot
                                                template and integrate with
                                                LLMs.
                                            </p>
                                            <div
                                                class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                            >
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() =>
                                                        navigator.clipboard.writeText(
                                                            `nodo gop_create_bot ${game?.boxId}`,
                                                        )}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary"
                                                    >nodo</span
                                                >
                                                gop_create_bot {game?.boxId.slice(
                                                    0,
                                                    10,
                                                )}...
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        class="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 text-sm text-yellow-600 dark:text-yellow-400"
                                    >
                                        <p class="font-semibold mb-2">
                                            Important:
                                        </p>
                                        <ul
                                            class="list-disc list-inside space-y-1.5 opacity-90"
                                        >
                                            <li>
                                                You must publish your bot hash <b
                                                    >before</b
                                                >
                                                the deadline. Publishing the hash
                                                is <b>free</b> - no participation
                                                fee required yet.
                                            </li>
                                            <li>
                                                After the ceremony reveals the
                                                seed, you need to submit your
                                                bot's participation with that
                                                seed to the Ergo blockchain. <b
                                                    >The participation fee is
                                                    only charged at this step.</b
                                                >
                                            </li>
                                            <li>
                                                You can set up a scheduled task
                                                to automatically generate and
                                                submit the participation, or
                                                monitor the <a
                                                    href="https://t.me/gameofprompts"
                                                    target="_blank"
                                                    class="underline font-semibold hover:text-yellow-500"
                                                    >Game of Prompts Telegram
                                                    channel</a
                                                > where a bot notifies these events.
                                            </li>
                                        </ul>
                                    </div>

                                    <div class="flex justify-center pt-4">
                                        <Button
                                            size="lg"
                                            class="gap-2"
                                            on:click={() => {
                                                showParticipantGuide = false;
                                                showSolverIdStep = true;
                                            }}
                                        >
                                            I have my Bot implemented
                                        </Button>
                                    </div>
                                </div>
                            {:else if showSolverIdStep}
                                <div
                                    class="space-y-6 max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Publish Solver ID
                                        </h3>
                                        <p class="text-muted-foreground">
                                            You need a unique Solver ID
                                            published on-chain to participate.
                                        </p>
                                    </div>

                                    <div class="space-y-4">
                                        <div class="space-y-2">
                                            <Label for="solver_id_step"
                                                >Solver ID (Hex)</Label
                                            >
                                            <div class="flex gap-2">
                                                <Input
                                                    id="solver_id_step"
                                                    bind:value={solverId_input}
                                                    placeholder="e.g., a1b2..."
                                                    class="font-mono"
                                                />
                                                <Button
                                                    variant="outline"
                                                    on:click={() => {
                                                        const randomBytes =
                                                            new Uint8Array(32);
                                                        window.crypto.getRandomValues(
                                                            randomBytes,
                                                        );
                                                        solverId_input =
                                                            uint8ArrayToHex(
                                                                randomBytes,
                                                            );
                                                    }}
                                                    title="Generate Random"
                                                >
                                                    <Wand2 class="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <p
                                                class="text-xs text-muted-foreground"
                                            >
                                                This ID identifies your bot. It
                                                must be unique and published
                                                before the deadline.
                                            </p>
                                        </div>

                                        {#if solverId_check_error}
                                            <div
                                                class="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm"
                                            >
                                                {solverId_check_error}
                                            </div>
                                        {/if}

                                        {#if transactionId}
                                            <div
                                                class="p-3 rounded-lg bg-green-500/10 text-green-500 text-sm break-all"
                                            >
                                                <strong
                                                    >Transaction Submitted:</strong
                                                ><br />
                                                <a
                                                    href={$web_explorer_uri_tx +
                                                        transactionId}
                                                    target="_blank"
                                                    class="underline"
                                                    >{transactionId}</a
                                                >
                                                <p
                                                    class="mt-1 text-xs text-green-600 dark:text-green-400"
                                                >
                                                    Please wait for the
                                                    transaction to be confirmed
                                                    before continuing.
                                                </p>
                                            </div>
                                        {/if}

                                        {#if solverId_box_found}
                                            <div
                                                class="p-3 rounded-lg bg-green-500/10 text-green-500 text-sm flex items-center gap-2"
                                            >
                                                <CheckCircle class="h-4 w-4" />
                                                Solver ID Box Found!
                                            </div>
                                        {/if}

                                        <div class="flex gap-3 pt-4">
                                            <Button
                                                variant="outline"
                                                class="flex-1"
                                                on:click={checkSolverIdBox}
                                                disabled={solverId_check_loading}
                                            >
                                                {#if solverId_check_loading}
                                                    Checking...
                                                {:else}
                                                    Check Existing
                                                {/if}
                                            </Button>
                                            <Button
                                                class="flex-1"
                                                on:click={handlePublishSolverId}
                                                disabled={isSubmitting ||
                                                    solverId_box_found}
                                            >
                                                {#if isSubmitting}
                                                    Publishing...
                                                {:else}
                                                    Publish New
                                                {/if}
                                            </Button>
                                        </div>
                                    </div>

                                    <div
                                        class="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700"
                                    >
                                        <Button
                                            variant="ghost"
                                            on:click={() => {
                                                showSolverIdStep = false;
                                                showParticipantGuide = true;
                                            }}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            on:click={() => {
                                                if (solverId_box_found) {
                                                    showSolverIdStep = false;
                                                } else {
                                                    checkSolverIdBox().then(
                                                        () => {
                                                            if (
                                                                solverId_box_found
                                                            ) {
                                                                showSolverIdStep = false;
                                                            }
                                                        },
                                                    );
                                                }
                                            }}
                                            disabled={!solverId_box_found &&
                                                !transactionId}
                                        >
                                            Continue <ArrowRight
                                                class="ml-2 h-4 w-4"
                                            />
                                        </Button>
                                    </div>
                                </div>
                            {:else}
                                <div class="space-y-6 max-w-3xl mx-auto">
                                    <!-- Back to Guide Button -->
                                    <div class="flex justify-start">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            on:click={() =>
                                                (showParticipantGuide = true)}
                                            class="gap-2"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                ><path
                                                    d="m15 18-6-6 6-6"
                                                /></svg
                                            >
                                            Back to Participant Guide
                                        </Button>
                                    </div>

                                    <!-- Ceremony Phase Warning -->
                                    {#if openCeremony}
                                        <div
                                            class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4"
                                        >
                                            <div class="flex items-start gap-3">
                                                <AlertTriangle
                                                    class="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5"
                                                />
                                                <div class="flex-1">
                                                    <h4
                                                        class="font-semibold text-sm text-yellow-700 dark:text-yellow-400 mb-1"
                                                    >
                                                        Ceremony Phase Active
                                                    </h4>
                                                    <p
                                                        class="text-xs text-yellow-600 dark:text-yellow-500"
                                                    >
                                                        You cannot submit your
                                                        score yet because the
                                                        ceremony phase is still
                                                        ongoing. The final seed
                                                        has not been determined.
                                                        Please wait until the
                                                        ceremony phase ends to
                                                        submit your
                                                        participation.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    {/if}

                                    <!-- JSON Upload -->
                                    <div>
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
                                                ? 'bg-slate-800/50 border-slate-700 text-slate-300 placeholder-slate-400'
                                                : 'bg-white border-gray-200 text-gray-700 placeholder-gray-400'} file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-medium {$mode ===
                                            'dark'
                                                ? 'file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 file:rounded-l-sm'
                                                : 'file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 file:rounded-l-sm'} cursor-pointer focus-visible:outline-none focus-visible:ring-2 {$mode ===
                                            'dark'
                                                ? 'focus-visible:ring-slate-500'
                                                : 'focus-visible:ring-slate-400'} focus-visible:ring-offset-2 {$mode ===
                                            'dark'
                                                ? 'focus-visible:ring-offset-slate-900'
                                                : 'focus-visible:ring-offset-white'}"
                                        />
                                        <p
                                            class="text-xs text-muted-foreground mt-1.5"
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

                                    <!-- "Or Fill Manually" Divider -->
                                    <div class="flex items-center my-2">
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

                                    <!-- Main Form -->
                                    <div class="space-y-5">
                                        <!-- Commitment Code -->
                                        <div>
                                            <Label
                                                for="commitmentC"
                                                class="block text-sm font-medium mb-1.5 {$mode ===
                                                'dark'
                                                    ? 'text-gray-200'
                                                    : 'text-gray-700'}"
                                            >
                                                Commitment Code
                                                <span
                                                    class="text-xs font-normal text-muted-foreground ml-1"
                                                    >(from game service)</span
                                                >
                                            </Label>
                                            <Textarea
                                                id="commitmentC"
                                                bind:value={commitmentC_input}
                                                rows={3}
                                                placeholder="Enter the hexadecimal commitment code..."
                                                class="w-full font-mono text-sm {$mode ===
                                                'dark'
                                                    ? 'bg-slate-800/50 border-slate-700 focus:border-primary/50'
                                                    : 'bg-white border-gray-200 focus:border-primary/50'}"
                                            />
                                        </div>

                                        <!-- Solver ID -->
                                        <div>
                                            <Label
                                                for="solverId"
                                                class="block text-sm font-medium mb-1.5 {$mode ===
                                                'dark'
                                                    ? 'text-gray-200'
                                                    : 'text-gray-700'}"
                                                >Solver ID / Name</Label
                                            >
                                            <Input
                                                id="solverId"
                                                type="text"
                                                bind:value={solverId_input}
                                                placeholder="e.g., my_solver.celaut.bee"
                                                class="w-full {$mode === 'dark'
                                                    ? 'bg-slate-800/50 border-slate-700'
                                                    : 'bg-white border-gray-200'}"
                                            />
                                        </div>

                                        <!-- Hash Logs -->
                                        <div>
                                            <Label
                                                for="hashLogs"
                                                class="block text-sm font-medium mb-1.5 {$mode ===
                                                'dark'
                                                    ? 'text-gray-200'
                                                    : 'text-gray-700'}"
                                                >Hash of Logs (Hex)</Label
                                            >
                                            <Input
                                                id="hashLogs"
                                                type="text"
                                                bind:value={hashLogs_input}
                                                placeholder="Blake2b-256 hash..."
                                                class="w-full font-mono text-sm {$mode ===
                                                'dark'
                                                    ? 'bg-slate-800/50 border-slate-700'
                                                    : 'bg-white border-gray-200'}"
                                            />
                                        </div>

                                        <!-- Scores -->
                                        <div>
                                            <Label
                                                for="user_score"
                                                class="block text-sm font-medium mb-1.5 {$mode ===
                                                'dark'
                                                    ? 'text-gray-200'
                                                    : 'text-gray-700'}"
                                            >
                                                Your Score
                                            </Label>

                                            <Input
                                                id="user_score"
                                                type="number"
                                                bind:value={user_score}
                                                placeholder="e.g., 85"
                                                class="w-full {$mode === 'dark'
                                                    ? 'bg-slate-800/50 border-slate-700'
                                                    : 'bg-white border-gray-200'}"
                                            />

                                            <p
                                                class="text-xs text-muted-foreground mt-1.5"
                                            >
                                                Enter your result. Will be mixed
                                                with random data to preserve
                                                your score private on-chain.
                                            </p>

                                            {#if scores_list.length > 0}
                                                <p
                                                    class="text-xs text-blue-500 mt-2"
                                                >
                                                    Public data (Anonymized): {scores_list.join(
                                                        ", ",
                                                    )}
                                                </p>
                                            {/if}
                                        </div>

                                        <!-- Fee & Action -->
                                        <div
                                            class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4"
                                        >
                                            <p
                                                class="text-sm text-muted-foreground"
                                            >
                                                Fee: <span
                                                    class="font-medium text-foreground"
                                                    >{formatTokenBigInt(
                                                        game.participationFeeAmount,
                                                        tokenDecimals,
                                                    )}
                                                    {tokenSymbol}</span
                                                >
                                            </p>
                                            <Button
                                                on:click={handleSubmitScore}
                                                disabled={isSubmitting ||
                                                    !commitmentC_input.trim() ||
                                                    !solverId_input.trim() ||
                                                    !hashLogs_input.trim() ||
                                                    scores_list.length === 0 ||
                                                    openCeremony}
                                                class="w-full sm:w-auto min-w-[200px]"
                                                variant="default"
                                            >
                                                {isSubmitting
                                                    ? "Processing..."
                                                    : "Confirm & Submit Score"}
                                            </Button>
                                        </div>
                                    </div>

                                    <!-- Dev Mode (Collapsible) -->
                                    {#if $isDevMode}
                                        <div
                                            class="pt-6 border-t border-border/50"
                                        >
                                            <button
                                                type="button"
                                                on:click={() =>
                                                    (isDevModeExpanded =
                                                        !isDevModeExpanded)}
                                                class="flex items-center gap-2 text-xs font-medium text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400 transition-colors"
                                            >
                                                <Wand2 class="w-3.5 h-3.5" />
                                                <span>Dev Mode Tools</span>
                                                <ChevronDown
                                                    class="w-3 h-3 transition-transform {isDevModeExpanded
                                                        ? 'rotate-180'
                                                        : ''}"
                                                />
                                            </button>

                                            {#if isDevModeExpanded}
                                                <div
                                                    class="mt-3 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20 space-y-4"
                                                >
                                                    <div
                                                        class="flex items-start gap-3"
                                                    >
                                                        <Info
                                                            class="w-4 h-4 text-yellow-600/70 mt-0.5 shrink-0"
                                                        />
                                                        <p
                                                            class="text-xs text-yellow-600/80 dark:text-yellow-500/80"
                                                        >
                                                            Generates a valid
                                                            participation using
                                                            the competition's
                                                            service ID as the
                                                            secret. Only works
                                                            if you created the
                                                            competition with
                                                            that secret.
                                                        </p>
                                                    </div>

                                                    <div
                                                        class="grid grid-cols-1 sm:grid-cols-2 gap-4"
                                                    >
                                                        <div>
                                                            <Label
                                                                class="text-xs text-yellow-600/90 mb-1.5 block"
                                                                >Score to
                                                                Generate</Label
                                                            >
                                                            <Input
                                                                type="number"
                                                                bind:value={
                                                                    devGenScore
                                                                }
                                                                class="h-8 text-xs bg-transparent border-yellow-500/30 focus:border-yellow-500/50"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label
                                                                class="text-xs text-yellow-600/90 mb-1.5 block"
                                                                >Simulate Error</Label
                                                            >
                                                            <select
                                                                bind:value={
                                                                    devGenErrorType
                                                                }
                                                                class="w-full h-8 text-xs rounded-md bg-transparent border border-yellow-500/30 focus:border-yellow-500/50 text-foreground px-2"
                                                            >
                                                                <option
                                                                    value="none"
                                                                    >None
                                                                    (Valid)</option
                                                                >
                                                                <option
                                                                    value="wrong_commitment"
                                                                    >Invalid
                                                                    Commitment</option
                                                                >
                                                                <option
                                                                    value="wrong_score"
                                                                    >Score
                                                                    Mismatch</option
                                                                >
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        class="w-full border-yellow-500/30 hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-500"
                                                        on:click={generateDevParticipation}
                                                    >
                                                        Auto-Fill Form
                                                    </Button>
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-slate-600 hover:bg-slate-700 text-white'
                                        : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-red-600 hover:bg-red-700 text-white'
                                        : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                        : 'bg-orange-500 hover:bg-orange-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="disabled:opacity-50 disabled:cursor-not-allowed"
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
                                {#if !game.isEndGame && !USE_CHAINED_TRANSACTIONS}
                                    <p
                                        class="text-sm p-3 rounded-md {$mode ===
                                        'dark'
                                            ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30'
                                            : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"
                                    >
                                        ⚠️ Due to a known issue
                                        (github.com/game-of-prompts/app/issues/2),
                                        the game will transition to an
                                        intermediate state. You will need to
                                        execute this action again to finalize
                                        the game definitively.
                                    </p>
                                {/if}
                                <Button
                                    on:click={handleEndGame}
                                    disabled={isSubmitting}
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm & End Game"}
                                </Button>
                            </div>
                        {:else if currentActionType === "invalidate_winner"}
                            {#if showJudgeGuide}
                                <div
                                    class="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Validate the Winning Participation
                                        </h3>
                                        <p class="text-muted-foreground">
                                            As a judge, validate the candidate
                                            before voting.
                                        </p>
                                    </div>

                                    <div class="grid grid-cols-1 gap-6">
                                        <!-- Validation Step -->
                                        <div
                                            class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm"
                                        >
                                            <div
                                                class="flex items-center gap-3 mb-3"
                                            >
                                                <div
                                                    class="p-2 bg-blue-500/10 rounded-lg text-blue-500"
                                                >
                                                    <ShieldCheck
                                                        class="w-6 h-6"
                                                    />
                                                </div>
                                                <h4
                                                    class="font-semibold text-lg"
                                                >
                                                    Validate Participation
                                                </h4>
                                            </div>
                                            <p
                                                class="text-sm text-muted-foreground mb-4"
                                            >
                                                Use the CLI to validate the
                                                participation and verify its
                                                correctness.
                                            </p>
                                            <div
                                                class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                            >
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() =>
                                                        navigator.clipboard.writeText(
                                                            `nodo gop_validate_participation ${game?.winnerCandidateCommitment || ""}`,
                                                        )}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary"
                                                    >nodo</span
                                                >
                                                gop_validate_participation {(
                                                    game?.winnerCandidateCommitment ||
                                                    ""
                                                ).slice(0, 20)}...
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm text-blue-600 dark:text-blue-400"
                                    >
                                        <p class="font-semibold mb-2">
                                            Your Role as Judge:
                                        </p>
                                        <ul
                                            class="list-disc list-inside space-y-1.5 opacity-90"
                                        >
                                            <li>
                                                Validate the participation to
                                                ensure it can be reproduced
                                                correctly.
                                            </li>
                                            <li>
                                                If the participation is invalid
                                                (cannot be reproduced or is
                                                malicious), vote to <b
                                                    >invalidate</b
                                                >.
                                            </li>
                                            <li>
                                                If the participation source is
                                                unavailable, vote to <b
                                                    >mark as unavailable</b
                                                >.
                                            </li>
                                            <li>
                                                A majority of judges is required
                                                for any action to take effect.
                                            </li>
                                        </ul>
                                    </div>

                                    <div class="flex justify-center pt-4">
                                        <Button
                                            size="lg"
                                            class="gap-2 bg-yellow-600 hover:bg-yellow-700"
                                            on:click={() =>
                                                (showJudgeGuide = false)}
                                        >
                                            Continue to Vote
                                            <ArrowRight class="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            {:else}
                                <div class="space-y-4">
                                    <!-- Back to Guide Button -->
                                    <div class="flex justify-start">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            on:click={() =>
                                                (showJudgeGuide = true)}
                                            class="gap-2"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                ><path
                                                    d="m15 18-6-6 6-6"
                                                /></svg
                                            >
                                            Back to Judge Guide
                                        </Button>
                                    </div>

                                    <p
                                        class="text-sm p-3 rounded-md {$mode ===
                                        'dark'
                                            ? 'bg-yellow-600/20 text-yellow-300 border border-yellow-500/30'
                                            : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}"
                                    >
                                        <strong
                                            >Action: Judge Invalidation</strong
                                        ><br />
                                        As a judge, you are voting to invalidate
                                        the current winner candidate. This requires
                                        a majority of judges to perform the same
                                        action. If successful, the resolution deadline
                                        will be extended.
                                    </p>
                                    <Button
                                        on:click={handleJudgesInvalidate}
                                        disabled={isSubmitting}
                                        class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                        'dark'
                                            ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                                            : 'bg-yellow-500 hover:bg-yellow-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting
                                            ? "Processing..."
                                            : "Confirm Invalidation Vote"}
                                    </Button>
                                </div>
                            {/if}
                        {:else if currentActionType === "judge_unavailable"}
                            {#if showJudgeGuide}
                                <div
                                    class="space-y-6 max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Validate the Winning Participation
                                        </h3>
                                        <p class="text-muted-foreground">
                                            As a judge, validate the candidate
                                            before voting.
                                        </p>
                                    </div>

                                    <div class="grid grid-cols-1 gap-6">
                                        <!-- Validation Step -->
                                        <div
                                            class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm"
                                        >
                                            <div
                                                class="flex items-center gap-3 mb-3"
                                            >
                                                <div
                                                    class="p-2 bg-blue-500/10 rounded-lg text-blue-500"
                                                >
                                                    <ShieldCheck
                                                        class="w-6 h-6"
                                                    />
                                                </div>
                                                <h4
                                                    class="font-semibold text-lg"
                                                >
                                                    Validate Participation
                                                </h4>
                                            </div>
                                            <p
                                                class="text-sm text-muted-foreground mb-4"
                                            >
                                                Use the CLI to validate the
                                                participation and verify its
                                                correctness.
                                            </p>
                                            <div
                                                class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                            >
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() =>
                                                        navigator.clipboard.writeText(
                                                            `nodo gop_validate_participation ${game?.winnerCandidateCommitment || ""}`,
                                                        )}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary"
                                                    >nodo</span
                                                >
                                                gop_validate_participation {(
                                                    game?.winnerCandidateCommitment ||
                                                    ""
                                                ).slice(0, 20)}...
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm text-blue-600 dark:text-blue-400"
                                    >
                                        <p class="font-semibold mb-2">
                                            Your Role as Judge:
                                        </p>
                                        <ul
                                            class="list-disc list-inside space-y-1.5 opacity-90"
                                        >
                                            <li>
                                                Validate the participation to
                                                ensure it can be reproduced
                                                correctly.
                                            </li>
                                            <li>
                                                If the participation is invalid
                                                (cannot be reproduced or is
                                                malicious), vote to <b
                                                    >invalidate</b
                                                >.
                                            </li>
                                            <li>
                                                If the participation source is
                                                unavailable, vote to <b
                                                    >mark as unavailable</b
                                                >.
                                            </li>
                                            <li>
                                                A majority of judges is required
                                                for any action to take effect.
                                            </li>
                                        </ul>
                                    </div>

                                    <div class="flex justify-center pt-4">
                                        <Button
                                            size="lg"
                                            class="gap-2 bg-orange-600 hover:bg-orange-700"
                                            on:click={() =>
                                                (showJudgeGuide = false)}
                                        >
                                            Continue to Vote
                                            <ArrowRight class="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            {:else}
                                <div class="space-y-4">
                                    <!-- Back to Guide Button -->
                                    <div class="flex justify-start">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            on:click={() =>
                                                (showJudgeGuide = true)}
                                            class="gap-2"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                ><path
                                                    d="m15 18-6-6 6-6"
                                                /></svg
                                            >
                                            Back to Judge Guide
                                        </Button>
                                    </div>

                                    <p
                                        class="text-sm p-3 rounded-md {$mode ===
                                        'dark'
                                            ? 'bg-orange-600/20 text-orange-300 border border-orange-500/30'
                                            : 'bg-orange-100 text-orange-700 border border-orange-200'}"
                                    >
                                        <strong
                                            >Action: Judge Mark Unavailable</strong
                                        ><br />
                                        As a judge, you are voting to mark the current
                                        winner candidate as unavailable. This requires
                                        a majority of judges to perform the same
                                        action. Unlike invalidation, this does not
                                        penalize the creator.
                                    </p>
                                    <Button
                                        on:click={handleJudgesInvalidateUnavailable}
                                        disabled={isSubmitting}
                                        class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                        'dark'
                                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                            : 'bg-orange-500 hover:bg-orange-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isSubmitting
                                            ? "Processing..."
                                            : "Confirm Unavailable Vote"}
                                    </Button>
                                </div>
                            {/if}
                        {:else if currentActionType === "remove_opinion"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-red-600/20 text-red-300 border border-red-500/30'
                                        : 'bg-red-100 text-red-700 border border-red-200'}"
                                >
                                    <strong>Action: Remove My Opinion</strong
                                    ><br />
                                    You are removing your previous opinion on this
                                    participation. This will merge the opinion box
                                    back into your main reputation box, effectively
                                    deleting your vote.
                                </p>
                                <Button
                                    on:click={handleRemoveOpinion}
                                    disabled={isSubmitting}
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-red-600 hover:bg-red-700 text-white'
                                        : 'bg-red-500 hover:bg-red-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Remove Opinion"}
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-gray-600 hover:bg-gray-700 text-white'
                                        : 'bg-gray-500 hover:bg-gray-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-green-600 hover:bg-green-700 text-white'
                                        : 'bg-green-500 hover:bg-green-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
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
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                                        : 'bg-purple-500 hover:bg-purple-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm & Open Ceremony"}
                                </Button>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        {/if}

        <!-- Toast Notifications (outside modal) -->
        {#if transactionId && !isSubmitting}
            <div
                class="fixed top-4 right-4 z-[110] max-w-md animate-in slide-in-from-top-2 fade-in duration-300"
            >
                <div
                    class="p-4 rounded-lg shadow-2xl border {$mode === 'dark'
                        ? 'bg-green-600/90 text-green-100 border-green-500/50 backdrop-blur-sm'
                        : 'bg-green-50 text-green-800 border-green-200'}"
                >
                    <div class="flex items-start gap-3">
                        <CheckCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div class="flex-1 min-w-0">
                            <p class="font-semibold text-sm mb-1">
                                Transaction Submitted!
                            </p>
                            <a
                                href={$web_explorer_uri_tx + transactionId}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-xs underline break-all hover:opacity-80 block"
                                >{transactionId}</a
                            >
                            <p class="text-xs mt-2 opacity-90">
                                Data will update after block confirmation.
                            </p>
                        </div>
                        <button
                            on:click={() => (transactionId = null)}
                            class="flex-shrink-0 hover:opacity-70 transition-opacity"
                            aria-label="Close notification"
                        >
                            <X class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        {/if}
        {#if errorMessage && !isSubmitting}
            <div
                class="fixed top-4 right-4 z-[110] max-w-md animate-in slide-in-from-top-2 fade-in duration-300"
            >
                <div
                    class="p-4 rounded-lg shadow-2xl border {$mode === 'dark'
                        ? 'bg-red-600/90 text-red-100 border-red-500/50 backdrop-blur-sm'
                        : 'bg-red-50 text-red-800 border-red-200'}"
                >
                    <div class="flex items-start gap-3">
                        <AlertTriangle class="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div class="flex-1 min-w-0">
                            <p class="font-semibold text-sm mb-1">Error</p>
                            <p class="text-xs break-words">{errorMessage}</p>
                        </div>
                        <button
                            on:click={() => (errorMessage = null)}
                            class="flex-shrink-0 hover:opacity-70 transition-opacity"
                            aria-label="Close notification"
                        >
                            <X class="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        {/if}
        {#if warningMessage && !isSubmitting}
            <div
                class="fixed top-4 right-4 z-[110] max-w-md animate-in slide-in-from-top-2 fade-in duration-300"
            >
                <div
                    class="p-4 rounded-lg shadow-2xl border {$mode === 'dark'
                        ? 'bg-yellow-600/90 text-yellow-100 border-yellow-500/50 backdrop-blur-sm'
                        : 'bg-yellow-50 text-yellow-800 border-yellow-200'}"
                >
                    <div class="flex items-start gap-3">
                        <Info class="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div class="flex-1 min-w-0">
                            <p class="font-semibold text-sm mb-1">Warning</p>
                            <p class="text-xs break-words">{warningMessage}</p>
                        </div>
                        <button
                            on:click={() => (warningMessage = null)}
                            class="flex-shrink-0 hover:opacity-70 transition-opacity"
                            aria-label="Close notification"
                        >
                            <X class="w-4 h-4" />
                        </button>
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

<!-- Didactic Information Modal -->
{#if showDidacticModal}
    <div
        class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[110] p-4 backdrop-blur-sm"
        on:click|self={closeDidacticModal}
        role="presentation"
    >
        <div
            class="modal-content {$mode === 'dark'
                ? 'bg-slate-800 text-gray-200 border border-slate-700'
                : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg transform transition-all"
            role="dialog"
            aria-modal="true"
            aria-labelledby="didactic-modal-title"
        >
            <div class="flex justify-between items-center mb-6">
                <h3
                    id="didactic-modal-title"
                    class="text-2xl font-semibold {$mode === 'dark'
                        ? 'text-slate-400'
                        : 'text-slate-600'}"
                >
                    {didacticModalTitle}
                </h3>
                <Button
                    variant="ghost"
                    size="icon"
                    on:click={closeDidacticModal}
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
                        ><line x1="18" y1="6" x2="6" y2="18"></line><line
                            x1="6"
                            y1="6"
                            x2="18"
                            y2="18"
                        ></line></svg
                    >
                </Button>
            </div>

            <div class="modal-form-body">
                <p class="text-lg leading-relaxed">
                    {didacticModalText}
                </p>
            </div>
        </div>
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
                source_explorer_url={$source_explorer_url}
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
        @apply text-foreground;
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
        @apply bg-slate-100 dark:bg-white/10;
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
        @apply text-muted-foreground;
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
