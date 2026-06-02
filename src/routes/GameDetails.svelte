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
        getPrizePool,
        isGameEnded,
        resolve_participation_commitment,
        calculateEffectiveScore,
        isDevFriendly,
    } from "$lib/common/game";
    import { sha256 } from "$lib/common/utils";
    import {
        GameContractPhase,
        GAME_PHASE_DEFINITIONS,
        type GamePhaseSnapshot,
        type GameUiSubphaseValue,
        deriveGamePhaseSnapshot,
        getSubphaseSequence,
    } from "$lib/common/game-phase";
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
        current_height,
    } from "$lib/common/store";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { onDestroy, onMount, tick } from "svelte";
    import { get, writable } from "svelte/store";
    import {
        fetchParticipations,
        fetch_token_details,
        fetchParticipationBatches,
        fetchSolverIdBox,
        fetchGameHistory,
    } from "$lib/ergo/fetch";
    import { remove_opinion } from "reputation-system";
    // UI COMPONENTS
    import { Button, buttonVariants } from "$lib/components/ui/button";
    import BodyScrollLock from "$lib/components/BodyScrollLock.svelte";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label/index.js";
    import {
        Select,
        SelectContent,
        SelectItem,
        SelectTrigger,
        SelectValue,
    } from "$lib/components/ui/select";
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
        Code,
        Heart,
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
        Loader2,
        Clock3,
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
        fetchServiceDownloadUrl,
    } from "$lib/ergo/utils";
    import { mode } from "mode-watcher";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { isDevMode } from "$lib/ergo/envs";

    // SOURCE APPLICATION IMPORTS
    import { FileCard, FileSourceCreation, HASH_ALGORITHM_IDS } from "source-application";
    import { fetchFileSourcesByHash } from "source-application";

    import {
        getDisplayStake,
        getParticipationFee,
        formatTokenBigInt,
        prependHexPrefix,
    } from "$lib/utils";
    import {
        formatUserFacingError,
        type FormatOptions,
    } from "$lib/utils/error-messages";
    import {
        fetchJudges,
        fetchReputationProofByTokenId,
    } from "$lib/ergo/reputation/fetch";
    import { type RPBox, type ReputationProof } from "reputation-system";
    import { Forum } from "forum-application";
    import ShareModal from "./ShareModal.svelte";
    import SolverSourceModal from "./SolverSourceModal.svelte";
    import GameTimeline from "$lib/components/GameTimeline.svelte";
    import AI_ASSISTANT from "$lib/components/AI_ASSISTANT.svelte";
    import { hoverCorners } from "$lib/hoverCorners";

    const strictMode = true;

    const PARTICIPATION_BATCH_THRESHOLD = 2;
    const NODO_INSTALLATION = "https://github.com/celaut-project/nodo?tab=readme-ov-file#installation";
    const JUDGE_CHECK_SERVICE = "N/A";
    const ROBOT_DEVELOPMENT_GUIDE = "https://raw.githubusercontent.com/game-of-prompts/.github/refs/heads/main/ROBOT_DEVELOPMENT_GUIDE.md";

    type HoverHandle = { destroy: () => void };
    type ErgoWalletApi = {
        get_change_address?: () => Promise<string>;
        get_balance?: (tokenId?: string) => Promise<bigint | number | string>;
    };

    function getErgoWallet(): ErgoWalletApi | null {
        return (globalThis as typeof globalThis & { ergo?: ErgoWalletApi }).ergo ?? null;
    }

    function hoverCornersWhenClosed(node: HTMLElement, isOpen: boolean) {
        let handle: HoverHandle | null = null;

        const applyState = (open: boolean) => {
            if (open) {
                if (handle) {
                    handle.destroy();
                    handle = null;
                }
                return;
            }
            if (typeof window !== "undefined") {
                const isTouch =
                    "ontouchstart" in window ||
                    navigator.maxTouchPoints > 0;
                if (
                    isTouch ||
                    window.matchMedia("(max-width:768px)").matches
                ) {
                    return;
                }
            }
            if (!handle) {
                handle = hoverCorners(node, { keepDot: true });
            }
        };

        applyState(isOpen);

        return {
            update(open: boolean) {
                applyState(open);
            },
            destroy() {
                if (handle) {
                    handle.destroy();
                    handle = null;
                }
            },
        };
    }

    // --- COMPONENT STATE ---
    let game: AnyGame | null = null;
    let isLoaded = false;
    let hasHydrated = false;
    let primaryAction: string | null = null;
    let technicalDetailsOpen = false;
    let imageSourcesOpen = false;
    let serviceSourcesOpen = false;
    let paperSourcesOpen = false;
    let soundtrackSourcesOpen = false;
    let showProgressDetails = false;

    $: isBeforeDeadline = targetDate
        ? new Date().getTime() < targetDate
        : false;
    $: showLoadingScreen = !hasHydrated || (game ? !isLoaded : false);
    $: primaryAction = getPrimaryAction(
        game,
        openCeremony,
        participationIsEnded,
        resolutionAllowed,
        isNominatedJudge,
        isJudge,
        isBeforeDeadline,
        currentHeight,
    );

    function getPrimaryAction(
        game: AnyGame | null,
        openCeremony: boolean,
        participationIsEnded: boolean,
        resolutionAllowed: boolean,
        isNominatedJudge: boolean,
        isJudge: boolean,
        isBeforeDeadline: boolean,
        currentHeight: number,
    ): string | null {
        if (!game) return null;

        if (game.status === "Active") {
            if (!participationIsEnded) return "submit_score";
            if (resolutionAllowed) return "resolve_game";
        }

        if (game.status === "Resolution") {
            if (currentHeight >= game.resolutionDeadline) return "end_game";
            return null; // No primary action during judge period (only secondary/destructive)
        }

        if (game.status === "Cancelled_Draining") {
            if (currentHeight >= (game as GameCancellation).unlockHeight) {
                return "drain_stake";
            }
            return null;
        }

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
        participationIsEnded,
        currentHeight,
    );

    $: disabledActions = getDisabledActions(
        game,
        openCeremony,
        participationIsEnded,
        isBeforeDeadline,
        strictMode,
        currentHeight,
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
        participationIsEnded: boolean,
        currentHeight: number,
    ) {
        if (!game) return [];
        const actions = [];

        if (game.status === "Active") {
            if (openCeremony) {
                actions.push({
                    id: "open_ceremony",
                    label: "Add Seed Randomness",
                    icon: Sparkles,
                    variant: "outline",
                });
                actions.push({
                    id: "donate_ceremony",
                    label: "Donate",
                    icon: Heart,
                    variant: "outline",
                });
            }
            // Only show cancel_game action before the deadline
            if (!participationIsEnded) {
                actions.push({
                    id: "cancel_game",
                    label: "Cancel Competition",
                    icon: XCircle,
                    variant: "destructive",
                });
            }
            if (isNominatedJudge) {
                actions.push({
                    id: "accept_judge_nomination",
                    label: isJudge
                        ? "Update Judge Reference Participation"
                        : "Accept Judge Nomination",
                    icon: isJudge ? Edit : Gavel,
                    variant: "outline",
                });
            }
        }

        if (
            game.status === "Resolution" &&
            currentHeight < game.resolutionDeadline
        ) {
            // Only allow judge actions if there's a winner candidate
            // ANY user with a reputation proof can vote (reputation system is open),
            // but only appointed judges count for the quorum.
            if (reputationProof && game.winnerCandidateCommitment) {
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
                    variant: "destructive",
                });
                if (candidateParticipationUnavailableVotes.includes(address)) {
                    actions.push({
                        id: "remove_opinion",
                        label: "Mark Winner Service Available",
                        icon: Trash2,
                        variant: "outline",
                    });
                }
            }

            actions.push({
                id: "include_omitted",
                label: "Include Omitted Participations",
                icon: Users,
                variant: "outline",
            });
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
        currentHeight: number,
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

        if (game.status === "Cancelled_Draining") {
            const unlockHeight = (game as GameCancellation).unlockHeight;
            if (currentHeight < unlockHeight) {
                const blocksLeft = unlockHeight - currentHeight;
                actions.push({
                    label: "Drain Resolver Stake",
                    reason: `Available in ~${blocksLeft} blocks (Cooldown period active)`,
                    icon: Trash2,
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
    let gameHistory: AnyGame[] = [];

    // UI State
    let transactionId: string | null = null;
    let modalTitle: string = "";
    let errorMessage: string | null = null;
    let warningMessage: string | null = null;
    let jsonUploadError: string | null = null;
    let checksumStatus: 'valid' | 'invalid' | 'missing' | null = null;
    let isSubmitting: boolean = false;
    let showShareModal = false;

    // Game Status State
    let participationIsEnded = true;
    let resolutionAllowed = false;
    let gameSuspended = false;
    let deadlineDateDisplay = "N/A";
    let isOwner = false;
    let isResolver = false;
    let isJudge = false;
    let isNominatedJudge = false;
    let openCeremony = false;
    let openSolverSubmit = false;
    let acceptedJudgeNominations: string[] = [];
    let isInvalidationMajorityReached = false;
    let isUnavailableMajorityReached = false;
    let isClaimingRefundFor: string | null = null;
    let claimRefundError: { [boxId: string]: string | null } = {};
    let claimRefundSuccessTxId: { [boxId: string]: string | null } = {};

    interface PhaseActionItem {
        actor: string;
        text: string;
    }

    interface ContractStateCard {
        id: string;
        label: string;
        description: string;
        badge: string;
        status: "current" | "completed" | "pending" | "skipped" | "alternate";
        icon: typeof Sparkles;
    }

    const MAIN_CONTRACT_FLOW = [
        GameContractPhase.ACTIVE,
        GameContractPhase.RESOLUTION,
        GameContractPhase.FINALIZED,
    ] as const;

    const SUBPHASE_HINTS: Record<GameUiSubphaseValue, string> = {
        strategy_upload:
            "Players can still upload solver services while anyone can keep adding randomness.",
        seed_lockdown:
            "Bot uploads are closed, but the ceremony is still open until the seed deadline.",
        playing:
            "The seed is fixed and players can execute their bots and submit participations.",
        awaiting_resolution:
            "Participation is closed and the creator must reveal the secret before suspension.",
        suspended:
            "This occurs if and only if the game fails to enter the RESOLUTION phase in time — i.e. if the creator does not reveal the secret before the resolution deadline, the game becomes suspended and players can recover their funds.",
        judging:
            "The secret is revealed and judges can verify or challenge the candidate.",
        ready_to_finalize:
            "The judge window ended and payouts can now be distributed.",
        cancelled_locked:
            "The game is cancelled, but the next creator-stake drain is still cooling down.",
        cancelled_draining:
            "The game is cancelled and the next creator-stake drain is unlocked.",
        finalized: "The lifecycle is complete and payouts were already distributed.",
        unknown: "The current phase could not be derived.",
    };

    const phaseIcons: Record<GameUiSubphaseValue, typeof Sparkles> = {
        strategy_upload: Sparkles,
        seed_lockdown: LockIcon,
        playing: Cpu,
        awaiting_resolution: Calendar,
        suspended: AlertTriangle,
        judging: Gavel,
        ready_to_finalize: Trophy,
        cancelled_locked: XCircle,
        cancelled_draining: XCircle,
        finalized: Trophy,
        unknown: Info,
    };

    function getPhaseTone(subphase: GameUiSubphaseValue) {
        switch (subphase) {
            case "strategy_upload":
                return {
                    iconBg: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
                    titleText: "text-sky-700 dark:text-sky-300",
                    contractBadge:
                        "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
                    currentChip:
                        "border-sky-300 bg-sky-50 text-sky-800 shadow-sm dark:border-sky-500 dark:bg-sky-500 dark:text-white",
                    completedChip:
                        "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
                };
            case "seed_lockdown":
                return {
                    iconBg: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                    titleText: "text-amber-700 dark:text-amber-300",
                    contractBadge:
                        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                    currentChip:
                        "border-amber-300 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500 dark:bg-amber-500 dark:text-white",
                    completedChip:
                        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
                };
            case "playing":
                return {
                    iconBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                    titleText: "text-emerald-700 dark:text-emerald-300",
                    contractBadge:
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                    currentChip:
                        "border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm dark:border-emerald-500 dark:bg-emerald-500 dark:text-white",
                    completedChip:
                        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
                };
            case "awaiting_resolution":
                return {
                    iconBg: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                    titleText: "text-orange-700 dark:text-orange-300",
                    contractBadge:
                        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
                    currentChip:
                        "border-orange-300 bg-orange-50 text-orange-800 shadow-sm dark:border-orange-500 dark:bg-orange-500 dark:text-white",
                    completedChip:
                        "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300",
                };
            case "suspended":
            case "cancelled_locked":
            case "cancelled_draining":
                return {
                    iconBg: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                    titleText: "text-red-700 dark:text-red-300",
                    contractBadge:
                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                    currentChip:
                        "border-red-300 bg-red-50 text-red-800 shadow-sm dark:border-red-500 dark:bg-red-500 dark:text-white",
                    completedChip:
                        "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
                };
            case "ready_to_finalize":
                return {
                    iconBg: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                    titleText: "text-yellow-700 dark:text-yellow-300",
                    contractBadge:
                        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                    currentChip:
                        "border-yellow-300 bg-yellow-50 text-yellow-800 shadow-sm dark:border-yellow-500 dark:bg-yellow-500 dark:text-white",
                    completedChip:
                        "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-950/40 dark:text-yellow-300",
                };
            case "finalized":
            case "unknown":
                return {
                    iconBg: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
                    titleText: "text-gray-700 dark:text-gray-300",
                    contractBadge:
                        "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
                    currentChip:
                        "border-gray-300 bg-gray-50 text-gray-800 shadow-sm dark:border-gray-500 dark:bg-gray-500 dark:text-white",
                    completedChip:
                        "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300",
                };
            case "judging":
            default:
                return {
                    iconBg: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                    titleText: "text-blue-700 dark:text-blue-300",
                    contractBadge:
                        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                    currentChip:
                        "border-blue-300 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-500 dark:bg-blue-500 dark:text-white",
                    completedChip:
                        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300",
                };
        }
    }

    function getContractStateCards(
        phase: GamePhaseSnapshot,
    ): ContractStateCard[] {
        const cards: ContractStateCard[] = [
            {
                id: GameContractPhase.ACTIVE,
                label: "ACTIVE",
                description:
                    "On-chain state 0. This includes Strategy & Upload, Seed Lockdown, Playing, Awaiting Resolution, and Suspended.",
                badge: "Upcoming",
                status: "pending",
                icon: Sparkles,
            },
            {
                id: GameContractPhase.RESOLUTION,
                label: "RESOLUTION",
                description:
                    "On-chain state 1. The secret is revealed and judges can verify or challenge the result.",
                badge: "Upcoming",
                status: "pending",
                icon: Gavel,
            },
            {
                id: GameContractPhase.CANCELLED,
                label: "CANCELLED_DRAINING",
                description:
                    "On-chain state 2. Alternative exit if the secret is revealed before the participation deadline.",
                badge: "Alternative exit",
                status: "alternate",
                icon: XCircle,
            },
            {
                id: GameContractPhase.FINALIZED,
                label: "FINALIZED",
                description:
                    "Derived frontend state after payouts are distributed.",
                badge: "Pending",
                status: "pending",
                icon: Trophy,
            },
        ];

        return cards.map((card) => {
            if (card.id === phase.contractPhase) {
                return {
                    ...card,
                    badge: "Current",
                    status: "current",
                };
            }

            if (
                phase.contractPhase === GameContractPhase.RESOLUTION &&
                card.id === GameContractPhase.ACTIVE
            ) {
                return { ...card, badge: "Completed", status: "completed" };
            }

            if (phase.contractPhase === GameContractPhase.FINALIZED) {
                if (
                    card.id === GameContractPhase.ACTIVE ||
                    card.id === GameContractPhase.RESOLUTION
                ) {
                    return { ...card, badge: "Completed", status: "completed" };
                }
                if (card.id === GameContractPhase.CANCELLED) {
                    return { ...card, badge: "Skipped", status: "skipped" };
                }
            }

            if (phase.contractPhase === GameContractPhase.CANCELLED) {
                if (card.id === GameContractPhase.ACTIVE) {
                    return { ...card, badge: "Exited here", status: "completed" };
                }
                if (
                    card.id === GameContractPhase.RESOLUTION ||
                    card.id === GameContractPhase.FINALIZED
                ) {
                    return { ...card, badge: "Skipped", status: "skipped" };
                }
            }

            return card;
        });
    }

    function getContractCardClasses(
        card: ContractStateCard,
        phase: GamePhaseSnapshot,
    ) {
        if (card.status === "current") {
            switch (card.id) {
                case GameContractPhase.ACTIVE:
                    return "border-sky-300 bg-sky-50 text-sky-950 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-50";
                case GameContractPhase.RESOLUTION:
                    return "border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-50";
                case GameContractPhase.FINALIZED:
                    return "border-slate-300 bg-slate-100 text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-50";
                default:
                    return "border-red-300 bg-red-50 text-red-950 shadow-sm dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-50";
            }
        }

        if (card.status === "completed") {
            return "border border-gray-200 bg-gray-50/80 text-gray-900 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-100";
        }

        if (card.status === "skipped") {
            return "border border-dashed border-gray-200 bg-transparent text-gray-400 dark:border-gray-700 dark:text-gray-500";
        }

        if (card.status === "alternate") {
            return "border border-dashed border-red-200 bg-red-50/60 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300";
        }

        return "border border-gray-200 bg-background text-gray-500 dark:border-gray-700 dark:text-gray-400";
    }

    function getContractStateMeta(cardId: ContractStateCard["id"]) {
        switch (cardId) {
            case GameContractPhase.ACTIVE:
                return {
                    eyebrow: "State 0",
                    accent:
                        "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
                };
            case GameContractPhase.RESOLUTION:
                return {
                    eyebrow: "State 1",
                    accent:
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                };
            case GameContractPhase.FINALIZED:
                return {
                    eyebrow: "Derived",
                    accent:
                        "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
                };
            default:
                return {
                    eyebrow: "State 2",
                    accent:
                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                };
        }
    }

    function getContractBadgeClasses(card: ContractStateCard) {
        switch (card.status) {
            case "current":
                return "bg-black/10 text-current dark:bg-white/10";
            case "completed":
                return "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900";
            case "alternate":
                return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
            case "skipped":
                return "bg-transparent text-gray-400 ring-1 ring-inset ring-gray-300 dark:text-gray-500 dark:ring-gray-700";
            default:
                return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
        }
    }

    function getMainContractStateCards(
        cards: ContractStateCard[],
    ): ContractStateCard[] {
        return MAIN_CONTRACT_FLOW.flatMap((id) =>
            cards.filter((card) => card.id === id),
        );
    }

    function getAlternativeContractCard(
        cards: ContractStateCard[],
    ): ContractStateCard | null {
        return cards.find((card) => card.id === GameContractPhase.CANCELLED) ?? null;
    }

    function getSubphaseStatus(
        phase: GamePhaseSnapshot,
        subphase: GameUiSubphaseValue,
    ): "current" | "completed" | "pending" {
        const sequence = getSubphaseSequence(phase.contractPhase);
        const currentIndex = sequence.indexOf(phase.subphase);
        const subphaseIndex = sequence.indexOf(subphase);

        if (subphase === phase.subphase) {
            return "current";
        }

        if (subphaseIndex > -1 && subphaseIndex < currentIndex) {
            return "completed";
        }

        return "pending";
    }

    function getSubphaseCardClasses(
        phase: GamePhaseSnapshot,
        subphase: GameUiSubphaseValue,
    ) {
        const status = getSubphaseStatus(phase, subphase);

        if (status === "current") {
            return "border-gray-300 bg-white text-gray-950 shadow-sm dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-50";
        }

        if (status === "completed") {
            return "border-gray-200 bg-gray-50 text-gray-700 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-200";
        }

        return "border-gray-200 bg-white text-gray-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-gray-300";
    }

    function getSubphaseIndexClasses(
        phase: GamePhaseSnapshot,
        subphase: GameUiSubphaseValue,
    ) {
        const status = getSubphaseStatus(phase, subphase);

        if (status === "current") {
            return "bg-gray-900 text-white ring-1 ring-inset ring-gray-900/10 dark:bg-gray-100 dark:text-gray-900 dark:ring-white/10";
        }

        if (status === "completed") {
            return "bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200";
        }

        return "bg-gray-100 text-gray-500 dark:bg-slate-900 dark:text-gray-400";
    }

    function getSubphaseStatusBadgeClasses(
        phase: GamePhaseSnapshot,
        subphase: GameUiSubphaseValue,
    ) {
        const status = getSubphaseStatus(phase, subphase);

        if (status === "current") {
            return "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900";
        }

        if (status === "completed") {
            return "bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200";
        }

        return "bg-gray-100 text-gray-600 dark:bg-slate-900 dark:text-gray-300";
    }

    function getSubphaseStatusLabel(
        phase: GamePhaseSnapshot,
        subphase: GameUiSubphaseValue,
    ) {
        const status = getSubphaseStatus(phase, subphase);
        if (status === "current") return "Current";
        if (status === "completed") return "Done";
        return "Next";
    }

    function getAllowedActionsForPhase(
        phase: GamePhaseSnapshot,
    ): PhaseActionItem[] {
        switch (phase.subphase) {
            case "strategy_upload":
                return [
                    {
                        actor: "Anyone",
                        text: "Add randomness to the seed while the ceremony remains open.",
                    },
                    {
                        actor: "Players",
                        text: "Register or upload solver services before the bot-upload deadline.",
                    },
                    {
                        actor: "Anyone",
                        text: "Cancel the competition if the secret is revealed before the participation deadline.",
                    },
                ];
            case "seed_lockdown":
                return [
                    {
                        actor: "Anyone",
                        text: "Add randomness to the seed until the ceremony deadline.",
                    },
                    {
                        actor: "Players",
                        text: "Wait for the fixed seed while preparing execution inputs off-chain.",
                    },
                    {
                        actor: "Anyone",
                        text: "Cancel the competition if the secret is revealed before the participation deadline.",
                    },
                ];
            case "playing":
                return [
                    {
                        actor: "Players",
                        text: "Execute their bots with the fixed seed and submit participations.",
                    },
                    {
                        actor: "Anyone",
                        text: "Inspect the game and monitor for an early secret reveal before the deadline.",
                    },
                    {
                        actor: "Anyone",
                        text: "Cancel the competition if the secret is revealed before the participation deadline.",
                    },
                ];
            case "awaiting_resolution":
                return [
                    {
                        actor: "Creator",
                        text: "Reveal the secret and move the game into RESOLUTION before the grace period expires.",
                    },
                    {
                        actor: "Players",
                        text: "Monitor the game so they can challenge the result once RESOLUTION begins.",
                    },
                ];
            case "suspended":
                return [
                    {
                        actor: "Players",
                        text: "Recover their participation funds immediately.",
                    },
                ];
            case "judging":
                return [
                    {
                        actor: "Judges",
                        text: "Validate, invalidate, or mark the candidate service as unavailable.",
                    },
                    {
                        actor: "Anyone",
                        text: "Include omitted participations or propose a better valid candidate.",
                    },
                ];
            case "ready_to_finalize":
                return [
                    {
                        actor: "Winner / Resolver",
                        text: "Finalize the competition and distribute payouts.",
                    },
                ];
            case "cancelled_locked":
                return [
                    {
                        actor: "Players",
                        text: "Claim full refunds immediately.",
                    },
                    {
                        actor: "Anyone",
                        text: "Wait for the cooldown to unlock the next stake drain.",
                    },
                ];
            case "cancelled_draining":
                return [
                    {
                        actor: "Players",
                        text: "Claim full refunds immediately.",
                    },
                    {
                        actor: "Anyone",
                        text: "Drain the next portion of the creator stake now.",
                    },
                ];
            case "finalized":
                return [
                    {
                        actor: "Everyone",
                        text: "Inspect the final result, transactions, and historical record.",
                    },
                ];
            default:
                return [];
        }
    }

    function getRestrictedActionsForPhase(
        phase: GamePhaseSnapshot,
    ): PhaseActionItem[] {
        switch (phase.subphase) {
            case "strategy_upload":
                return [
                    {
                        actor: "Players",
                        text: "Submit participation results before the seed is fixed.",
                    },
                    {
                        actor: "Creator",
                        text: "Reveal the secret and resolve the game before the participation deadline.",
                    },
                ];
            case "seed_lockdown":
                return [
                    {
                        actor: "Players",
                        text: "Upload new solver services. The bot-upload window is closed.",
                    },
                    {
                        actor: "Players",
                        text: "Submit participation results before the seed is fixed.",
                    },
                    {
                        actor: "Creator",
                        text: "Reveal the secret and resolve the game before the participation deadline.",
                    },
                ];
            case "playing":
                return [
                    {
                        actor: "Anyone",
                        text: "Add more seed randomness. The ceremony has ended.",
                    },
                    {
                        actor: "Players",
                        text: "Upload new solver services. Registration is already closed.",
                    },
                    {
                        actor: "Creator",
                        text: "Resolve the competition before the participation deadline.",
                    },
                ];
            case "awaiting_resolution":
                return [
                    {
                        actor: "Players",
                        text: "Submit new participations. The deadline already passed.",
                    },
                    {
                        actor: "Anyone",
                        text: "Cancel the competition. Cancellation is only valid before the participation deadline.",
                    },
                    {
                        actor: "Anyone",
                        text: "Add randomness or upload bots. The ACTIVE subphases for setup and play are closed.",
                    },
                ];
            case "suspended":
                return [
                    {
                        actor: "Creator",
                        text: "Move the game into RESOLUTION. The grace period already expired.",
                    },
                    {
                        actor: "Players",
                        text: "Submit new participations. The competition flow is over.",
                    },
                ];
            case "judging":
                return [
                    {
                        actor: "Players",
                        text: "Submit new participations. Participation is already closed.",
                    },
                    {
                        actor: "Anyone",
                        text: "Finalize the competition before the judge window ends.",
                    },
                ];
            case "ready_to_finalize":
                return [
                    {
                        actor: "Judges",
                        text: "Keep invalidating or replacing the winner. The judging window is closed.",
                    },
                    {
                        actor: "Players",
                        text: "Submit new participations. Participation is already closed.",
                    },
                ];
            case "cancelled_locked":
                return [
                    {
                        actor: "Anyone",
                        text: "Declare a winner or enter RESOLUTION. The cancellation path is permanent.",
                    },
                    {
                        actor: "Anyone",
                        text: "Drain the next stake portion before the cooldown unlocks.",
                    },
                ];
            case "cancelled_draining":
                return [
                    {
                        actor: "Anyone",
                        text: "Declare a winner or enter RESOLUTION. The cancellation path is permanent.",
                    },
                ];
            case "finalized":
                return [
                    {
                        actor: "Anyone",
                        text: "Modify the outcome or reopen the competition. The lifecycle is closed.",
                    },
                ];
            default:
                return [];
        }
    }

    let gamePhase: GamePhaseSnapshot = deriveGamePhaseSnapshot(
        game,
        currentHeight,
    );
    let phaseTone = getPhaseTone(gamePhase.subphase);
    let phaseIcon = phaseIcons[gamePhase.subphase];
    let contractStateCards: ContractStateCard[] = [];
    let mainContractStateCards: ContractStateCard[] = [];
    let alternativeContractCard: ContractStateCard | null = null;
    let currentSubphaseSequence: GameUiSubphaseValue[] = [];
    let allowedPhaseActions: PhaseActionItem[] = [];
    let restrictedPhaseActions: PhaseActionItem[] = [];
    let currentMilestoneTitle = "No active deadline";
    let currentMilestoneDescription = "This phase does not have a live countdown.";

    function setError(error: unknown, options: FormatOptions = {}) {
        errorMessage = formatUserFacingError(error, options);
    }

    function setTransactionError(error: unknown, options: FormatOptions = {}) {
        errorMessage = formatUserFacingError(error, {
            transaction: true,
            ...options,
        });
    }

    $: gamePhase = deriveGamePhaseSnapshot(game, currentHeight);
    $: phaseTone = getPhaseTone(gamePhase.subphase);
    $: phaseIcon = phaseIcons[gamePhase.subphase];
    $: contractStateCards = getContractStateCards(gamePhase);
    $: mainContractStateCards = getMainContractStateCards(contractStateCards);
    $: alternativeContractCard = getAlternativeContractCard(contractStateCards);
    $: currentSubphaseSequence = getSubphaseSequence(gamePhase.contractPhase);
    $: allowedPhaseActions = getAllowedActionsForPhase(gamePhase);
    $: restrictedPhaseActions = getRestrictedActionsForPhase(gamePhase);
    $: showCountdown =
        !!targetDate &&
        ![
            "suspended",
            "finalized",
            "unknown",
        ].includes(gamePhase.subphase);
    $: countdownIsZero =
        daysValue === 0 &&
        hoursValue === 0 &&
        minutesValue === 0 &&
        secondsValue === 0;
    $: shouldShowCountdown = showCountdown && !countdownIsZero;
    $: currentMilestoneTitle = shouldShowCountdown
        ? clockLabel
        : gamePhase.subphase === "finalized"
          ? "Game ended"
          : gamePhase.subphase === "suspended"
            ? "Refund window"
            : "No active deadline";
    $: currentMilestoneDescription = shouldShowCountdown
        ? deadlineDateDisplay
        : gamePhase.subphase === "suspended"
          ? "The resolution grace period already expired."
          : gamePhase.subphase === "finalized"
            ? "Payouts were already distributed."
            : "This phase does not currently expose a live countdown.";

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
    let targetBlockHeight: number = 0;
    let remainingBlocks: number = 0;
    let clockLabel: string = "TIME LEFT";
    let clockInformation: string = "Depends on game status";
    let clockCountdownInterval: ReturnType<typeof setInterval> | null = null;
    let createdDateDisplay: string = "";

    // Modal State
    let showActionModal = false;
    let showParticipantGuide = true;
    let showSolverIdStep = false;
    let showExecutionStep = false;
    let showJudgeGuide = true;
    let showBotAssistantModal = false;
    let showRobotDevelopmentGuideModal = false;
    let isRobotDevelopmentGuideLoading = false;
    let robotDevelopmentGuideContent = "";
    let robotDevelopmentGuideError: string | null = null;
    let robotDevelopmentGuideFetchPromise: Promise<void> | null = null;

    async function fetchRobotGuideForPaper() {
        if (robotDevelopmentGuideContent) {
            if (robotGuideToc.length === 0) {
                try {
                    extractGuideToc(robotDevelopmentGuideContent);
                } catch (e) {
                    console.error("Error extracting robot guide TOC:", e);
                }
            }
            return;
        }
        if (robotDevelopmentGuideFetchPromise) {
            await robotDevelopmentGuideFetchPromise;
            return;
        }

        robotDevelopmentGuideFetchPromise = (async () => {
            isRobotDevelopmentGuideLoading = true;
            robotDevelopmentGuideError = null;
            try {
                const response = await fetch(ROBOT_DEVELOPMENT_GUIDE);
                if (!response.ok) {
                    throw new Error(
                        `Unable to load guide (${response.status} ${response.statusText})`,
                    );
                }
                robotDevelopmentGuideContent = await response.text();
                robotDevelopmentGuideContent = robotDevelopmentGuideContent.replaceAll(
                    "{GAME_SERVICE_URL}",
                    serviceDownload ?? game.serviceId ?? "{GAME_SERVICE_URL}"
                );
                // Extract TOC for the robot guide
                try {
                    extractGuideToc(robotDevelopmentGuideContent);
                } catch (e) {
                    console.error("Error extracting robot guide TOC:", e);
                }
            } catch (e) {
                robotDevelopmentGuideError = formatUserFacingError(e, {
                    fallback: "Unable to load the robot development guide right now.",
                });
            } finally {
                isRobotDevelopmentGuideLoading = false;
                robotDevelopmentGuideFetchPromise = null;
            }
        })();

        await robotDevelopmentGuideFetchPromise;
    }
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
        | "donate_ceremony"
        | null = null;

    // Didactic Modal State
    let showDidacticModal = false;

    // Donation State
    let donationAmount = "";
    let userParticipationTokenBalance = 0n;
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

    let tokenSymbol = "N/A";
    let tokenDecimals = 0;

    $: prizePoolValue = getPrizePool(game, participations);

    // File Source Modal State
    let showFileSourceModal = false;
    let modalFileHash = "";
    let modalFileType: "image" | "service" | "paper" | "soundtrack" = "image";
    let imageSources: any[] = [];
    let serviceSources: any[] = [];
    let paperSources: any[] = [];

    // Solver source modal state
    let showSolverModal = false;
    let selectedSolverId: string | undefined = undefined;
    let selectedSolverSources: any[] = [];

    let paperContent: string | null = null;
    let paperContentStatus:
        | "idle"
        | "missing-sources"
        | "loading"
        | "ready"
        | "fetch-error" = "idle";
    let isPaperExpanded = false;
    let paperToc: { level: number; text: string; id: string }[] = [];
    let isRobotGuideExpanded = false;
    let robotGuideToc: { level: number; text: string; id: string }[] = [];
    let soundtrackSources: any[] = [];
    let soundtrackUrl: string | null = null;
    let serviceDownload: string | null = null;
    let audioElement: HTMLAudioElement;
    let showAudioControls = false;
    let loadedHandlerAdded = false;

    $: audio_element.set(audioElement || null);
    $: botAssistantPaperUrl =
        paperSources.map(getPaperSourceUrl).find((url) => !!url) ?? null;
    $: botAssistantPrompt = buildBotAssistantPrompt(game, botAssistantPaperUrl);

    function getSourceUrl(source: any): string | null {
        const rawUrl =
            typeof source?.source?.urlLink === "string"
                ? source.source.urlLink
                : typeof source?.sourceUrl === "string"
                  ? source.sourceUrl
                  : "";

        const normalizedUrl = rawUrl.trim();
        return normalizedUrl.length > 0 ? normalizedUrl : null;
    }

    function getPaperSourceUrl(source: any): string | null {
        return getSourceUrl(source);
    }

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

    function buildBotAssistantPrompt(
        currentGame: AnyGame | null,
        paperUrl: string | null,
    ) {
        const title = currentGame?.content?.title?.trim() || "Untitled challenge";
        const description =
            currentGame?.content?.description?.trim() ||
            "No game description was provided.";

        const parts = [
            "Please develop a robot that solves the following Game of Prompts challenge.",
            `Game title: ${title}`,
            `Game description: ${description}`,
        ];

        if (paperUrl) {
            parts.push(`Reference paper URL: ${paperUrl}`);
        }

        // Basic explanation
        parts.push(
            "The game mechanics are as follows: A secret value S is locked on-chain. Players must create solver services that can compute a score based on S and submit their results before the deadline. After the deadline, the secret is revealed and the player with the best valid score wins. The exact scoring function and rules are defined in the reference paper.",
        );

        // Solver developer guide url
        parts.push(
            `For more details on how to develop a solver service for this game, please refer to the official guide: ${ROBOT_DEVELOPMENT_GUIDE}`,
        );

        parts.push(
            "Please reason about the game mechanics, propose a solver-service strategy, and provide implementation guidance or code in English.",
        );

        return parts.join("\n\n");
    }

    async function loadPaperContentFromSources(sources: any[]) {
        paperContent = null;
        paperContentStatus = "idle";

        const candidateUrls = sources
            .map(getPaperSourceUrl)
            .filter((url): url is string => !!url);

        if (candidateUrls.length === 0) {
            paperContentStatus = "missing-sources";
            return;
        }

        paperContentStatus = "loading";

        for (const url of candidateUrls) {
            try {
                const response = await fetch(url);
                if (!response.ok) continue;

                paperContent = await response.text();
                paperContentStatus = "ready";
                extractToc(paperContent);
                // Ensure robot guide is fetched so its separate section can render
                try {
                    await fetchRobotGuideForPaper();
                } catch (e) {
                    // fetchRobotGuideForPaper handles errors
                }

                return;
            } catch (e) {
                console.error("Error paper:", e);
            }
        }

        paperContentStatus = "fetch-error";
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
                await loadPaperContentFromSources(paperSources);
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
    let participationSolverId = "";
    let solverId_box_found = false;
    let solverId_checked = false;
    let solverId_check_loading = false;
    let solverId_check_error: string | null = null;
    let hashLogs_input = "";
    let judgeReferenceSeed_input = "";
    let judgeReferenceScore_input = "";
    let judgeReferenceErgoTree_input = "";
    let user_score: number | null = null;
    let scores_list: number[] = [];
    // Inline score picker state (replaces window.prompt)
    let showScorePicker = false;
    let scorePickerOptions: number[] = [];
    let scorePickerSelection: number | null = null;
    let secret_S_input_resolve = "";
    let secret_S_input_cancel = "";
    let walletErgoTreeHex = "";
    let participationChecksum = "";

    $: if ($address && game && !participationChecksum) {
        try {
            const ergoAddr = ErgoAddress.fromBase58($address);
            walletErgoTreeHex = typeof ergoAddr.ergoTree === "string" 
                ? ergoAddr.ergoTree 
                : uint8ArrayToHex(ergoAddr.ergoTree);
            if (!judgeReferenceErgoTree_input) {
                judgeReferenceErgoTree_input = walletErgoTreeHex;
            }
            sha256(game.seed + walletErgoTreeHex).then(res => {
                participationChecksum = res;
            });
        } catch (e) {
            console.error(e);
        }
    }

    $: if (solverId_input) solverId_checked = false;

    let isAutoFilling = false;

    function sortKeysAlphabetically(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(sortKeysAlphabetically);
        }

        if (value && typeof value === "object") {
            return Object.keys(value as Record<string, unknown>)
                .sort((a, b) => a.localeCompare(b))
                .reduce<Record<string, unknown>>((acc, key) => {
                    acc[key] = sortKeysAlphabetically(
                        (value as Record<string, unknown>)[key],
                    );
                    return acc;
                }, {});
        }

        return value;
    }

    function stringifyForChecksum(data: Record<string, unknown>): string {
        // To calculate the checksum, the checksum field is removed from the JSON,
        // the keys of the resulting object are reordered alphabetically,
        // and its exact representation is obtained using JSON.stringify(...).
        // A SHA-256 hash is calculated over that string,
        // and its hexadecimal value is stored in the checksum field.
        return JSON.stringify(sortKeysAlphabetically(data));
    }

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
            const wallet = getErgoWallet();
            if (!wallet?.get_change_address) {
                throw new Error("Wallet not connected.");
            }

            // 1. Generate Random Values
            const randomBytes = new Uint8Array(32);
            window.crypto.getRandomValues(randomBytes);
            const solverId = uint8ArrayToHex(randomBytes);

            window.crypto.getRandomValues(randomBytes);
            const hashLogs = uint8ArrayToHex(randomBytes);

            const seed = game?.seed;

            // 2. Get Constants/Context
            const secretS = game?.content.serviceId; // Dev competitions typically use the serviceId as secretS

            const playerAddressString = await wallet.get_change_address();
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
        solverId_checked = true;
        solverId_check_loading = true;
        solverId_check_error = null;
        try {
            const box = await fetchSolverIdBox(solverId_input);
            if (box) {
                solverId_box_found = true;
                participationSolverId = solverId_input.trim();
            } else {
                solverId_box_found = false;
                participationSolverId = "";
                solverId_check_error =
                    "Solver ID box not found. Please publish it first.";
            }
        } catch (e) {
            console.error("Error checking solver ID box:", e);
            participationSolverId = "";
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
            setTransactionError(e);
        } finally {
            isSubmitting = false;
        }
    }

    // Tabs State
    let activeTab: "history" | "participations" | "forum" = "history";

    // --- LOGIC ---
    const unsubscribeGameDetail = game_detail.subscribe((value) => {
        const typedValue = value as AnyGame | null;
        if (typedValue && (!game || typedValue.boxId !== game.boxId)) {
            game = typedValue;
            isLoaded = false;
            loadGameDetailsAndTimers();
        } else if (!typedValue && game) {
            game = null;
            cleanupTimers();
        }
    });

    async function loadGameDetailsAndTimers() {
        // 1. Initial verification and cleanup
        if (!game) {
            cleanupTimers();
            return;
        }

        cleanupTimers(); // Run cleanup once at the start
        isSubmitting = false;
        transactionId = null;
        errorMessage = null;
        warningMessage = null;

        try {
            platform = game.platform;

            // 2. Commission integration (unified logic)
            // Only compute breakdown if the status exposes commissions
            if (game.status === "Active" || game.status === "Resolution") {
                const denominator = game.constants.COMMISSION_DENOMINATOR / 100;
                resolverPct =
                    Number(game.resolverCommission ?? 0) / denominator;
                judgesTotalPct =
                    (Number(game.perJudgeCommission ?? 0n) *
                        game.judges.length) /
                    denominator;
                developersPct = Number(game.devCommission ?? 0) / denominator;
                creatorSlashRatioPct =
                    Number(game.creatorSlashRatio ?? 0) / denominator;
                totalPct = resolverPct + judgesTotalPct + developersPct;
                winnerPct = Math.max(0, 100 - totalPct);
                overAllocated =
                    totalPct > 100 ? (totalPct - 100).toFixed(2) : 0;
            }

            // 3. Gather current network data and state
            currentHeight = await platform.get_current_height();

            // Fetch history (without blocking the main thread)
            fetchGameHistory(game.gameId).then((history) => {
                gameHistory = history;
            });

            const phaseSnapshot = deriveGamePhaseSnapshot(game, currentHeight);
            participationIsEnded = phaseSnapshot.participationIsEnded;
            resolutionAllowed = phaseSnapshot.resolutionAllowed;
            gameSuspended = phaseSnapshot.gameSuspended;
            openCeremony = phaseSnapshot.openCeremony;
            openSolverSubmit = phaseSnapshot.openSolverSubmit;

            // 4. Time and deadline logic (consolidated)
            if (game.status === "Active") {
                if (phaseSnapshot.subphase === "strategy_upload") {
                    targetBlockHeight =
                        game.ceremonyDeadline - game.constants.SEED_MARGIN;
                    targetDate = await block_height_to_timestamp(
                        targetBlockHeight,
                        platform,
                    );
                    clockLabel = "Bot Upload Deadline";
                    clockInformation = `Block limit to register solver services before seed lockdown begins. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                } else if (phaseSnapshot.subphase === "seed_lockdown") {
                    targetBlockHeight = game.ceremonyDeadline;
                    targetDate = await block_height_to_timestamp(
                        targetBlockHeight,
                        platform,
                    );
                    clockLabel = "Ceremony Deadline";
                    clockInformation = `Block limit to add randomness to the game seed. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                } else if (phaseSnapshot.subphase === "playing") {
                    targetBlockHeight = game.deadlineBlock;
                    targetDate = await block_height_to_timestamp(
                        targetBlockHeight,
                        platform,
                    );
                    clockLabel = "Participation Deadline";
                    clockInformation = `Block limit for submissions. After this block, no new participations will be accepted. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                } else {
                    targetBlockHeight =
                        game.deadlineBlock +
                        game.constants.PARTICIPATION_GRACE_PERIOD;
                    targetDate = await block_height_to_timestamp(
                        targetBlockHeight,
                        platform,
                    );
                    clockLabel = "Resolution Grace Period";
                    clockInformation = `Participation is closed. The creator must reveal the secret before this grace period ends or the game becomes suspended. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                }
                deadlineDateDisplay = format(
                    new Date(targetDate),
                    "MMM d, yyyy 'at' HH:mm",
                );
            } else if (game.status === "Resolution") {
                const isGrace = currentHeight >= game.resolutionDeadline;
                targetBlockHeight = isGrace
                    ? game.resolutionDeadline +
                      game.constants.END_GAME_AUTH_GRACE_PERIOD
                    : game.resolutionDeadline;

                targetDate = await block_height_to_timestamp(
                    targetBlockHeight,
                    platform,
                );
                clockLabel = isGrace
                    ? "End-Game Authorization Grace"
                    : "Resolution Deadline";
                clockInformation = isGrace
                    ? `The judge window ended. After this grace period, resolver authorization rules change for finalization. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`
                    : `Judges can challenge the candidate until this deadline. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                deadlineDateDisplay = `${clockLabel} ends ${formatDistanceToNow(new Date(targetDate), { addSuffix: true })}`;
            } else if (game.status === "Cancelled_Draining") {
                targetBlockHeight = (game as GameCancellation).unlockHeight;
                targetDate = await block_height_to_timestamp(
                    targetBlockHeight,
                    platform,
                );
                clockLabel = "Next Drain Unlock";
                clockInformation = `The next creator-stake drain can happen after this cooldown. Time is estimated based on ${platform.time_per_block / 1000 / 60} minutes per block.`;
                deadlineDateDisplay = format(
                    new Date(targetDate),
                    "MMM d, yyyy 'at' HH:mm",
                );
            } else {
                targetDate = 0;
                clockLabel = "GAME ENDED";
                clockInformation = "This game has finished.";
                deadlineDateDisplay = "N/A";
            }

            // 5. Carga de Contenido Multimedia
            soundtrackUrl = game.content.soundtrackURL;
            const explorer = get(explorer_uri);

            if (game.content.image)
                imageSources = await fetchFileSourcesByHash(
                    game.content.image,
                    explorer,
                );
            if (game?.content.serviceId) {
                serviceSources = await fetchFileSourcesByHash(
                    game.content.serviceId,
                    explorer,
                );
                serviceDownload = await fetchServiceDownloadUrl(
                    game?.content.serviceId,
                );
                if (robotDevelopmentGuideContent === "") {
                    await fetchRobotGuideForPaper();
                }
                else if (robotDevelopmentGuideContent.includes("{GAME_SERVICE_URL}")) {
                    robotDevelopmentGuideContent = robotDevelopmentGuideContent.replaceAll(
                        "{GAME_SERVICE_URL}",
                        serviceDownload ?? game.serviceId ?? "N/A"
                    );
                }
            }

            if (game.content.paper) {
                paperSources = await fetchFileSourcesByHash(
                    game.content.paper,
                    explorer,
                );
                await loadPaperContentFromSources(paperSources);
            } else {
                paperContent = null;
                paperContentStatus = "idle";
            }

            if (game.content.soundtrack) {
                soundtrackSources = await fetchFileSourcesByHash(
                    game.content.soundtrack,
                    explorer,
                );
                soundtrackUrl =
                    soundtrackSources
                        .map(getSourceUrl)
                        .find((url) => !!url) ?? soundtrackUrl;
            }

            // 6. Token details
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

            // 7. Participation and voting logic
            if (
                game.status === GameState.Active ||
                game.status === GameState.Resolution ||
                game.status === GameState.Cancelled_Draining ||
                game.status === GameState.Finalized
            ) {
                participations = await fetchParticipations(game);

                if (game.status === "Resolution") {
                    participationBatches =
                        await fetchParticipationBatches(game);

                    // Processing judge votes
                    for (const item of participations) {
                        const participation = item.commitmentC_Hex;
                        const allJudges = Array.from(
                            get(judges).data.entries(),
                        ).filter(([_, j]) => game.judges.includes(j.token_id));

                        const votes = new Map(
                            allJudges.filter(([_, j]) =>
                                j.current_boxes.some(
                                    (b) =>
                                        b.object_pointer === participation &&
                                        b.type.tokenId ===
                                            game.constants
                                                .PARTICIPATION_TYPE_ID &&
                                        b.is_locked === true,
                                ),
                            ),
                        );
                        participationVotes.set(participation, votes);

                        const unavailVotes = new Map(
                            allJudges.filter(([_, j]) =>
                                j.current_boxes.some(
                                    (b) =>
                                        b.object_pointer === participation &&
                                        b.type.tokenId ===
                                            game.constants
                                                .PARTICIPATION_UNAVAILABLE_TYPE_ID,
                                ),
                            ),
                        );
                        participationUnavailableVotes.set(
                            participation,
                            unavailVotes,
                        );
                    }

                    // Majority calculation for the winning candidate
                    const requiredVotes =
                        Math.floor(game.judges.length / 2) + 1;
                    if (game.winnerCandidateCommitment) {
                        const candidateVotes = participationVotes.get(
                            game.winnerCandidateCommitment,
                        );
                        if (candidateVotes) {
                            const votesArray = Array.from(
                                candidateVotes.entries(),
                            );
                            candidateParticipationValidVotes = votesArray
                                .filter(([_, v]) =>
                                    v.current_boxes.some(
                                        (b) => b.polarization == true,
                                    ),
                                )
                                .map(([k]) => k);

                            candidateParticipationInvalidVotes = votesArray
                                .filter(([_, v]) =>
                                    v.current_boxes.some(
                                        (b) => b.polarization == false,
                                    ),
                                )
                                .map(([k]) => k);

                            isInvalidationMajorityReached =
                                candidateParticipationInvalidVotes.length >=
                                requiredVotes;
                            console.log("CANDIDATE PARTICIPATION VOTES");
                            console.log(candidateParticipationInvalidVotes);
                            console.log("VOTES ARRAY");
                            console.log(votesArray);
                        }

                        const candidateUnvailVotes =
                            participationUnavailableVotes.get(
                                game.winnerCandidateCommitment,
                            );
                        if (candidateUnvailVotes) {
                            const votesArray = Array.from(
                                candidateUnvailVotes.entries(),
                            );

                            candidateParticipationUnavailableVotes =
                                votesArray.map(([k]) => k);

                            isUnavailableMajorityReached =
                                votesArray.length >= requiredVotes;
                        }
                    }
                }
            }

            // 8. Creation timestamp
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

            // 9. Determine connected user roles
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
                                              box.type.tokenId ===
                                                  game?.constants
                                                      .ACCEPT_GAME_INVITATION_TYPE_ID &&
                                              box.object_pointer ===
                                                  game?.gameId &&
                                              box.polarization === true,
                                      );
                                  return foundBox ? judge : null;
                              }),
                          )
                      ).filter((j): j is string => j !== null)
                    : [];

            const connectedAddress = get(address);
            if (get(connected) && connectedAddress) {
                const userPKBytes =
                    ErgoAddress.fromBase58(connectedAddress).getPublicKeys()[0];
                const userPKHex = userPKBytes
                    ? uint8ArrayToHex(userPKBytes)
                    : null;

                isResolver = userPKHex === game.resolverPK_Hex;

                const own_proof = get(reputation_proof);
                if (own_proof) {
                    isNominatedJudge = game.judges.includes(own_proof.token_id);
                    isJudge = acceptedJudgeNominations.includes(
                        own_proof.token_id,
                    );
                    isOwner =
                        own_proof.token_id === game.content.creatorTokenId;
                }
            }

            // 10. Iniciar cuenta regresiva si es necesario
            if (game.status !== "Finalized" && targetDate > 0) {
                clockCountdownInterval = setInterval(
                    updateClockCountdown,
                    1000,
                );
                updateClockCountdown();
            }
        } catch (error: any) {
            setError(error, { prefix: "Could not load game details:" });
            console.error(error);
        } finally {
            isLoaded = true;
        }
    }

    // --- Action Handlers ---

    async function handleOpenSolverSource(participation: AnyParticipation) {
        if (!participation.solverId_String) return;
        selectedSolverId = participation.solverId_String;
        selectedSolverSources = [];
        showSolverModal = true;
        try {
            selectedSolverSources = await fetchFileSourcesByHash(
                selectedSolverId,
                get(explorer_uri),
            );
        } catch (e) {
            console.error("Error fetching solver sources:", e);
        }
    }

    async function handleOpenCeremony() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            let donation = 0n;
            if (currentActionType === "donate_ceremony" && donationAmount) {
                const decimals = tokenDecimals || 0;
                // Parse simple decimal input
                const parts = donationAmount.split(".");
                let integerPart = parts[0];
                let fractionalPart = parts[1] || "";
                if (fractionalPart.length > decimals) {
                    fractionalPart = fractionalPart.slice(0, decimals);
                } else {
                    fractionalPart = fractionalPart.padEnd(decimals, "0");
                }
                donation = BigInt(integerPart + fractionalPart);
            }
            transactionId = await platform.contribute_to_ceremony(
                game,
                donation,
            );
        } catch (e: any) {
            setTransactionError(e);
        } finally {
            isSubmitting = false;
        }
    }

    async function handleSubmitScore() {
        if (game?.status !== "Active") return;
        errorMessage = null;
        isSubmitting = true;
        try {
            const solverIdToSubmit =
                participationSolverId || solverId_input.trim();
            const parsedScores = scores_list.map((s) => BigInt(s));
            transactionId = await platform.submitScoreToGopGame(
                game,
                parsedScores,
                commitmentC_input,
                solverIdToSubmit,
                hashLogs_input,
            );
        } catch (e: any) {
            setTransactionError(e);
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
            setTransactionError(e);
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
            setTransactionError(e);
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
            setTransactionError(e, { fallback: "Error draining stake." });
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
            claimRefundError[participation.boxId] = formatUserFacingError(e, {
                fallback: "Error claiming refund.",
            });
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
            reclaimGraceError[participation.boxId] = formatUserFacingError(e, {
                fallback: "Error reclaiming participation fee.",
            });
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
            setTransactionError(e);
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
            setTransactionError(e);
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
                (p) =>
                    game.winnerCandidateCommitment === p.commitmentC_Hex &&
                    p.status === "Submitted",
            )[0];

            if (isInvalidationMajorityReached) {
                // Execute Invalidation
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
                                    box.is_locked === true && // Ya se ha comprobado en el init, pero por si acaso.
                                    box.object_pointer ===
                                        (game?.winnerCandidateCommitment ??
                                            "") &&
                                    box.type.tokenId ===
                                        game.constants.PARTICIPATION_TYPE_ID
                                );
                            })[0].box;
                        });
                }

                transactionId =
                    (
                        await platform.judgesInvalidateExecute(
                            game,
                            winner_participation as ValidParticipation,
                            judgeInvalidVotesDataInputsBoxes,
                        )
                    )?.join(", ") || null;
            } else {
                // Vote to Invalidate
                transactionId = await platform.judgesInvalidateVote(
                    winner_participation as ValidParticipation,
                );
            }
        } catch (e: any) {
            setTransactionError(e);
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

            if (isUnavailableMajorityReached) {
                // Execute Mark Unavailable
                let judgeUnavailableVotesDataInputsBoxes: Box<Amount>[] = [];
                const winnerVotes = participationUnavailableVotes.get(
                    game.winnerCandidateCommitment,
                );
                if (winnerVotes) {
                    const judgeUnavailableVotesDataInputs = Array.from(
                        winnerVotes.entries(),
                    ).filter(([key, value]) => {
                        return candidateParticipationUnavailableVotes.includes(
                            key,
                        );
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

                transactionId =
                    await platform.judgesInvalidateUnavailableExecute(
                        game,
                        winner_participation as ValidParticipation,
                        judgeUnavailableVotesDataInputsBoxes,
                    );
            } else {
                // Vote as Unavailable
                transactionId = await platform.judgesInvalidateUnavailableVote(
                    game,
                    winner_participation as ValidParticipation,
                );
            }
        } catch (e: any) {
            setTransactionError(e);
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
                    game.constants.PARTICIPATION_UNAVAILABLE_TYPE_ID,
            );
            if (!opinionBox) {
                throw new Error("No opinion box found for this participation.");
            }

            // Find the main reputation box
            const mainBox = $reputation_proof.current_boxes.find(
                (box) => box.type.tokenId === $reputation_proof.token_id,
            );
            if (!mainBox) {
                throw new Error("Main reputation box not found.");
            }
            transactionId = await remove_opinion(
                get(explorer_uri),
                opinionBox,
                mainBox,
            );
        } catch (e: any) {
            setTransactionError(e);
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
            // Filter participations with status "Submitted"
            const submittedParticipations = participations.filter(
                (p) => p.status === "Submitted",
            ) as ValidParticipation[];

            if (submittedParticipations.length === 0) {
                throw new Error("No submitted participations were found.");
            }

            // Select the participation with the highest score
            const omittedParticipation = submittedParticipations.reduce(
                (best, current) => {
                    const bestEffective =
                        game === null
                            ? 0
                            : calculateEffectiveScore(
                                  game,
                                  best.score,
                                  best.creationHeight,
                              );
                    const currentEffective =
                        game === null
                            ? 0
                            : calculateEffectiveScore(
                                  game,
                                  current.score,
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

            // Find the current winner (if any)
            const currentWinner = participations.find(
                (p) =>
                    p.commitmentC_Hex === game.winnerCandidateCommitment &&
                    p.status === "Submitted",
            ) as ValidParticipation | undefined;

            // If the highest score already matches the winner, skip
            if (
                currentWinner &&
                omittedParticipation.commitmentC_Hex ===
                    currentWinner.commitmentC_Hex
            ) {
                console.log(
                    "Highest scoring participation is already the current winner. No action was taken.",
                );
                return;
            }

            // Continue with including omitted participations (even if no winner or if the best candidate differs)
            const userAddress = get(address);
            if (!userAddress) {
                throw new Error("Wallet not connected.");
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

            console.log("Transaction submitted:", transactionId);
        } catch (e: any) {
            setTransactionError(e);
            console.error("Error in handleIncludeOmitted:", e);
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJudgeNomination() {
        if (game?.status !== "Active") return;

        const scoreRaw = judgeReferenceScore_input.trim();
        if (
            !solverId_input ||
            !hashLogs_input ||
            !commitmentC_input ||
            !scoreRaw
        ) {
            errorMessage =
                "Missing reference participation data. Please upload the JSON file or complete the form.";
            return;
        }

        let referenceScore: bigint;
        try {
            referenceScore = BigInt(scoreRaw);
        } catch {
            errorMessage =
                "Invalid reference score. Please enter an integer value.";
            return;
        }

        errorMessage = null;
        isSubmitting = true;
        try {
            const userAddress = get(address);
            const walletErgoTree = userAddress
                ? ErgoAddress.fromBase58(userAddress).ergoTree
                : "";
            const walletErgoTreeHex =
                typeof walletErgoTree === "string"
                    ? walletErgoTree
                    : uint8ArrayToHex(walletErgoTree);

            transactionId = await platform.acceptJudgeNomination(game, {
                commitmentC_hex: commitmentC_input.trim(),
                solverId_hex: solverId_input.trim(),
                seed_hex: judgeReferenceSeed_input.trim() || game.seed,
                score: referenceScore,
                hashLogs_hex: hashLogs_input.trim(),
                ergoTree_hex:
                    judgeReferenceErgoTree_input.trim() ||
                    walletErgoTreeHex.trim(),
            });
        } catch (e: any) {
            setTransactionError(e, {
                fallback: "Error accepting judge nomination.",
            });
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
            setTransactionError(e, {
                fallback: "Error submitting opinion.",
            });
        } finally {
            isSubmitting = false;
        }
    }

    async function handleJsonFileUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        jsonUploadError = null;
        errorMessage = null;
        checksumStatus = null;
        if (target.files && target.files[0]) {
            const file = target.files[0];
            if (file.type === "application/json") {
                try {
                    const fileContent = await file.text();
                    const jsonData = JSON.parse(fileContent);

                    // --- Checksum integrity verification ---
                    if ("checksum" in jsonData && typeof jsonData.checksum === "string") {
                        const expectedChecksum = jsonData.checksum;
                        const { checksum: _, ...dataWithoutChecksum } = jsonData;
                        const canonicalJson = stringifyForChecksum(
                            dataWithoutChecksum,
                        );
                        const computedChecksum = await sha256(canonicalJson);
                        if (computedChecksum !== expectedChecksum) {
                            checksumStatus = 'invalid';
                            jsonUploadError = "Checksum verification failed. The file may have been tampered with. Please provide the data manually.";
                            commitmentC_input = "";
                            solverId_input = "";
                            hashLogs_input = "";
                            judgeReferenceSeed_input = "";
                            judgeReferenceScore_input = "";
                            judgeReferenceErgoTree_input = walletErgoTreeHex;
                            user_score = null;
                            scores_list = [];
                            target.value = "";
                            return;
                        }
                        checksumStatus = 'valid';
                    } else {
                        checksumStatus = 'missing';
                    }

                    // Capture secret if provided in the JSON (helps matching commitments against score lists)

                    if (
                        jsonData.solver_id &&
                        typeof jsonData.solver_id === "string"
                    ) {
                        const uploadedSolverId = jsonData.solver_id.trim();
                        if (
                            participationSolverId &&
                            uploadedSolverId !== participationSolverId.trim()
                        ) {
                            alert(
                                "The uploaded JSON Solver ID does not match the on-chain verified Solver ID.",
                            );
                            jsonUploadError =
                                "Uploaded Solver ID does not match the verified on-chain Solver ID.";
                            commitmentC_input = "";
                            hashLogs_input = "";
                            judgeReferenceSeed_input = "";
                            judgeReferenceScore_input = "";
                            judgeReferenceErgoTree_input = walletErgoTreeHex;
                            user_score = null;
                            scores_list = [];
                            target.value = "";
                            return;
                        }
                        solverId_input = jsonData.solver_id;
                        // After loading solver id, wait a tick so reactive reset runs,
                        // then auto-check on-chain to detect existing solver box.
                        try {
                            await tick();
                            await checkSolverIdBox();
                        } catch (e) {
                            console.warn("Auto checkSolverIdBox failed:", e);
                        }
                    } else throw new Error("Missing 'solver_id'");
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
                        jsonData.seed_hex &&
                        typeof jsonData.seed_hex === "string"
                    ) {
                        judgeReferenceSeed_input = jsonData.seed_hex;
                    } else if (
                        jsonData.seed &&
                        typeof jsonData.seed === "string"
                    ) {
                        judgeReferenceSeed_input = jsonData.seed;
                    }
                    if (
                        jsonData.pbox_ergotree &&
                        typeof jsonData.pbox_ergotree === "string"
                    ) {
                        judgeReferenceErgoTree_input =
                            jsonData.pbox_ergotree;
                    } else if (
                        jsonData.ergoTree_hex &&
                        typeof jsonData.ergoTree_hex === "string"
                    ) {
                        judgeReferenceErgoTree_input =
                            jsonData.ergoTree_hex;
                    } else {
                        judgeReferenceErgoTree_input = walletErgoTreeHex;
                    }
                    if (
                        jsonData.score_list &&
                        Array.isArray(jsonData.score_list) &&
                        jsonData.score_list.every(
                            (item: any) =>
                                typeof item === "number" ||
                                typeof item === "string",
                        )
                    ) {
                        scores_list = jsonData.score_list.map((s: any) => Number(s));
                        if (scores_list.length > 0) {

                            // If we're in the judge nomination flow, show an inline picker instead of a browser prompt
                                if (currentActionType === "accept_judge_nomination") {
                                    if (scores_list.length === 1) {
                                        judgeReferenceScore_input = String(Math.trunc(scores_list[0]));
                                    } else {
                                        // Show the inline score picker UI in the modal (English)
                                        showScorePicker = true;
                                        scorePickerOptions = [...scores_list];
                                        scorePickerSelection = null;
                                        // leave judgeReferenceScore_input empty so user can confirm a selection
                                        judgeReferenceScore_input = "";
                                    }
                                } else {
                                    // Participant flow: store the whole list (as JSON if multiple)
                                    if (scores_list.length === 1) {
                                        user_score = Number(scores_list[0]);
                                    }
                                    scores_list = scores_list;
                                }
                        }
                    } else throw new Error("Missing or invalid 'score_list'");
                } catch (e: any) {
                    jsonUploadError = `Error reading JSON: ${e.message}`;
                    commitmentC_input = "";
                    solverId_input = "";
                    hashLogs_input = "";
                    judgeReferenceSeed_input = "";
                    judgeReferenceScore_input = "";
                    judgeReferenceErgoTree_input = walletErgoTreeHex;
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
            submit_score: `Participate`,
            resolve_game: `Resolve Competition`,
            cancel_game: `Cancel Competition`,
            drain_stake: `Drain Resolver Stake`,
            end_game: `Finalize Competition`,
            invalidate_winner: `Judge Invalidation`,
            judge_unavailable: `Judge Mark Unavailable`,
            include_omitted: `Include Omitted Participation`,
            accept_judge_nomination: isJudge
                ? "Update Judge Reference Participation"
                : "Accept Judge Nomination",
            open_ceremony: "Add Entropy",
            batch_participations: "Batch Participations",
            submit_creator_opinion: "Verify Competition (Creator Opinion)",
            remove_opinion: "Judge Mark Available",
            donate_ceremony: "Donate & Add Entropy",
        };
        modalTitle = titles[type] || "Action";
        errorMessage = null;
        warningMessage = null;
        isSubmitting = false;
        transactionId = null;
        showBotAssistantModal = false;
        showRobotDevelopmentGuideModal = false;

        // Reset guide states
        if (type === "invalidate_winner" || type === "judge_unavailable") {
            showJudgeGuide = true;
        }

        showActionModal = true;

        if (type === "accept_judge_nomination" && game?.status === "Active") {
            if (!judgeReferenceSeed_input) {
                judgeReferenceSeed_input = game.seed;
            }
        }

        if (type === "donate_ceremony" && game?.participationTokenId) {
            const wallet = getErgoWallet();
            if (wallet?.get_balance) {
                wallet.get_balance(game.participationTokenId).then((bal) => {
                    userParticipationTokenBalance = BigInt(bal);
                });
            } else {
                userParticipationTokenBalance = 0n;
            }
            fetch_token_details(game.participationTokenId).then((details) => {
                if (details) tokenDecimals = details.decimals;
            });
        }
    }

    function closeModal() {
        showBotAssistantModal = false;
        showRobotDevelopmentGuideModal = false;
        showActionModal = false;
        currentActionType = null;
        // Ensure inline score picker is reset when closing modal
        showScorePicker = false;
        scorePickerOptions = [];
        scorePickerSelection = null;
    }

    function confirmScorePicker() {
        if (scorePickerSelection !== null) {
            judgeReferenceScore_input = String(Math.trunc(scorePickerSelection));
        }
        showScorePicker = false;
        scorePickerOptions = [];
        scorePickerSelection = null;
    }

    function cancelScorePicker() {
        showScorePicker = false;
        scorePickerOptions = [];
        scorePickerSelection = null;
        // leave judgeReferenceScore_input empty so user can fill manually
        judgeReferenceScore_input = "";
    }

    async function openRobotDevelopmentGuide() {
        showRobotDevelopmentGuideModal = true;
        robotDevelopmentGuideError = null;

        if (robotDevelopmentGuideContent || isRobotDevelopmentGuideLoading) {
            return;
        }

        await fetchRobotGuideForPaper();
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

        // Calculate remaining blocks
        if (targetBlockHeight > 0 && currentHeight > 0) {
            remainingBlocks = Math.max(0, targetBlockHeight - currentHeight);
        }
    }

    function cleanupTimers() {
        if (clockCountdownInterval) clearInterval(clockCountdownInterval);
        clockCountdownInterval = null;
    }

    onMount(async () => {
        await fetchJudges();
        if (game) loadGameDetailsAndTimers();
        // Fetch the robot development guide on page load and ensure it's appended to any paper
        try {
            await fetchRobotGuideForPaper();
        } catch (e) {
            // errors handled in fetchRobotGuideForPaper
        }

        hasHydrated = true;
    });

    onDestroy(() => {
        cleanupTimers();
        unsubscribeGameDetail();
    });

    // Utility to clamp percentages to [0, 100]
    function clampPct(v) {
        return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }

    // === Prize distribution calculations ===
    // Base data per game type
    let totalPct = 0;
    let winnerPct = 0;
    let overAllocated = 0;
    let resolverPct = 0;
    let judgesTotalPct = 0;
    let developersPct = 0;
    let creatorSlashRatioPct = 0;
    let showTrophyIncentive = false;
    let showTimeFactorIncentive = false;
    $: showTrophyIncentive =
        !!game && game.status !== GameState.Cancelled_Draining;
    $: showTimeFactorIncentive =
        !!game &&
        (game.status === GameState.Active ||
            game.status === GameState.Resolution) &&
        game.timeWeight > 0n;

    // --- Image Resolution Logic ---
    let resolvedImageSrc = game?.content?.imageURL ?? "";
    $: {
        if (game?.content?.image) {
            resolvedImageSrc =
                imageSources.map(getSourceUrl).find((url) => !!url) ??
                (game?.content.imageURL ?? "");
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
    const guideRenderer = new marked.Renderer();
    guideRenderer.heading = function ({
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

    function extractGuideToc(markdown: string) {
        const lines = markdown.split("\n");
        const toc: { level: number; text: string; id: string }[] = [];
        const headerRegex = /^(#{1,6})\s+(.*)$/;

        lines.forEach((line) => {
            const match = line.match(headerRegex);
            if (match) {
                const level = match[1].length;
                const text = match[2].trim();
                const id = text
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, "")
                    .replace(/\s+/g, "-");
                toc.push({ level, text, id });
            }
        });

        robotGuideToc = toc;
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

    function toggleRobotGuide() {
        isRobotGuideExpanded = !isRobotGuideExpanded;
        if (!isRobotGuideExpanded) {
            const element = document.getElementById("robot-guide-start");
            if (element) {
                element.scrollIntoView({ behavior: "smooth" });
            }
        }
    }

    function scrollToRobotToc() {
        const element = document.getElementById("robot-guide-toc");
        if (element) {
            element.scrollIntoView({ behavior: "smooth" });
        } else {
            const startElement = document.getElementById("robot-guide-start");
            if (startElement) startElement.scrollIntoView({ behavior: "smooth" });
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

<SolverSourceModal
    bind:open={showSolverModal}
    solverId={selectedSolverId}
    sources={selectedSolverSources}
    profile={$reputation_proof}
    explorerUri={$explorer_uri}
    sourceExplorerUrl={$source_explorer_url}
    webExplorerUriTkn={$web_explorer_uri_tkn}
/>

{#if showLoadingScreen}
    <div
        class="flex flex-col items-center justify-center min-h-screen bg-background text-foreground"
    >
        <Loader2 class="w-12 h-12 animate-spin mb-4 text-green-500" />
        <p class="text-xl font-semibold opacity-80">Loading game...</p>
    </div>
{:else if game}
    <div
        class="game-detail-page min-h-screen bg-background text-foreground"
    >
        <div
            class="game-container w-full md:max-w-[95%] mx-auto px-0 md:px-4 lg:px-8 py-0 md:py-8"
        >
            <section
                class="hero-section relative md:rounded-xl md:shadow-2xl overflow-hidden mb-6 md:mb-12"
            >
                <div class="hero-bg-image absolute inset-0">
                    {#if resolvedImageSrc}
                        <img
                            src={resolvedImageSrc}
                            alt=""
                            class="hero-bg-layer absolute inset-0 w-full h-full object-cover blur-md scale-110"
                        />
                    {/if}
                    <div
                        class="absolute inset-0 bg-slate-900/40 backdrop-brightness-75"
                    ></div>
                </div>

                <div
                    class="relative z-10 p-4 md:p-12 flex flex-col md:flex-row gap-8 items-center text-white"
                >
                    {#if resolvedImageSrc}
                        <div class="w-full md:w-1/3 flex-shrink-0">
                            <img
                                src={resolvedImageSrc}
                                alt="{game.content.title} banner"
                                class="hero-main-image w-full h-auto max-h-64 md:max-h-96 object-contain rounded-lg shadow-2xl border border-white/10"
                            />
                        </div>
                    {/if}

                    <div
                        class="flex-1 text-center md:text-left w-full mt-6 md:mt-0"
                    >
                        <h1
                            class="text-3xl sm:text-4xl lg:text-5xl font-bold font-['Russo_One'] mb-8 tracking-tight text-white drop-shadow-[0_2px_10px_rgba(255,255,255,0.3)]"
                        >
                            {game.content.title}
                        </h1>

                        <div
                            class="stat-blocks-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full"
                        >
                            {#each [{ label: "Reputation", value: game.reputation.toFixed(4), icon: Users, color: "text-blue-300", info: "The game's reputation score is the sum of ERG sacrificed per reputation proof from judges and the creator." }, { label: "Entry Fee", value: `${formatTokenBigInt(getParticipationFee(game), tokenDecimals)} ${tokenSymbol}`, icon: Edit, color: "text-emerald-300", info: "The cost each player must pay..." }, { label: "Participants", value: participations.length, icon: Users, color: "text-purple-300" }, { label: "Prize Pool", value: `${formatTokenBigInt(prizePoolValue, tokenDecimals)} ${tokenSymbol}`, icon: Trophy, color: "text-yellow-300", info: "The accumulated funds available for the winner (fees + donations), after subtracting judge, resolver, and contract developer commissions and the resolver stake." }, { label: "Creator Stake", value: `${formatTokenBigInt(getDisplayStake(game), tokenDecimals)} ${tokenSymbol}`, icon: ShieldCheck, color: "text-cyan-300", info: "Guarantee deposited by the creator..." }, { label: "Commissions", value: `${totalPct}%`, icon: CheckSquare, color: "text-pink-300", info: "Percentage of the Prize Pool that goes to commissions" }] as stat}
                                <div
                                    class="group relative flex flex-col justify-between p-5 rounded-xl border border-slate-600/50 bg-slate-800/80 backdrop-blur-md transition-all duration-300 hover:bg-slate-700/80"
                                >
                                    <div
                                        class="relative z-10 flex items-center justify-between mb-3"
                                    >
                                        <div class="flex items-center gap-2">
                                            <svelte:component
                                                this={stat.icon}
                                                class="w-5 h-5 md:w-4 md:h-4 {stat.color}"
                                            />
                                            <span
                                                class="text-[11px] md:text-[10px] uppercase tracking-[0.2em] font-black text-white/90"
                                                >{stat.label}</span
                                            >
                                        </div>
                                        {#if stat.info}
                                            <button
                                                type="button"
                                                class="text-white/50 hover:text-white p-2 -mr-2 -mt-2 transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        stat.label,
                                                        stat.info,
                                                    )}
                                            >
                                                <Info
                                                    class="w-5 h-5 md:w-4 md:h-4"
                                                />
                                            </button>
                                        {/if}
                                    </div>
                                    <div
                                        class="relative z-10 text-2xl md:text-xl font-bold text-white drop-shadow-md"
                                    >
                                        {stat.value}
                                    </div>
                                </div>
                            {/each}

                            {#if createdDateDisplay}
                                <div
                                    class="group relative flex flex-col justify-between p-5 rounded-xl border border-slate-600/50 bg-slate-800/80 backdrop-blur-md transition-all duration-300 hover:bg-slate-700/80"
                                >
                                    <div class="flex items-center gap-2 mb-3">
                                        <Calendar
                                            class="w-5 h-5 md:w-4 md:h-4 text-blue-300"
                                        />
                                        <span
                                            class="text-[11px] md:text-[10px] uppercase tracking-[0.2em] font-black text-white/90"
                                            >Created At</span
                                        >
                                    </div>
                                    <div
                                        class="text-2xl md:text-xl font-bold text-white"
                                    >
                                        {createdDateDisplay}
                                    </div>
                                </div>
                            {/if}

                            <div
                                class="group relative flex flex-col justify-between p-5 rounded-xl border border-slate-600/50 bg-slate-800/80 backdrop-blur-md transition-all duration-300 hover:bg-slate-700/80"
                            >
                                <div
                                    class="flex items-center justify-between mb-3"
                                >
                                    <div class="flex items-center gap-2">
                                        <Calendar
                                            class="w-5 h-5 md:w-4 md:h-4 text-purple-300"
                                        />
                                        <span
                                            class="text-[11px] md:text-[10px] uppercase tracking-[0.2em] font-black text-white/90"
                                            >{clockLabel}</span
                                        >
                                    </div>
                                    <button
                                        type="button"
                                        class="text-white/40 hover:text-white p-2 -mr-2 -mt-2"
                                        on:click|stopPropagation={() =>
                                            openDidacticModal(
                                                clockLabel,
                                                clockInformation,
                                            )}
                                    >
                                        <Info class="w-5 h-5 md:w-4 md:h-4" />
                                    </button>
                                </div>
                                <div class="flex flex-col">
                                    <span
                                        class="text-2xl md:text-xl font-bold text-white"
                                    >
                                        {deadlineDateDisplay.split(" at ")[0]}
                                    </span>
                                    <span
                                        class="text-[10px] md:text-[9px] font-mono text-white/40 mt-1 uppercase tracking-tighter"
                                    >
                                        Block: {game.status == "Active"
                                            ? game.deadlineBlock
                                            : "N/A"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div
                            class="mt-10 flex flex-col sm:flex-row items-center justify-center md:justify-start gap-4"
                        >
                            {#if game.content.webLink}
                                <a
                                    href={game.content.webLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="w-full sm:w-auto"
                                >
                                    <Button
                                        class="w-full text-base bg-slate-800/80 hover:bg-slate-700/80 text-white font-bold backdrop-blur-md border border-slate-600/50 py-6 px-8 transition-all"
                                    >
                                        <ExternalLink class="mr-2 h-5 w-5" />
                                        Visit Game Site
                                    </Button>
                                </a>
                            {/if}

                            <Button
                                on:click={shareGame}
                                class="w-full sm:w-auto text-sm text-white bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-md py-2 px-4 transition-all"
                                style="background-color: rgba(255, 255, 255, 0.05) !important; border-color: rgba(255, 255, 255, 0.1) !important; color: white !important;">
                                <Share2 class="mr-2 h-4 w-4" />
                                Share Game
                            </Button>
                        </div>
                    </div>
                </div>
            </section>
        </div>

        {#if showTrophyIncentive}
            <div class="w-full md:max-w-[95%] mx-auto px-0 md:px-4 lg:px-8">
                <section
                    class="mb-6 md:mb-8 overflow-hidden rounded-none md:rounded-xl border-y md:border border-border/60 bg-card shadow-[0_10px_28px_rgba(0,0,0,0.12)]"
                >
                    <div
                        class="flex flex-col lg:flex-row lg:items-center gap-4 px-4 py-4 md:px-6 md:py-5 bg-[radial-gradient(circle_at_top_left,rgba(74,222,128,0.10),transparent_40%)]"
                    >
                        <div
                            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-green-400/20 bg-green-400/10 text-green-400"
                        >
                            <Trophy class="h-5 w-5" />
                        </div>

                        <div class="flex-1 space-y-2">
                            <div
                                class="inline-flex items-center gap-2 rounded-full border border-green-400/25 bg-green-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-green-500"
                            >
                                <Sparkles class="h-3.5 w-3.5" />
                                Winner Incentive
                            </div>

                            <p class="text-sm md:text-[15px] text-foreground/90">
                                {#if game.status === GameState.Finalized}
                                    This competition NFT was awarded to the
                                    winner as a trophy, in addition to the
                                    economic prize.
                                {:else}
                                    The winner also receives the competition
                                    NFT as a trophy, on top of the economic
                                    prize.
                                {/if}
                            </p>

                            {#if showTimeFactorIncentive}
                                <div
                                    class="inline-flex max-w-full items-start gap-2 rounded-xl border border-border/70 bg-background/65 px-3 py-2 text-sm text-muted-foreground"
                                >
                                    <Clock3 class="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                                    <span>
                                        Uploading the robot earlier increases
                                        the effective score via the time
                                        factor, so earlier submissions can earn
                                        more points.
                                    </span>
                                </div>
                            {/if}
                        </div>
                    </div>
                </section>
            </div>
        {/if}

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

                            {#if !isDevFriendly(game)}
                                <div
                                    class="mt-6 border-l-4 border-amber-500/50 bg-amber-500/10 pl-6 pr-4 py-4 text-sm text-amber-700 dark:text-amber-300 rounded-r"
                                >
                                    <p
                                        class="font-semibold text-base flex items-center gap-2"
                                    >
                                        <AlertTriangle class="w-5 h-5" />
                                        Not Respecting Platform Developers
                                    </p>
                                    <p class="mt-2 leading-relaxed">
                                        This game doesn't follow the platform's
                                        developer commission guidelines.
                                        However, as an open platform, it will be
                                        treated equally with all other games.
                                    </p>
                                </div>
                            {/if}

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
                                            class="paper-prose prose prose-sm {$mode ===
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
                            {:else if game.content.paper && game.content.paper.length === 64}
                                <div class="mt-8 border-t border-border pt-8">
                                    <div class="flex items-center gap-2 mb-2">
                                        <FileText
                                            class="w-5 h-5 text-amber-500"
                                        />
                                        <h3 class="text-lg font-semibold">
                                            Paper Content
                                        </h3>
                                    </div>

                                    <p class="text-sm text-muted-foreground">
                                        {#if paperContentStatus === "missing-sources"}
                                            The game includes a paper hash, but
                                            nobody has published a downloadable
                                            source for it yet.
                                        {:else if paperContentStatus === "fetch-error"}
                                            The paper source exists, but its
                                            content could not be loaded for
                                            inline inspection.
                                        {:else if paperContentStatus === "loading"}
                                            Loading paper content...
                                        {:else}
                                            Paper content is not available for
                                            inline inspection yet.
                                        {/if}
                                    </p>
                                </div>
                            {/if}

                            {#if robotDevelopmentGuideContent}
                                <div
                                    class="mt-8 border-t border-border pt-8"
                                    id="robot-guide-start"
                                >
                                    <div class="flex items-center gap-2 mb-4">
                                        <Code class="w-5 h-5 text-amber-500" />
                                        <h3 class="text-lg font-semibold">
                                            Robot Development Guide
                                        </h3>
                                    </div>

                                    <div class="relative">
                                        <div
                                            class="guide-prose prose prose-sm {$mode === 'dark' ? 'prose-invert' : ''} max-w-none transition-all duration-500 ease-in-out {isRobotGuideExpanded ? '' : 'max-h-96 overflow-hidden'}"
                                        >
                                            {#if isRobotGuideExpanded && robotGuideToc.length > 0}
                                                <div
                                                    class="mb-6 p-4 bg-muted/50 rounded-lg"
                                                    id="robot-guide-toc"
                                                >
                                                    <h4
                                                        class="text-sm font-semibold mb-2 uppercase tracking-wider text-muted-foreground"
                                                    >
                                                        Table of Contents
                                                    </h4>
                                                    <nav class="flex flex-col gap-1">
                                                        {#each robotGuideToc as item}
                                                            <button
                                                                class="text-left text-sm hover:text-primary transition-colors truncate w-full"
                                                                style="padding-left: {(item.level - 1) * 12}px"
                                                                on:click={() => scrollToSection(item.id)}
                                                            >
                                                                {item.text}
                                                            </button>
                                                        {/each}
                                                    </nav>
                                                </div>
                                            {/if}

                                            {@html marked.parse(robotDevelopmentGuideContent, {
                                                renderer: guideRenderer,
                                            })}
                                        </div>

                                        {#if !isRobotGuideExpanded}
                                            <div
                                                class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent flex items-end justify-center pb-4"
                                            >
                                                <Button
                                                    variant="secondary"
                                                    on:click={toggleRobotGuide}
                                                    class="shadow-lg"
                                                >
                                                    Read Full Paper
                                                    <ChevronDown class="ml-2 w-4 h-4" />
                                                </Button>
                                            </div>
                                        {/if}
                                    </div>

                                    {#if isRobotGuideExpanded}
                                        <div class="sticky bottom-20 flex justify-center mt-8 pointer-events-none gap-4 z-10">
                                            <Button
                                                variant="secondary"
                                                on:click={scrollToRobotToc}
                                                class="shadow-lg pointer-events-auto opacity-90 hover:opacity-100"
                                                title="Back to Table of Contents"
                                            >
                                                <ArrowUp class="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                on:click={toggleRobotGuide}
                                                class="shadow-lg pointer-events-auto opacity-90 hover:opacity-100"
                                            >
                                                Collapse Paper
                                                <ChevronDown class="ml-2 w-4 h-4 rotate-180" />
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
                                        <Music class="w-5 h-5 text-red-500" />
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
                                    style:width={`${clampPct(winnerPct)}%`}
                                    title={`Winner(s): ${winnerPct.toFixed(2)}%`}
                                ></div>
                                <div
                                    class="bar-segment creator"
                                    style:width={`${clampPct(resolverPct)}%`}
                                    title={`Creator: ${resolverPct.toFixed(2)}%`}
                                ></div>
                                <div
                                    class="bar-segment judges"
                                    style:width={`${clampPct(judgesTotalPct)}%`}
                                    title={`Judges Total: ${judgesTotalPct.toFixed(2)}%`}
                                ></div>
                                <div
                                    class="bar-segment developers"
                                    style:width={`${clampPct(developersPct)}%`}
                                    title={`Dev Fund: ${developersPct.toFixed(2)}%`}
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
                                            : "Creator"} ({resolverPct.toFixed(
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
                                bind:open={technicalDetailsOpen}
                                use:hoverCornersWhenClosed={technicalDetailsOpen}
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
                                            >Creator Splash Ratio</span
                                        >
                                        <span class="info-value font-mono">
                                            {clampPct(creatorSlashRatioPct).toFixed(
                                                0,
                                            )}%
                                        </span>
                                    </div>

                                    <div class="info-block">
                                        <span class="info-label"
                                            >Verification Runs<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Verification Runs",
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
                                            >Time Factor<button
                                                type="button"
                                                class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                on:click|stopPropagation={() =>
                                                    openDidacticModal(
                                                        "Time Factor",
                                                        "Weight used to reward earlier submissions when computing effective score. A higher value increases the advantage of uploading sooner.",
                                                    )}
                                            >
                                                <Info class="w-3.5 h-3.5" />
                                            </button></span
                                        >
                                        <span
                                            class="info-value font-mono text-xs break-all"
                                        >
                                            {game.timeWeight?.toString() ?? "0"}
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

                                    {#if game.winnerCandidateCommitment}
                                        <div class="info-block md:col-span-2">
                                            <span class="info-label"
                                                >Winner Candidate<button
                                                    type="button"
                                                    class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                    on:click|stopPropagation={() =>
                                                        openDidacticModal(
                                                            "Winner Candidate",
                                                            "The commitment of the participation currently considered the winner candidate.",
                                                        )}
                                                >
                                                    <Info class="w-3.5 h-3.5" />
                                                </button></span
                                            >
                                            <span
                                                class="info-value font-mono text-xs break-all"
                                            >
                                                {game.winnerCandidateCommitment}
                                            </span>
                                        </div>
                                    {/if}

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

                                    {#if game.status === "Resolution"}
                                        <div class="info-block md:col-span-2">
                                            <span class="info-label"
                                                >Resolver Script<button
                                                    type="button"
                                                    class="inline-flex items-center justify-center ml-1 p-0.5 text-gray-400 hover:text-white transition-colors"
                                                    on:click|stopPropagation={() =>
                                                        openDidacticModal(
                                                            "Resolver Script",
                                                            "The script that enforces the game rules during the resolution phase.",
                                                        )}
                                                >
                                                    <Info class="w-3.5 h-3.5" />
                                                </button></span
                                            >
                                            <span
                                                class="info-value font-mono text-xs break-all"
                                            >
                                                {game.resolverScript_Hex}
                                            </span>
                                        </div>
                                    {/if}
                                </div>
                            </details>
                        </div>

                        <!-- FILE SOURCES SECTIONS -->
                        {#if game.content.image && game.content.image.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    bind:open={imageSourcesOpen}
                                    use:hoverCornersWhenClosed={imageSourcesOpen}
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
                                                >{game.content.image.slice(
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
                                                        game.content.image,
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
                                                fileHash={game.content.image}
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
                                    bind:open={serviceSourcesOpen}
                                    use:hoverCornersWhenClosed={serviceSourcesOpen}
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
                                                class="w-5 h-5 text-green-500"
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

                                        <!-- service-purple: override source-application's hardcoded green with purple -->
                                        <div class="service-file-card-wrapper">
                                            <FileCard
                                                profile={$reputation_proof}
                                                fileHash={game.content.serviceId}
                                                sources={serviceSources}
                                                explorerUri={$explorer_uri}
                                                source_explorer_url={$source_explorer_url}
                                                webExplorerUriTkn={$web_explorer_uri_tkn}
                                            />
                                        </div>
                                    </div>
                                </details>
                            </div>
                        {/if}

                        {#if game.content.paper && game.content.paper.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    bind:open={paperSourcesOpen}
                                    use:hoverCornersWhenClosed={paperSourcesOpen}
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
                                                        game?.content.paper ??
                                                            "",
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

                                        <div class="service-file-card-wrapper">
                                            <FileCard
                                                profile={$reputation_proof}
                                                fileHash={game.content.paper}
                                                sources={paperSources}
                                                explorerUri={$explorer_uri}
                                                source_explorer_url={$source_explorer_url}
                                                webExplorerUriTkn={$web_explorer_uri_tkn}
                                            />
                                        </div>

                                        {#if paperContentStatus === "missing-sources"}
                                            <p
                                                class="text-xs text-muted-foreground italic text-center py-2"
                                            >
                                                The paper hash exists, but no
                                                downloadable source has been
                                                published yet, so its content
                                                cannot be inspected here.
                                            </p>
                                        {:else if paperContentStatus === "fetch-error"}
                                            <p
                                                class="text-xs text-muted-foreground italic text-center py-2"
                                            >
                                                A paper source was found, but
                                                its markdown could not be loaded
                                                for inline inspection.
                                            </p>
                                        {/if}
                                    </div>
                                </details>
                            </div>
                        {/if}

                        {#if game.content.soundtrack && game.content.soundtrack.length === 64}
                            <div
                                class="col-span-1 md:col-span-2 lg:col-span-3 mt-4"
                            >
                                <details
                                    bind:open={soundtrackSourcesOpen}
                                    use:hoverCornersWhenClosed={soundtrackSourcesOpen}
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
                                                class="w-5 h-5 text-red-500"
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
                                                        game?.content
                                                            .soundtrack ?? "",
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

                                        <div class="service-file-card-wrapper">
                                            <FileCard
                                                profile={$reputation_proof}
                                                fileHash={game.content.soundtrack}
                                                sources={soundtrackSources}
                                                explorerUri={$explorer_uri}
                                                source_explorer_url={$source_explorer_url}
                                                webExplorerUriTkn={$web_explorer_uri_tkn}
                                            />
                                        </div>
                                    </div>
                                </details>
                            </div>
                        {/if}
                    </div>
                {/if}
            </section>

            <section
                class="game-status status-actions-panel mb-12 p-6 md:p-8 shadow-lg rounded-xl bg-card border border-border/50"
            >
                <div class="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 class="text-2xl font-semibold">Game Progress</h2>
                        <p class="mt-1 text-sm text-muted-foreground">
                            Start with the essentials, then open details when you want the deeper technical view.
                        </p>
                    </div>
                    <Button
                        variant={showProgressDetails ? "secondary" : "outline"}
                        size="sm"
                        on:click={() => (showProgressDetails = !showProgressDetails)}
                        class="self-start"
                    >
                        {showProgressDetails ? "Hide Details" : "Detalles"}
                        <ChevronDown
                            class={`ml-2 h-4 w-4 transition-transform ${showProgressDetails ? "rotate-180" : ""}`}
                        />
                    </Button>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    <div class="status-side space-y-5">
                        <div
                            class="rounded-2xl border {$mode === 'dark'
                                ? 'border-slate-700 bg-slate-900/40'
                                : 'border-gray-200 bg-white'} p-5 md:p-6"
                        >
                            <div
                                class="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]"
                            >
                                <div class="min-w-0">
                                    <div class="flex items-start gap-3">
                                        <div
                                            class={`p-3 rounded-2xl shrink-0 ${phaseTone.iconBg}`}
                                        >
                                            <svelte:component
                                                this={phaseIcon}
                                                class="w-6 h-6"
                                            />
                                        </div>
                                        <div class="min-w-0">
                                            <p
                                                class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"
                                            >
                                                Current Snapshot
                                            </p>
                                            <div
                                                class="mt-2 flex flex-wrap items-center gap-2"
                                            >
                                                <span
                                                    class={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] ${phaseTone.contractBadge}`}
                                                >
                                                    {gamePhase.contractLabel}
                                                </span>
                                                <h3
                                                    class={`text-xl font-bold leading-tight ${phaseTone.titleText}`}
                                                >
                                                    {gamePhase.title}
                                                </h3>
                                            </div>
                                            <p
                                                class="mt-3 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400"
                                            >
                                                {gamePhase.description}
                                            </p>
                                        </div>
                                    </div>

                                    {#if shouldShowCountdown}
                                        <div
                                            data-hover-corners
                                            class="countdown-container mt-5 rounded-2xl border {$mode ===
                                            'dark'
                                                ? 'border-slate-700 bg-slate-950/30'
                                                : 'border-gray-200 bg-gray-50/80'} p-4 md:p-5"
                                        >
                                            <div class="timeleft">
                                                <div class="timeleft-header">
                                                    <span
                                                        class="timeleft-label-icon"
                                                    >
                                                        <Clock3 class="w-4 h-4" />
                                                    </span>
                                                    <span class="timeleft-label">
                                                        {clockLabel}
                                                    </span>
                                                </div>
                                                {#if remainingBlocks > 0}
                                                    <span class="text-xs opacity-70 mt-1 block">
                                                        Estimated time ({remainingBlocks}
                                                        blocks remaining, ~{platform
                                                            .time_per_block /
                                                            1000 /
                                                            60} min/block)
                                                    </span>
                                                {/if}
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
                                </div>

                                <div
                                    data-hover-corners
                                    class="rounded-2xl border {$mode === 'dark'
                                        ? 'border-slate-700 bg-slate-950/20'
                                        : 'border-gray-200 bg-gray-50/70'} p-4 md:p-5"
                                >
                                    <p
                                        class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"
                                    >
                                        At a Glance
                                    </p>

                                    <div class="mt-4 space-y-4">
                                        <div class="flex flex-col gap-2">
                                            <p
                                                class="text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"
                                            >
                                                On-chain state
                                            </p>
                                            <p class="text-base font-semibold">
                                                {gamePhase.contractLabel}
                                            </p>
                                        </div>

                                        <div class="flex flex-col gap-2">
                                            <p
                                                class="text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"
                                            >
                                                UI subphase
                                            </p>
                                            <p class="text-base font-semibold">
                                                {gamePhase.label}
                                            </p>
                                        </div>

                                        <div class="flex flex-col gap-2">
                                            <p
                                                class="text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"
                                            >
                                                Next milestone
                                            </p>
                                            <p
                                                class="text-base font-semibold leading-snug"
                                            >
                                                {currentMilestoneTitle}
                                            </p>
                                            <p
                                                class="text-xs leading-5 text-gray-500 dark:text-gray-400"
                                            >
                                                {currentMilestoneDescription}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {#if showProgressDetails}
                        <div
                            class="rounded-2xl border {$mode === 'dark'
                                ? 'border-slate-700 bg-slate-900/40'
                                : 'border-gray-200 bg-white'} p-5 md:p-6"
                        >
                            <div
                                class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
                            >
                                <div>
                                    <p
                                        class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"
                                    >
                                        Subphase Progression
                                    </p>
                                    <p
                                        class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                                    >
                                        These frontend subphases explain where
                                        the game sits inside the current
                                        contract state.
                                    </p>
                                </div>
                                <div
                                    class="flex flex-wrap items-center gap-2"
                                >
                                    <span
                                        class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-gray-700 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                        {gamePhase.contractLabel}
                                    </span>
                                    <span class="text-sm font-semibold">
                                        {gamePhase.label}
                                    </span>
                                </div>
                            </div>

                            <div class="mt-5 space-y-3">
                                {#each currentSubphaseSequence as subphase, index (subphase)}
                                    <div
                                        data-hover-corners
                                        class={`rounded-xl border p-4 md:p-5 ${getSubphaseCardClasses(
                                            gamePhase,
                                            subphase,
                                        )}`}
                                    >
                                        <div
                                            class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
                                        >
                                            <div
                                                class="flex items-start gap-4 min-w-0"
                                            >
                                                <div
                                                    class={`inline-flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold shrink-0 ${getSubphaseIndexClasses(
                                                        gamePhase,
                                                        subphase,
                                                    )}`}
                                                >
                                                    {index + 1}
                                                </div>
                                                <div class="min-w-0">
                                                    <div
                                                        class="flex flex-wrap items-center gap-2"
                                                    >
                                                        <p
                                                            class="text-base font-semibold leading-tight"
                                                        >
                                                            {
                                                                GAME_PHASE_DEFINITIONS[
                                                                    subphase
                                                                ].label
                                                            }
                                                        </p>
                                                        <span
                                                            class={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getSubphaseStatusBadgeClasses(
                                                                gamePhase,
                                                                subphase,
                                                            )}`}
                                                        >
                                                            {getSubphaseStatusLabel(
                                                                gamePhase,
                                                                subphase,
                                                            )}
                                                        </span>
                                                    </div>
                                                    <p
                                                        class="mt-2 text-sm leading-6 opacity-80"
                                                    >
                                                        {SUBPHASE_HINTS[subphase]}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </div>
                        {/if}
                    </div>

                    <div
                        class="actions-side space-y-5"
                    >
                        {#if showProgressDetails}
                        <div
                            class="rounded-2xl border {$mode === 'dark'
                                ? 'border-slate-700 bg-slate-900/40'
                                : 'border-gray-200 bg-white'} p-5 md:p-6"
                        >
                            <div
                                class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
                            >
                                <div>
                                    <p
                                        class="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"
                                    >
                                        Contract Lifecycle
                                    </p>
                                    <p
                                        class="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400"
                                    >
                                        The contract only moves through three
                                        main states. FINALIZED is the frontend
                                        end state after the successful path pays
                                        out.
                                    </p>
                                </div>
                                <span
                                    class="text-xs uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500"
                                >
                                    Canonical contract path
                                </span>
                            </div>

                            <div
                                class="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch"
                            >
                                {#each mainContractStateCards as card, index (card.id)}
                                    <div
                                        data-hover-corners
                                        class={`rounded-xl p-4 ${getContractCardClasses(
                                            card,
                                            gamePhase,
                                        )}`}
                                    >
                                        <div class="flex items-start gap-4">
                                            <div
                                                class="flex items-start gap-3 min-w-0 flex-1"
                                            >
                                                <div
                                                    class={`inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold shrink-0 ${getContractStateMeta(
                                                        card.id,
                                                    ).accent}`}
                                                >
                                                    {index + 1}
                                                </div>
                                                <div class="min-w-0">
                                                    <div
                                                        class="flex flex-wrap items-center gap-2"
                                                    >
                                                        <p
                                                            class="text-[10px] uppercase tracking-[0.18em] opacity-70"
                                                        >
                                                            {getContractStateMeta(
                                                                card.id,
                                                            ).eyebrow}
                                                        </p>
                                                        <span
                                                            class={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${getContractBadgeClasses(
                                                                card,
                                                            )}`}
                                                        >
                                                            {card.badge}
                                                        </span>
                                                    </div>
                                                    <div
                                                        class="mt-2 flex items-center gap-2"
                                                    >
                                                        <svelte:component
                                                            this={card.icon}
                                                            class="w-4 h-4 shrink-0"
                                                        />
                                                        <span
                                                            class="text-sm font-semibold leading-tight"
                                                            >{card.label}</span
                                                        >
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <p
                                            class="mt-4 text-sm leading-6 opacity-80"
                                        >
                                            {card.description}
                                        </p>
                                    </div>

                                    {#if index < mainContractStateCards.length - 1}
                                        <div
                                            class="hidden md:flex items-center justify-center text-gray-300 dark:text-slate-600"
                                            aria-hidden="true"
                                        >
                                            <ArrowRight class="w-5 h-5" />
                                        </div>
                                    {/if}
                                {/each}
                            </div>

                            {#if alternativeContractCard}
                                <div
                                    data-hover-corners
                                    class="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50/80 dark:border-slate-700 dark:bg-slate-900/45 p-4"
                                >
                                    <div
                                        class="flex flex-col gap-3 sm:flex-row sm:items-start"
                                    >
                                        <div
                                            class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200 shrink-0"
                                        >
                                            <XCircle class="w-5 h-5" />
                                        </div>
                                        <div class="min-w-0">
                                            <div
                                                class="flex flex-wrap items-center gap-2"
                                            >
                                                <span
                                                    class="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-200"
                                                >
                                                    Alternative branch
                                                </span>
                                                <span
                                                    class="text-sm font-semibold text-gray-900 dark:text-slate-100"
                                                >
                                                    {alternativeContractCard.label}
                                                </span>
                                                <span
                                                    class="text-[10px] uppercase tracking-[0.18em] text-gray-500 dark:text-slate-400"
                                                >
                                                    Exits from ACTIVE
                                                </span>
                                            </div>
                                            <p
                                                class="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-300"
                                            >
                                                {alternativeContractCard.description}
                                                This path is only taken if the
                                                secret is revealed too early.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                        {/if}

                        {#if showProgressDetails}
                        <div
                            class="status-description rounded-xl border bg-card overflow-hidden {$mode ===
                        'dark'
                            ? 'border-slate-700'
                            : 'border-gray-200'} shadow-sm"
                        >
                        <div class="p-4">
                            <p
                                class="text-sm leading-6 text-gray-500 dark:text-gray-400"
                            >
                                The platform is currently in
                                <span class="font-medium text-gray-900 dark:text-gray-100">
                                    {gamePhase.title}</span
                                >. These are the actions that are allowed and
                                disallowed right now.
                            </p>
                        </div>

                        <!-- Content Grid: Allowed vs Restricted -->

                        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 p-4">
                            <!-- Allowed Actions -->
                            <div
                                data-hover-corners
                                class="rounded-xl border border-green-100 bg-green-50/70 dark:border-green-900/40 dark:bg-green-950/20 p-4"
                            >
                                <h4
                                    class="text-sm font-semibold uppercase tracking-wider text-green-600 dark:text-green-400 mb-3 flex items-center"
                                >
                                    <CheckCircle class="w-4 h-4 mr-2" />
                                    What can happen?
                                </h4>
                                <ul class="space-y-2">
                                    {#each allowedPhaseActions as action}
                                        <li
                                            class="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300"
                                        >
                                            <span
                                                class="font-medium text-gray-900 dark:text-gray-100"
                                                >{action.actor}:</span
                                            > {action.text}
                                        </li>
                                    {/each}
                                </ul>
                            </div>

                            <!-- Restricted Actions -->
                            <div
                                data-hover-corners
                                class="rounded-xl border border-red-100 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20 p-4"
                            >
                                <h4
                                    class="text-sm font-semibold uppercase tracking-wider text-red-500 dark:text-red-400 mb-3 flex items-center"
                                >
                                    <XCircle class="w-4 h-4 mr-2" />
                                    What cannot happen?
                                </h4>
                                <ul class="space-y-2">
                                    {#each restrictedPhaseActions as action}
                                        <li
                                            class="text-sm flex items-start gap-2 text-gray-500 dark:text-gray-400"
                                        >
                                            <span class="font-medium"
                                                >{action.actor}:</span
                                            > {action.text}
                                        </li>
                                    {/each}
                                </ul>
                            </div>
                        </div>

                        </div>
                        {/if}

                        <div
                            class="rounded-2xl border {$mode === 'dark'
                                ? 'border-slate-700 bg-slate-900/40'
                                : 'border-gray-200 bg-white'} p-5 md:p-6"
                        >
                            <h2 class="text-xl font-semibold mb-5">
                                {showProgressDetails ? "Trust & Security" : "Trust Snapshot"}
                            </h2>

                            <div class="grid grid-cols-1 gap-y-6">
                        {#if riskLevel === "Low"}
                            <div class="info-block">
                                <div
                                    data-hover-corners
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
                                        jury system with {uniqueJudges.length}
                                        unique judges. The creator cannot arbitrarily
                                        decide the winner; a majority of judges must
                                        agree.
                                    </p>
                                </div>
                            </div>
                        {:else if riskLevel === "Medium"}
                            <div class="info-block">
                                <div
                                    data-hover-corners
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
                                    data-hover-corners
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
                                            {:else if game.status === "Active" && acceptedJudgeNominations && !acceptedJudgeNominations.includes(judge)}
                                                <span class="text-yellow-500">
                                                    (pending)</span
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
                        class:active={activeTab === "history"}
                        on:click={() => (activeTab = "history")}
                    >
                        History
                    </button>
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

                {#if activeTab === "history"}
                    <div class="space-y-8">
                        <GameTimeline
                            history={gameHistory}
                            currentGame={game}
                            {currentHeight}
                            {participations}
                        />
                    </div>
                {:else if activeTab === "participations"}
                    {#if participations && participations.length > 0}
                        <div class="flex flex-col gap-6">
                            {#each participations as p (p.boxId)}
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
                                {@const isCurrentParticipationWinner =
                                    (game.status === "Resolution" ||
                                        game.status === "EndGame" ||
                                        game.status === "Finalized") &&
                                    game.winnerCandidateCommitment ===
                                        p.commitmentC_Hex &&
                                    actualScoreForThisParticipation !== null}
                                {@const effectiveScore =
                                    actualScoreForThisParticipation !== null
                                        ? calculateEffectiveScore(
                                              game,
                                              actualScoreForThisParticipation,
                                              p.solverIdBox?.creationHeight ??
                                                  0,
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
                                            <div
                                                class="flex items-center gap-2"
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
                                                {#if p.solverId_String}
                                                    <button
                                                        on:click={() =>
                                                            handleOpenSolverSource(
                                                                p,
                                                            )}
                                                        class="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                                                        title="View Source"
                                                    >
                                                        <Code
                                                            class="w-3 h-3 text-purple-500"
                                                        />
                                                    </button>
                                                {/if}
                                            </div>
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
                                                                                (1
                                                                                +
                                                                                (TimeFactor
                                                                                *
                                                                                (Deadline
                                                                                -
                                                                                Submission)))
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
                                            {:else if p.reason === "invalidsolver"}
                                                <p
                                                    class="text-xs {$mode ===
                                                    'dark'
                                                        ? 'text-orange-400'
                                                        : 'text-orange-600'}"
                                                >
                                                    <strong
                                                        >Invalid participation:</strong
                                                    > The Solver ID (Bot) is too
                                                    new relative to the competition
                                                    creation.
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
                    {#if $reputation_proof}
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
                {/if}
            </section>
        </div>

        {#if showActionModal && game}
            <div
                class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm"
                on:click|self={closeModal}
                role="presentation"
            >
                <BodyScrollLock />
                <div
                    class="modal-content {$mode === 'dark'
                        ? 'bg-slate-800 text-gray-200 border border-slate-700'
                        : 'bg-white text-gray-800 border border-gray-200'} relative p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-5xl xl:max-w-6xl transform transition-all flex flex-col max-h-[90vh]"
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
                                    class="space-y-6 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
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
                                                    1. {uniqueJudges.length > 0
                                                        ? "Check Judges"
                                                        : "No Judges"}
                                                </h4>
                                            </div>
                                            {#if uniqueJudges.length > 0}
                                                <p
                                                    class="text-sm text-muted-foreground mb-4"
                                                >
                                                    Install and run the
                                                    judge-check service to
                                                    verify the reputation of
                                                    the judges before
                                                    participating.
                                                </p>
                                                <div class="space-y-2">
                                                    <div
                                                        class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                                    >
                                                        <button
                                                            type="button"
                                                            class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                            on:click={() =>
                                                                navigator.clipboard.writeText(
                                                                    `nodo download ${JUDGE_CHECK_SERVICE}`,
                                                                )}
                                                            title="Copy command"
                                                        >
                                                            <Copy class="w-3.5 h-3.5" />
                                                        </button>
                                                        <span
                                                            class="text-primary"
                                                            >nodo</span
                                                        >
                                                        download
                                                        {JUDGE_CHECK_SERVICE}
                                                    </div>
                                                    <div
                                                        class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group"
                                                    >
                                                        <button
                                                            type="button"
                                                            class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                            on:click={() =>
                                                                navigator.clipboard.writeText(
                                                                    "nodo execute gop_judges_check",
                                                                )}
                                                            title="Copy command"
                                                        >
                                                            <Copy class="w-3.5 h-3.5" />
                                                        </button>
                                                        <span
                                                            class="text-primary"
                                                            >nodo</span
                                                        >
                                                        execute
                                                        gop_judges_check
                                                    </div>
                                                    <p
                                                        class="text-xs text-muted-foreground"
                                                    >
                                                        Requires Celaut Nodo.
                                                        Follow
                                                        {NODO_INSTALLATION},
                                                        then open the service
                                                        web UI, enter the game
                                                        id or the judges you
                                                        want to verify, and
                                                        wait for the verdict.
                                                    </p>
                                                </div>
                                            {:else}
                                                <p
                                                    class="text-sm text-muted-foreground"
                                                >
                                                    This game has no judges, so
                                                    there is nothing to verify
                                                    in this step.
                                                </p>
                                            {/if}
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
                                                Build your robot by following
                                                the development guide and its
                                                recommendations.
                                            </p>
                                            <div
                                                class="bg-muted/50 p-3 rounded-lg text-sm"
                                            >
                                                <p
                                                    class="text-muted-foreground"
                                                >
                                                    Open the full robot
                                                    development guide here and
                                                    read it without leaving the
                                                    participation flow.
                                                </p>
                                                <Button
                                                    variant="outline"
                                                    class="mt-3 w-full justify-center gap-2"
                                                    on:click={openRobotDevelopmentGuide}
                                                >
                                                    <FileText class="w-4 h-4" />
                                                    Read development guide
                                                </Button>
                                            </div>
                                            <div class="mt-4">
                                                <Button
                                                    variant="outline"
                                                    class="w-full justify-center gap-2"
                                                    on:click={() => (showBotAssistantModal = true)}
                                                >
                                                    <Sparkles class="w-4 h-4" />
                                                    Need help drafting your bot?
                                                </Button>
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
                                                fee required yet (only network fees).
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
                                                    href="https://t.me/unstopbots"
                                                    target="_blank"
                                                    class="underline font-semibold hover:text-yellow-500"
                                                    >UnstopBots Telegram
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
                                                showExecutionStep = true;
                                            }}
                                        >
                                            I have my Bot implemented
                                        </Button>
                                    </div>
                                </div>
                            {:else if showExecutionStep}
                                <div
                                    class="space-y-6 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Game Service Execution
                                        </h3>
                                        <p class="text-muted-foreground">
                                            Follow these instructions to run the game service and generate your participation data.
                                        </p>
                                    </div>
                                    
                                    <div class="space-y-6">
                                        <!-- Step 1 -->
                                        <div class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
                                            <div class="flex items-center gap-3 mb-3">
                                                <div class="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                                </div>
                                                <h4 class="font-semibold text-lg">1. Download Game Service</h4>
                                            </div>
                                            <p class="text-sm text-muted-foreground mb-3">
                                                Download the specific game service using Celaut Nodo.
                                            </p>
                                            <div class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group">
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() => navigator.clipboard.writeText(`nodo download ${serviceDownload}`)}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary">nodo</span> download {serviceDownload}
                                            </div>
                                        </div>

                                        <!-- Step 2 -->
                                        <div class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
                                            <div class="flex items-center gap-3 mb-3">
                                                <div class="p-2 bg-green-500/10 rounded-lg text-green-500">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                                </div>
                                                <h4 class="font-semibold text-lg">2. Execute Game Service</h4>
                                            </div>
                                            <p class="text-sm text-muted-foreground mb-3">
                                                Run your participation. The checksum serves to validate the integrity of both the seed and your ErgoTree.
                                            </p>
                                            <div class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group">
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() => navigator.clipboard.writeText(`nodo execute ${game?.content.serviceId} -e seed ${game?.seed} -e ergotree ${walletErgoTreeHex} -e checksum ${participationChecksum}`)}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary">nodo</span> execute {game?.content.serviceId} -e seed {game?.seed} -e ergotree {walletErgoTreeHex} -e checksum {participationChecksum}
                                            </div>
                                        </div>
                                        
                                        <!-- Step 3 -->
                                        <div class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
                                            <div class="flex items-center gap-3 mb-3">
                                                <div class="p-2 bg-purple-500/10 rounded-lg text-purple-500">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                                                </div>
                                                <h4 class="font-semibold text-lg">3. Publish your solver</h4>
                                            </div>
                                            <p class="text-sm text-muted-foreground mb-3">
                                                First publish your solver with <span class="font-mono text-foreground">nodo publish solver</span>. Before doing that, make sure you have already configured Nodo with <span class="font-mono text-foreground">nodo config</span>.
                                            </p>
                                            <div class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group">
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() => navigator.clipboard.writeText(`nodo publish solver`)}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary">nodo</span> publish solver
                                            </div>
                                            <p class="text-sm text-muted-foreground my-3">
                                                If publishing is available, then export it to a file with:
                                            </p>
                                            <div class="bg-muted/50 p-3 rounded-lg font-mono text-xs break-all relative group">
                                                <button
                                                    type="button"
                                                    class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-muted"
                                                    on:click={() => navigator.clipboard.writeText(`nodo export solver ./Desktop`)}
                                                    title="Copy command"
                                                >
                                                    <Copy class="w-3.5 h-3.5" />
                                                </button>
                                                <span class="text-primary">nodo</span> export solver ./Desktop
                                            </div>
                                        </div>

                                        <!-- Step 4 -->
                                        <div class="p-4 rounded-xl border bg-card text-card-foreground shadow-sm">
                                            <div class="flex items-center gap-3 mb-2">
                                                <div class="p-2 bg-amber-500/10 rounded-lg text-amber-500">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                                                </div>
                                                <h4 class="font-semibold text-lg">4. Upload Results</h4>
                                            </div>
                                            <p class="text-sm text-muted-foreground">
                                                Once execution and export are complete, upload the generated JSON file containing your results in the form below.
                                            </p>
                                        </div>
                                    </div>

                                    <div class="flex justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
                                        <Button
                                            variant="ghost"
                                            on:click={() => {
                                                showExecutionStep = false;
                                                showParticipantGuide = true;
                                            }}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            on:click={() => {
                                                showExecutionStep = false;
                                                showSolverIdStep = true;
                                            }}
                                        >
                                            Continue <ArrowRight class="ml-2 h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            {:else if showSolverIdStep}
                                <div
                                    class="space-y-6 max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
                                >
                                    <div class="text-center mb-8">
                                        <h3 class="text-2xl font-bold mb-2">
                                            Verify Solver ID it's on-chain
                                        </h3>
                                        <p class="text-muted-foreground">
                                            You need a unique Solver ID
                                            published on-chain before the deadline to participate.
                                        </p>
                                    </div>

                                    <!-- If its open don't suggest user to upload their participation data, it's not the time -->
                                    {#if !openCeremony}
                                        <!-- JSON upload: allow uploading exported participation data -->
                                        <div class="mt-3 space-y-2">
                                            <Label for="solver_json_upload">Upload participation data (.json)</Label>
                                            <p class="text-muted-foreground">
                                                In case you have already executed the game service.
                                            </p>
                                            <input
                                                id="solver_json_upload"
                                                type="file"
                                                accept="application/json"
                                                on:change={handleJsonFileUpload}
                                                class="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-muted/50"
                                            />

                                            {#if jsonUploadError}
                                                <div class="p-2 rounded text-sm text-red-600">{jsonUploadError}</div>
                                            {/if}

                                            {#if checksumStatus === 'invalid'}
                                                <div class="p-2 rounded text-sm text-red-600">Invalid checksum: file does not match.</div>
                                            {:else if checksumStatus === 'valid'}
                                                <div class="p-2 rounded text-sm text-green-600">Valid checksum: loaded data.</div>
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
                                    {/if}

                                    <div class="space-y-4">
                                        <div class="space-y-2">
                                            <Label for="solver_id_step"
                                                >Solver ID (Hex)</Label
                                            >
                                            <div class="flex gap-2">
                                                <Input
                                                    id="solver_id_step"
                                                    bind:value={solverId_input}
                                                    on:input={() => {
                                                        solverId_box_found =
                                                            false;
                                                        participationSolverId =
                                                            "";
                                                    }}
                                                    placeholder="e.g., a1b2..."
                                                    class="font-mono"
                                                />
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
                                                    solverId_box_found ||
                                                    !solverId_checked}
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
                                                showExecutionStep = true;
                                            }}
                                        >
                                            Back
                                        </Button>
                                        <Button
                                            on:click={() => {
                                                if (solverId_box_found || get(isDevMode)) {
                                                    participationSolverId =
                                                        solverId_input.trim();
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
                                                !transactionId && !get(isDevMode)}
                                        >
                                            Continue <ArrowRight
                                                class="ml-2 h-4 w-4"
                                            />
                                        </Button>
                                    </div>
                                </div>
                            {:else}
                                <div class="space-y-6 max-w-3xl mx-auto">

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
                                            Optional: `seed_hex`.
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
                                        {#if checksumStatus === 'valid'}
                                            <p class="text-xs mt-1 flex items-center gap-1 {$mode === 'dark' ? 'text-green-400' : 'text-green-600'}">
                                                <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                                                Checksum verified — file integrity confirmed.
                                            </p>
                                        {:else if checksumStatus === 'missing'}
                                            <p class="text-xs mt-1 flex items-center gap-1 {$mode === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}">
                                                <span class="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
                                                No checksum found in file — integrity could not be verified.
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
                                                >Solver ID</Label
                                            >
                                            <Input
                                                id="solverId"
                                                type="text"
                                                value={participationSolverId}
                                                readonly
                                                placeholder="Solver ID verified on-chain"
                                                class="w-full {$mode === 'dark'
                                                    ? 'bg-slate-800/50 border-slate-700'
                                                    : 'bg-white border-gray-200'}"
                                            />
                                            <p class="mt-1 text-xs text-muted-foreground">
                                                This Solver ID comes from the
                                                on-chain verification step and
                                                cannot be edited here.
                                            </p>
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
                                            {#if scores_list.length === 0}
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

                                            {:else}
                                                <Label
                                                    for="user_score"
                                                    class="block text-sm font-medium mb-1.5 {$mode ===
                                                    'dark'
                                                        ? 'text-gray-200'
                                                        : 'text-gray-700'}"
                                                >
                                                    Obfuscated Score
                                                </Label>
                                                <p
                                                    class="text-xs mt-1.5 {$mode === 'dark'
                                                        ? 'text-gray-400'
                                                        : 'text-gray-500'}"
                                                    >
                                                    Your score is anonymized using decoy values
                                                </p>
                                                <p
                                                    class="text text-blue-500 mt-2"
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
                                                    !participationSolverId.trim() ||
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
                                                            <Select
                                                                bind:value={
                                                                    devGenErrorType
                                                                }
                                                            >
                                                                <SelectTrigger
                                                                    class="cyber-select w-full h-8 text-xs"
                                                                    aria-label="Simulate error"
                                                                >
                                                                    <SelectValue placeholder="Select error type" />
                                                                </SelectTrigger>
                                                                <SelectContent class="cyber-select-content">
                                                                    <SelectItem
                                                                        value="none"
                                                                        label="None (Valid)"
                                                                        class="cyber-select-item text-xs"
                                                                    >
                                                                        None (Valid)
                                                                    </SelectItem>
                                                                    <SelectItem
                                                                        value="wrong_commitment"
                                                                        label="Invalid Commitment"
                                                                        class="cyber-select-item text-xs"
                                                                    >
                                                                        Invalid
                                                                        Commitment
                                                                    </SelectItem>
                                                                    <SelectItem
                                                                        value="wrong_score"
                                                                        label="Score Mismatch"
                                                                        class="cyber-select-item text-xs"
                                                                    >
                                                                        Score
                                                                        Mismatch
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
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

                                    <Button
                                        variant="ghost"
                                        on:click={() => {
                                            showSolverIdStep = true;
                                        }}
                                    >
                                        Back
                                    </Button>
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
                                        a majority of judges to perform the same
                                        action. If successful, the resolution deadline
                                        will be extended.
                                    </p>

                                    {#if !isNominatedJudge}
                                        <div
                                            class="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600 dark:text-yellow-400"
                                        >
                                            <AlertTriangle
                                                class="w-5 h-5 mt-0.5 flex-shrink-0"
                                            />
                                            <div>
                                                <p
                                                    class="font-semibold text-sm"
                                                >
                                                    Quorum Warning
                                                </p>
                                                <p class="text-sm opacity-90">
                                                    You are not an appointed
                                                    judge for this game. While
                                                    you can cast your vote on
                                                    the reputation system, it
                                                    will <span class="font-bold"
                                                        >not affect the game's
                                                        quorum</span
                                                    > or outcome.
                                                </p>
                                            </div>
                                        </div>
                                    {/if}
                                    <Button
                                        on:click={handleJudgesInvalidate}
                                        disabled={isSubmitting}
                                        class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                        'dark'
                                            ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                                            : 'bg-yellow-500 hover:bg-yellow-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {#if isSubmitting}
                                            Processing...
                                        {:else if isInvalidationMajorityReached}
                                            Execute Invalidation
                                        {:else}
                                            Confirm Invalidation Vote
                                        {/if}
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

                                    {#if !isNominatedJudge}
                                        <div
                                            class="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-600 dark:text-yellow-400"
                                        >
                                            <AlertTriangle
                                                class="w-5 h-5 mt-0.5 flex-shrink-0"
                                            />
                                            <div>
                                                <p
                                                    class="font-semibold text-sm"
                                                >
                                                    Quorum Warning
                                                </p>
                                                <p class="text-sm opacity-90">
                                                    You are not an appointed
                                                    judge for this game. While
                                                    you can cast your vote on
                                                    the reputation system, it
                                                    will <span class="font-bold"
                                                        >not affect the game's
                                                        quorum</span
                                                    > or outcome.
                                                </p>
                                            </div>
                                        </div>
                                    {/if}
                                    <Button
                                        on:click={handleJudgesInvalidateUnavailable}
                                        disabled={isSubmitting}
                                        class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                        'dark'
                                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                            : 'bg-orange-500 hover:bg-orange-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {#if isSubmitting}
                                            Processing...
                                        {:else if isUnavailableMajorityReached}
                                            Execute Mark Unavailable
                                        {:else}
                                            Confirm Unavailable Vote
                                        {/if}
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
                                        >Action: {isJudge
                                            ? "Update Judge Reference Participation"
                                            : "Accept Judge Nomination"}</strong
                                    ><br />
                                    {#if isJudge}
                                        You can update your reference participation
                                        data. This will respend your current judge
                                        opinion and recreate it with the new values.
                                    {:else}
                                        By accepting, you agree to participate as a
                                        judge in this game, with the responsibility to
                                        review and potentially invalidate the winner if
                                        necessary.
                                    {/if}
                                    <br /><br />
                                    <strong>Important:</strong> Provide your reference
                                    participation data by uploading the JSON file or
                                    filling the form below.
                                </p>

                                <div class="grid w-full items-center gap-1.5">
                                    <Label for="json-upload"
                                        >Reference Participation JSON</Label
                                    >
                                    <Input
                                        id="json-upload"
                                        type="file"
                                        accept=".json"
                                        on:change={handleJsonFileUpload}
                                    />
                                    {#if jsonUploadError}
                                        <p class="text-sm text-red-500">
                                            {jsonUploadError}
                                        </p>
                                    {/if}
                                    {#if checksumStatus === 'valid'}
                                        <p class="text-xs mt-1 flex items-center gap-1 {$mode === 'dark' ? 'text-green-400' : 'text-green-600'}">
                                            <span class="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                                            Checksum verified — file integrity confirmed.
                                        </p>
                                    {:else if checksumStatus === 'missing'}
                                        <p class="text-xs mt-1 flex items-center gap-1 {$mode === 'dark' ? 'text-yellow-400' : 'text-yellow-600'}">
                                            <span class="inline-block w-2 h-2 rounded-full bg-yellow-500"></span>
                                            No checksum found in file — integrity could not be verified.
                                        </p>
                                    {/if}
                                    <p class="text-xs text-muted-foreground">
                                        Optional. If provided, fields below will be
                                        auto-filled.
                                    </p>
                                </div>

                                <div class="space-y-3">
                                    <div class="flex items-center gap-2">
                                        <span class="h-px flex-1 bg-border"></span>
                                        <span
                                            class="text-xs uppercase text-muted-foreground"
                                            >Or complete manually</span
                                        >
                                        <span class="h-px flex-1 bg-border"></span>
                                    </div>

                                    <div>
                                        <Label for="judge-solver-id"
                                            >Reference Solver ID</Label
                                        >
                                        <Input
                                            id="judge-solver-id"
                                            type="text"
                                            bind:value={solverId_input}
                                            placeholder="Hex solver id"
                                        />
                                    </div>

                                    <div>
                                        <Label for="judge-hash-logs"
                                            >Reference Logs Hash</Label
                                        >
                                        <Input
                                            id="judge-hash-logs"
                                            type="text"
                                            bind:value={hashLogs_input}
                                            placeholder="Hex hash logs"
                                        />
                                    </div>

                                    <div>
                                        <Label for="judge-commitment"
                                            >Reference Commitment</Label
                                        >
                                        <Input
                                            id="judge-commitment"
                                            bind:value={commitmentC_input}
                                            placeholder="Hex commitment"
                                        />
                                    </div>

                                    <div>
                                        <Label for="judge-reference-seed"
                                            >Reference Seed</Label
                                        >
                                        <Input
                                            id="judge-reference-seed"
                                            type="text"
                                            bind:value={judgeReferenceSeed_input}
                                            placeholder="Hex seed used by reference commitment"
                                        />
                                    </div>

                                    <div>
                                        <Label for="judge-reference-score"
                                            >Reference Score</Label
                                        >
                                        <Input
                                            id="judge-reference-score"
                                            type="number"
                                            step="1"
                                            bind:value={judgeReferenceScore_input}
                                            placeholder="e.g. 98"
                                        />
                                    </div>

                                    {#if showScorePicker}
                                        <div class="p-3 rounded-md border mt-3 {$mode === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}">
                                            <p class="font-semibold mb-1">Choose the real score from the uploaded list</p>
                                            <p class="text-sm text-muted-foreground mb-3">Select one of the scores below or cancel to fill the score manually.</p>
                                            <div class="space-y-2 max-h-40 overflow-auto">
                                                {#each scorePickerOptions as s, i}
                                                    <label class="flex items-center gap-3 text-sm">
                                                        <input
                                                            type="radio"
                                                            name="scorePicker"
                                                            on:change={() => (scorePickerSelection = s)}
                                                            checked={scorePickerSelection === s}
                                                        />
                                                        <span class="font-mono">{i}: {s}</span>
                                                    </label>
                                                {/each}
                                            </div>
                                            <div class="flex gap-2 mt-3">
                                                <Button on:click={confirmScorePicker} disabled={scorePickerSelection === null}>Confirm</Button>
                                                <Button variant="ghost" on:click={cancelScorePicker}>Cancel</Button>
                                            </div>
                                        </div>
                                    {/if}
                                </div>

                                <Button
                                    on:click={handleJudgeNomination}
                                    disabled={isSubmitting ||
                                        !solverId_input ||
                                        !hashLogs_input ||
                                        !commitmentC_input ||
                                        !judgeReferenceScore_input.trim()}
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : isJudge
                                          ? "Update Judge Reference Participation"
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
                                    the
                                    <strong>ceremony deadline</strong>
                                    to update its <code>gameSeed</code>, adding
                                    new entropy. It helps ensure fairness and
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
                        {:else if currentActionType === "donate_ceremony"}
                            <div class="space-y-4">
                                <p
                                    class="text-sm p-3 rounded-md {$mode ===
                                    'dark'
                                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                                        : 'bg-blue-100 text-blue-700 border border-blue-200'}"
                                >
                                    <strong>Action: Donate</strong><br />
                                    You are contributing value to the game prize
                                    pool while ensuring fairness by adding entropy.
                                </p>
                                <div>
                                    <Label class="mb-2 block"
                                        >Donation Amount ({game?.participationTokenId
                                            ? "Token"
                                            : "ERG"})</Label
                                    >
                                    <div class="flex gap-2">
                                        <Input
                                            type="number"
                                            placeholder="0.00"
                                            bind:value={donationAmount}
                                            min="0"
                                            step="any"
                                        />
                                        <Button
                                            variant="outline"
                                            on:click={() =>
                                                (donationAmount =
                                                    formatTokenBigInt(
                                                        userParticipationTokenBalance,
                                                        tokenDecimals,
                                                    ))}
                                        >
                                            Max
                                        </Button>
                                    </div>
                                    <p class="text-xs text-gray-500 mt-1">
                                        Balance: {formatTokenBigInt(
                                            userParticipationTokenBalance,
                                            tokenDecimals,
                                        )}
                                    </p>
                                </div>
                                <Button
                                    on:click={handleOpenCeremony}
                                    disabled={isSubmitting ||
                                        !donationAmount ||
                                        parseFloat(donationAmount) <= 0}
                                    class="w-full md:w-auto md:min-w-[200px] mt-3 py-2.5 text-base {$mode ===
                                    'dark'
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-blue-500 hover:bg-blue-600 text-white'} font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting
                                        ? "Processing..."
                                        : "Confirm Donation"}
                                </Button>
                            </div>
                        {/if}
                    </div>

                    {#if showBotAssistantModal}
                        <div
                            class="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                            on:click|self={() => (showBotAssistantModal = false)}
                            role="presentation"
                        >
                            <BodyScrollLock />
                            <div
                                class="w-full max-w-3xl rounded-xl border shadow-2xl p-5 md:p-6 max-h-[85vh] overflow-y-auto {$mode === 'dark'
                                    ? 'bg-slate-900/95 text-gray-100 border-slate-700'
                                    : 'bg-white/95 text-gray-800 border-gray-200'}"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="bot-assistant-modal-title"
                            >
                                <div class="flex items-start justify-between gap-4 mb-5">
                                    <div>
                                        <h4
                                            id="bot-assistant-modal-title"
                                            class="text-xl font-semibold"
                                        >
                                            Need help drafting your bot?
                                        </h4>
                                        <p class="text-sm text-muted-foreground mt-1">
                                            Open this assistant only if you want an AI-generated
                                            first pass based on the game description and paper.
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        on:click={() => (showBotAssistantModal = false)}
                                        aria-label="Close AI assistant modal"
                                        class="flex-shrink-0"
                                    >
                                        <X class="w-5 h-5" />
                                    </Button>
                                </div>

                                <AI_ASSISTANT
                                    prompt={botAssistantPrompt}
                                    title={null}
                                    description={null}
                                />
                            </div>
                        </div>
                    {/if}

                    {#if showRobotDevelopmentGuideModal}
                        <div
                            class="absolute inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
                            on:click|self={() =>
                                (showRobotDevelopmentGuideModal = false)}
                            role="presentation"
                        >
                            <BodyScrollLock />
                            <div
                                class="w-full max-w-6xl xl:max-w-7xl rounded-xl border shadow-2xl p-0 max-h-[92vh] overflow-hidden flex flex-col {$mode === 'dark'
                                    ? 'bg-slate-900/95 text-gray-100 border-slate-700'
                                    : 'bg-white/95 text-gray-800 border-gray-200'}"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="robot-development-guide-modal-title"
                            >
                                <div
                                    class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-5 py-4 md:px-7 md:py-5 backdrop-blur-sm {$mode ===
                                    'dark'
                                        ? 'border-slate-700 bg-slate-900/90'
                                        : 'border-gray-200 bg-white/90'}"
                                >
                                    <div>
                                        <h4
                                            id="robot-development-guide-modal-title"
                                            class="text-xl font-semibold"
                                        >
                                            Robot Development Guide
                                        </h4>
                                        <p
                                            class="text-sm text-muted-foreground mt-1"
                                        >
                                            Read the guide directly here while
                                            preparing your submission.
                                        </p>
                                    </div>
                                    <div class="flex items-center gap-2 flex-shrink-0">
                                        <a
                                            href={ROBOT_DEVELOPMENT_GUIDE}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class={`${buttonVariants({ variant: "outline" })} gap-2`}
                                        >
                                            <ExternalLink class="w-4 h-4" />
                                            Open original guide
                                        </a>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            on:click={() =>
                                                (showRobotDevelopmentGuideModal = false)}
                                            aria-label="Close development guide modal"
                                            class="flex-shrink-0"
                                        >
                                            <X class="w-5 h-5" />
                                        </Button>
                                    </div>
                                </div>

                                <div class="flex-1 min-h-0 overflow-y-auto px-5 py-5 md:px-8 md:py-7 overscroll-contain">
                                    {#if isRobotDevelopmentGuideLoading}
                                        <div
                                            class="h-full min-h-[18rem] flex flex-col items-center justify-center text-center text-muted-foreground"
                                        >
                                            <Loader2
                                                class="w-8 h-8 animate-spin mb-3"
                                            />
                                            <p class="text-sm">
                                                Loading guide...
                                            </p>
                                        </div>
                                    {:else if robotDevelopmentGuideError}
                                        <div
                                            class="min-h-[18rem] flex flex-col items-center justify-center text-center"
                                        >
                                            <p
                                                class="text-sm text-muted-foreground max-w-md"
                                            >
                                                {robotDevelopmentGuideError}
                                            </p>
                                            <Button
                                                variant="outline"
                                                class="mt-4"
                                                on:click={openRobotDevelopmentGuide}
                                            >
                                                Try again
                                            </Button>
                                        </div>
                                    {:else}
                                        <div
                                            class="guide-prose prose prose-base md:prose-lg {$mode ===
                                            'dark'
                                                ? 'prose-invert'
                                                : ''} max-w-none"
                                        >
                                            {@html marked.parse(
                                                robotDevelopmentGuideContent,
                                                {
                                                    breaks: true,
                                                    gfm: true,
                                                    renderer: guideRenderer,
                                                },
                                            )}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/if}
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
                            <p class="text-xs break-words">
                                {errorMessage}
                            </p>
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
                            <p class="text-xs break-words">
                                {warningMessage}
                            </p>
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
        <BodyScrollLock />
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
        <BodyScrollLock />
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div on:click|stopPropagation>
            <FileSourceCreation
                profile={$reputation_proof}
                explorerUri={$explorer_uri}
                source_explorer_url={$source_explorer_url}
                onSourceAdded={handleFileSourceAdded}
                hash={writable(modalFileHash)}
                fixedHashFunctionId={HASH_ALGORITHM_IDS.blake2b256}
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
    .paper-prose :global(h1) {
        @apply text-3xl md:text-4xl font-bold tracking-tight mb-6 mt-2;
    }
    .paper-prose :global(h2) {
        @apply text-2xl md:text-3xl font-semibold mt-10 mb-4 pb-2 border-b border-border;
    }
    .paper-prose :global(h3) {
        @apply text-xl md:text-2xl font-semibold mt-8 mb-3;
    }
    .paper-prose :global(h4) {
        @apply text-lg font-semibold mt-6 mb-2;
    }
    .paper-prose :global(p) {
        @apply leading-8 mb-5;
    }
    .paper-prose :global(ul),
    .paper-prose :global(ol) {
        @apply my-5 pl-6;
        list-style-position: outside;
    }
    .paper-prose :global(ul) {
        list-style-type: disc;
    }
    .paper-prose :global(ol) {
        list-style-type: decimal;
    }
    .paper-prose :global(li) {
        @apply mb-2 leading-8;
    }
    .paper-prose :global(blockquote) {
        @apply my-6 border-l-4 border-amber-500/50 bg-amber-500/10 px-4 py-3 italic rounded-r-lg;
    }
    .paper-prose :global(pre) {
        @apply my-6 overflow-x-auto rounded-xl border border-border bg-slate-950/95 p-4 text-sm shadow-inner;
    }
    .paper-prose :global(code) {
        @apply rounded bg-muted px-1.5 py-0.5 text-[0.9em];
    }
    .paper-prose :global(pre code) {
        @apply bg-transparent p-0 text-inherit;
    }
    .paper-prose :global(hr) {
        @apply my-8 border-border;
    }
    .paper-prose :global(table) {
        @apply my-6 w-full border-collapse text-sm;
    }
    .paper-prose :global(th) {
        @apply border border-border bg-muted/60 px-3 py-2 text-left font-semibold;
    }
    .paper-prose :global(td) {
        @apply border border-border px-3 py-2 align-top;
    }
    .paper-prose :global(tbody tr:nth-child(even)) {
        @apply bg-muted/30;
    }
    .paper-prose :global(a) {
        @apply text-blue-500 underline decoration-blue-500/40 underline-offset-4 transition-colors hover:text-blue-400;
    }
    .guide-prose :global(h1) {
        @apply text-3xl md:text-4xl font-bold tracking-tight mb-6 mt-2;
    }
    .guide-prose :global(h2) {
        @apply text-2xl md:text-3xl font-semibold mt-10 mb-4 pb-2 border-b border-border;
    }
    .guide-prose :global(h3) {
        @apply text-xl md:text-2xl font-semibold mt-8 mb-3;
    }
    .guide-prose :global(h4) {
        @apply text-lg font-semibold mt-6 mb-2;
    }
    .guide-prose :global(p) {
        @apply leading-8 mb-5;
    }
    .guide-prose :global(ul),
    .guide-prose :global(ol) {
        @apply my-5 pl-6;
        list-style-position: outside;
    }
    .guide-prose :global(ul) {
        list-style-type: disc;
    }
    .guide-prose :global(ol) {
        list-style-type: decimal;
    }
    .guide-prose :global(li) {
        @apply mb-2 leading-8;
    }
    .guide-prose :global(blockquote) {
        @apply my-6 border-l-4 border-amber-500/50 bg-amber-500/10 px-4 py-3 italic rounded-r-lg;
    }
    .guide-prose :global(pre) {
        @apply my-6 overflow-x-auto rounded-xl border border-border bg-slate-950/95 p-4 text-sm shadow-inner;
    }
    .guide-prose :global(code) {
        @apply rounded bg-muted px-1.5 py-0.5 text-[0.9em];
    }
    .guide-prose :global(pre code) {
        @apply bg-transparent p-0 text-inherit;
    }
    .guide-prose :global(hr) {
        @apply my-8 border-border;
    }
    .guide-prose :global(table) {
        @apply my-6 w-full border-collapse text-sm;
    }
    .guide-prose :global(th) {
        @apply border border-border bg-muted/60 px-3 py-2 text-left font-semibold;
    }
    .guide-prose :global(td) {
        @apply border border-border px-3 py-2 align-top;
    }
    .guide-prose :global(tbody tr:nth-child(even)) {
        @apply bg-muted/30;
    }
    .guide-prose :global(a) {
        @apply text-blue-500 underline decoration-blue-500/40 underline-offset-4 transition-colors hover:text-blue-400;
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
        padding-top: 0;
    }

    .timeleft {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 2rem;
        @apply text-foreground;
    }

    .timeleft-header {
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.5rem;
    }

    .timeleft-label-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 9999px;
        @apply bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200;
    }

    .timeleft-label {
        font-size: 1.125rem;
        font-weight: 700;
        text-align: left;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        line-height: 1.2;
        font-family:
            "Avenir Next",
            "Segoe UI",
            "Helvetica Neue",
            Arial,
            sans-serif;
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

    @media (max-width: 640px) {
        .timeleft {
            gap: 1rem;
        }

        .timeleft-header {
            margin-top: 0.25rem;
            gap: 0.625rem;
        }

        .timeleft-label {
            font-size: 1rem;
        }

        .countdown-items {
            gap: 0.75rem;
        }

        .item {
            width: calc(50% - 0.375rem);
            height: 76px;
        }

        .item > div:first-child {
            font-size: 1.75rem;
        }
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

    /* Override source-application FileCard hardcoded green → purple for Game Service Sources */
    /* Tailwind class overrides */
    .service-file-card-wrapper :global(.text-green-500),
    .service-file-card-wrapper :global([class*="text-green"]) {
        color: #a855f7 !important; /* purple-500 */
    }
    .service-file-card-wrapper :global(.bg-green-500\/10),
    .service-file-card-wrapper :global([class*="bg-green"]) {
        background-color: rgb(168 85 247 / 0.1) !important;
    }
    /* Inline style overrides — Timeline dot (background-color) and label (color) */
    .service-file-card-wrapper :global([style*="color: #22c55e"]),
    .service-file-card-wrapper :global([style*="color:#22c55e"]) {
        color: #a855f7 !important;
    }
    .service-file-card-wrapper :global([style*="background-color: #22c55e"]),
    .service-file-card-wrapper :global([style*="background-color:#22c55e"]) {
        background-color: #a855f7 !important;
    }
</style>
