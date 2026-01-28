<script lang="ts">
    import {
        type AnyGame,
        GameState,
        isOpenCeremony,
        isOpenSolverSubmit,
    } from "$lib/common/game";
    import {
        CheckCircle,
        Circle,
        Clock,
        History,
        User,
        Bot,
        RefreshCw,
        Sparkles,
        Gavel,
        Trophy,
        XCircle,
        ExternalLink,
        Eye,
        EyeOff,
    } from "lucide-svelte";
    import { formatDistanceToNow } from "date-fns";
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { type AnyParticipation } from "$lib/common/game";
    import { type Box, type Amount } from "@fleet-sdk/core";
    import { explorer_uri, web_explorer_uri_tx } from "$lib/ergo/envs";
    import { get } from "svelte/store";
    import { type RPBox } from "reputation-system";
    import {
        GAME,
        PARTICIPATION,
        PARTICIPATION_UNAVAILABLE,
    } from "$lib/ergo/reputation/types";

    export let history: AnyGame[] = [];
    export let currentGame: AnyGame | null = null;
    export let currentHeight: number = 0;
    export let participations: AnyParticipation[] = [];
    export let solverHistory: Map<string, Box<Amount>[]> = new Map();

    let showBotEvents = false;

    // Helper to get a readable date from block height or timestamp
    async function getDateString(
        blockOrTs: number,
        isBlock: boolean = true,
    ): Promise<string> {
        if (!blockOrTs) return "Unknown";
        let date: Date;
        if (isBlock) {
            const ts = await block_height_to_timestamp(
                blockOrTs,
                new ErgoPlatform(),
            );
            date = new Date(ts);
        } else {
            date = new Date(blockOrTs);
        }
        return date.toLocaleString();
    }

    // Define timeline steps based on game state
    interface TimelineStep {
        id: string;
        label: string;
        description: string;
        status: "completed" | "active" | "pending" | "cancelled";
        date?: string;
        icon?: any;
        height: number;
        color: string;
        txId?: string;
        isBotEvent?: boolean;
    }

    let steps: TimelineStep[] = [];
    let filteredSteps: TimelineStep[] = [];

    $: if (
        currentGame ||
        history.length > 0 ||
        participations.length > 0 ||
        solverHistory.size > 0
    ) {
        buildSteps(
            history,
            currentGame,
            currentHeight,
            participations,
            solverHistory,
        ).then((s) => {
            steps = s;
        });
    }

    $: filteredSteps = steps.filter((s) => showBotEvents || !s.isBotEvent);

    async function buildSteps(
        hist: AnyGame[],
        current: AnyGame | null,
        height: number,
        parts: AnyParticipation[],
        solvers: Map<string, Box<Amount>[]>,
    ) {
        const newSteps: TimelineStep[] = [];
        const explorerUrl = get(explorer_uri);

        // 1. State Changes from history
        let lastSeed = "";
        for (let i = 0; i < hist.length; i++) {
            const g = hist[i];
            const h = g.box.creationHeight;
            const txId = g.box.transactionId;

            if (i === 0) {
                newSteps.push({
                    id: `created_${h}`,
                    label: "Game Created",
                    description: "The game was initialized on the blockchain.",
                    status: "completed",
                    date: await getDateString(h, true),
                    icon: Sparkles,
                    height: h,
                    color: "text-blue-500 border-blue-500",
                    txId: txId,
                });
                if ("seed" in g) lastSeed = g.seed;
            } else {
                const prevG = hist[i - 1];

                if (
                    g.status === GameState.Active &&
                    "seed" in g &&
                    g.seed !== lastSeed
                ) {
                    newSteps.push({
                        id: `seed_updated_${h}`,
                        label: "Seed Updated",
                        description: "Randomness was added to the game seed.",
                        status: "completed",
                        date: await getDateString(h, true),
                        icon: RefreshCw,
                        height: h,
                        color: "text-purple-500 border-purple-500",
                        txId: txId,
                    });
                    lastSeed = g.seed;
                } else if (
                    g.status === GameState.Resolution &&
                    prevG.status !== GameState.Resolution
                ) {
                    newSteps.push({
                        id: `resolution_started_${h}`,
                        label: "Resolution Started",
                        description:
                            "The game entered the resolution and judging phase.",
                        status: "completed",
                        date: await getDateString(h, true),
                        icon: Gavel,
                        height: h,
                        color: "text-lime-500 border-lime-500",
                        txId: txId,
                    });
                } else if (
                    g.status === GameState.Resolution &&
                    prevG.status === GameState.Resolution
                ) {
                    // Resolution -> Resolution transition
                    const prevCandidate = (prevG as any)
                        .winnerCandidateCommitment;
                    const newCandidate = (g as any).winnerCandidateCommitment;
                    const resolverCommission = (g as any).resolverCommission;

                    let label = "Resolution Updated";
                    let description = "The resolution state was updated.";
                    let icon = Gavel;
                    let color = "text-orange-500 border-orange-500";

                    // Rule 1: Candidate Added -> Omitted Participation
                    if (!prevCandidate && newCandidate) {
                        label = "Candidate Selected";
                        description = `Resolver selected candidate ${newCandidate.slice(0, 8)}... (Omitted Participation logic applied).`;
                        icon = User;
                        color = "text-blue-500 border-blue-500";
                    }
                    // Rule 2: Candidate Removed -> Invalidation
                    else if (prevCandidate && !newCandidate) {
                        // Check commission to determine type of invalidation
                        if (resolverCommission === 0) {
                            label = "Candidate Invalidated";
                            description = `Judges invalidated candidate ${prevCandidate.slice(0, 8)}...`;
                            icon = XCircle;
                            color = "text-red-500 border-red-500";
                        } else {
                            label = "Candidate Unavailable";
                            description = `Judges declared candidate ${prevCandidate.slice(0, 8)}... unavailable (Service/Bot not found).`;
                            icon = EyeOff;
                            color = "text-orange-600 border-orange-600";
                        }
                    }
                    // Fallback for other changes (e.g. just commission change or candidate swap if possible)
                    else if (prevCandidate !== newCandidate) {
                        label = "Candidate Changed";
                        description = `Candidate changed from ${prevCandidate?.slice(0, 8)}... to ${newCandidate?.slice(0, 8)}...`;
                    }

                    newSteps.push({
                        id: `resolution_update_${h}`,
                        label: label,
                        description: description,
                        status: "completed",
                        date: await getDateString(h, true),
                        icon: icon,
                        height: h,
                        color: color,
                        txId: txId,
                    });
                }
            }
        }

        // 2. Bot History (from solverHistory map)
        for (const [solverId, history] of solvers.entries()) {
            for (const s of history) {
                const h = s.creationHeight;
                newSteps.push({
                    id: `solver_${s.boxId}`,
                    label: "Service/Solver Updated",
                    description: `Solver ${solverId.slice(0, 8)}... updated.`,
                    status: "completed",
                    date: await getDateString(h, true),
                    icon: Bot,
                    height: h,
                    color: "text-amber-500 border-amber-500",
                    txId: s.transactionId,
                    isBotEvent: true,
                });
            }
        }

        // 3. Participations and their Bot Boxes
        for (const p of parts) {
            const h = p.creationHeight;

            // Participation Event
            newSteps.push({
                id: `part_${p.boxId}`,
                label: "New Participation",
                description: `Player ${p.playerPK_Hex?.slice(0, 8)}... submitted a score.`,
                status: "completed",
                date: await getDateString(h, true),
                icon: User,
                height: h,
                color: "text-emerald-500 border-emerald-500",
                txId: p.transactionId,
            });

            // Bot Box Event (if available)
            if (p.solverIdBox) {
                const botH = p.solverIdBox.creationHeight;
                newSteps.push({
                    id: `bot_box_${p.solverIdBox.boxId}`,
                    label: "Bot Uploaded",
                    description: `Player uploaded their bot code (Box: ${p.solverIdBox.boxId.slice(0, 8)}...).`,
                    status: "completed",
                    date: await getDateString(botH, true),
                    icon: Bot,
                    height: botH,
                    color: "text-amber-500 border-amber-500",
                    txId: p.solverIdBox.transactionId,
                    isBotEvent: true,
                });
            }

            // Judge Opinions on Participation
            if (p.reputationOpinions && current && "judges" in current) {
                for (const opinion of p.reputationOpinions) {
                    // Check if opinion is from a nominated judge
                    if (current.judges.includes(opinion.token_id)) {
                        const isUnavailable =
                            opinion.type.tokenId === PARTICIPATION_UNAVAILABLE;
                        const isParticipation =
                            opinion.type.tokenId === PARTICIPATION;

                        if (isParticipation || isUnavailable) {
                            const opH = (opinion as any).creationHeight;

                            let label = "Judge Voted";
                            let description = `Judge ${opinion.token_id.slice(0, 8)}... voted on participation ${p.commitmentC_Hex.slice(0, 8)}...`;
                            let icon = Gavel;
                            let color = "text-blue-400 border-blue-400";

                            if (isUnavailable) {
                                label = "Participation Unavailable";
                                description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as unavailable.`;
                                icon = EyeOff;
                                color = "text-orange-500 border-orange-500";
                            } else if (opinion.polarization === false) {
                                label = "Participation Invalid";
                                description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as invalid.`;
                                icon = XCircle;
                                color = "text-red-500 border-red-500";
                            } else {
                                label = "Participation Valid";
                                description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as valid.`;
                                icon = CheckCircle;
                                color = "text-green-500 border-green-500";
                            }

                            newSteps.push({
                                id: `op_part_${opinion.box_id}`,
                                label: label,
                                description: description,
                                status: "completed",
                                date: await getDateString(opH, true),
                                icon: icon,
                                height: opH,
                                color: color,
                                txId: opinion.box_id,
                            });
                        }
                    }
                }
            }
        }

        // 4. Judge Game Acceptance (from current game or history)
        // We look at the latest game state to get the list of judges and opinions
        const gameToCheck =
            current || (hist.length > 0 ? hist[hist.length - 1] : null);
        if (
            gameToCheck &&
            "reputationOpinions" in gameToCheck &&
            "judges" in gameToCheck
        ) {
            for (const opinion of gameToCheck.reputationOpinions) {
                if (
                    gameToCheck.judges.includes(opinion.token_id) &&
                    opinion.type.tokenId === GAME
                ) {
                    const opH = (opinion as any).creationHeight;
                    newSteps.push({
                        id: `op_game_${opinion.box_id}`,
                        label: "Judge Accepted",
                        description: `Judge ${opinion.token_id.slice(0, 8)}... accepted the game.`,
                        status: "completed",
                        date: await getDateString(opH, true),
                        icon: Gavel,
                        height: opH,
                        color: "text-indigo-500 border-indigo-500",
                        txId: opinion.box_id,
                    });
                }
            }
        }

        // Sort all completed steps by height
        newSteps.sort((a, b) => a.height - b.height);

        // 4. Future/Current Steps (only if game is not finalized/cancelled)
        if (current) {
            const isActivePhase = current.status === GameState.Active;
            const isPastActive =
                current.status !== GameState.Active &&
                current.status !== GameState.Cancelled_Draining;

            if (isActivePhase) {
                // Add sub-phases if active
                if ("ceremonyDeadline" in current) {
                    const hashDeadline =
                        current.ceremonyDeadline -
                        current.constants.SEED_MARGIN;
                    if (height < hashDeadline) {
                        newSteps.push({
                            id: "future_hash",
                            label: "Bot Hash Submission",
                            description: "Currently accepting bot hashes.",
                            status: "active",
                            date: `Ends in ~${formatDistanceToNow(new Date(await block_height_to_timestamp(hashDeadline, new ErgoPlatform())))}`,
                            icon: Bot,
                            height: hashDeadline,
                            color: "text-blue-500 border-blue-500",
                        });
                    }

                    const seedDeadline = current.ceremonyDeadline;
                    if (height < seedDeadline) {
                        newSteps.push({
                            id: "future_seed",
                            label: "Seed Randomness",
                            description:
                                height < hashDeadline
                                    ? "Pending ceremony start."
                                    : "Currently accepting randomness.",
                            status:
                                height < hashDeadline ? "pending" : "active",
                            date: `Ends in ~${formatDistanceToNow(new Date(await block_height_to_timestamp(seedDeadline, new ErgoPlatform())))}`,
                            icon: RefreshCw,
                            height: seedDeadline,
                            color: "text-purple-500 border-purple-500",
                        });
                    }
                }

                const execDeadline = current.deadlineBlock;
                if (height < execDeadline) {
                    const isExecOpen =
                        !("ceremonyDeadline" in current) ||
                        height >= current.ceremonyDeadline;
                    newSteps.push({
                        id: "future_exec",
                        label: "Game Execution",
                        description: isExecOpen
                            ? "Currently accepting game results."
                            : "Pending ceremony end.",
                        status: isExecOpen ? "active" : "pending",
                        date: `Ends in ~${formatDistanceToNow(new Date(await block_height_to_timestamp(execDeadline, new ErgoPlatform())))}`,
                        icon: Sparkles,
                        height: execDeadline,
                        color: "text-emerald-500 border-emerald-500",
                    });
                }
            }

            // Resolution & Finalization
            if (current.status === GameState.Resolution) {
                newSteps.push({
                    id: "future_resolution",
                    label: "Resolution & Judging",
                    description: "Judges are verifying the winner.",
                    status: "active",
                    date:
                        "resolutionDeadline" in current
                            ? `Ends in ~${formatDistanceToNow(new Date(await block_height_to_timestamp(current.resolutionDeadline, new ErgoPlatform())))}`
                            : undefined,
                    icon: Gavel,
                    height:
                        "resolutionDeadline" in current
                            ? current.resolutionDeadline
                            : 9999999,
                    color: "text-lime-500 border-lime-500",
                });
            }

            if (current.status === GameState.Finalized) {
                newSteps.push({
                    id: "finalized",
                    label: "Finalized",
                    description:
                        "The game is complete and the winner has been paid.",
                    status: "completed",
                    icon: Trophy,
                    height: 9999999,
                    color: "text-yellow-500 border-yellow-500",
                    txId: current.box.transactionId,
                });
            } else if (current.status === GameState.Cancelled_Draining) {
                newSteps.push({
                    id: "cancelled",
                    label: "Cancelled",
                    description: "The game was cancelled.",
                    status: "cancelled",
                    icon: XCircle,
                    height: 9999999,
                    color: "text-red-500 border-red-500",
                    txId: current.box.transactionId,
                });
            } else {
                newSteps.push({
                    id: "future_finalized",
                    label: "Finalized",
                    description: "Game completion and prize distribution.",
                    status: "pending",
                    icon: Trophy,
                    height: 10000000,
                    color: "text-gray-400 border-gray-400",
                });
            }
        }

        return newSteps;
    }
</script>

<div class="space-y-6 p-4">
    <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-2">
            <History class="w-6 h-6 text-blue-500" />
            <h3 class="text-xl font-bold">Game Event Timeline</h3>
        </div>
        <button
            class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
                   {showBotEvents
                ? 'bg-amber-500/10 text-amber-600 border-amber-200'
                : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}"
            on:click={() => (showBotEvents = !showBotEvents)}
        >
            {#if showBotEvents}
                <Eye class="w-3.5 h-3.5" />
                Hide Bot Uploads
            {:else}
                <EyeOff class="w-3.5 h-3.5" />
                Show Bot Uploads
            {/if}
        </button>
    </div>

    <div class="relative pl-8 border-l-2 border-muted space-y-10">
        {#each filteredSteps as step, i}
            <div class="relative">
                <!-- Dot Indicator -->
                <div
                    class="absolute -left-[45px] top-0 flex items-center justify-center w-8 h-8 rounded-full bg-background border-2
                    {step.status === 'completed'
                        ? step.color
                        : step.status === 'active'
                          ? 'border-blue-500 text-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                          : step.status === 'cancelled'
                            ? 'border-red-500 text-red-500'
                            : 'border-muted text-muted-foreground'}"
                >
                    {#if step.icon}
                        <svelte:component this={step.icon} class="w-4 h-4" />
                    {:else}
                        <Circle class="w-3 h-3 fill-current" />
                    {/if}
                </div>

                <!-- Content -->
                <div
                    class="flex flex-col gap-1 bg-card/50 p-4 rounded-lg border border-border/50 hover:border-primary/30 transition-colors"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span
                            class="font-bold text-lg {step.status === 'active'
                                ? 'text-blue-500'
                                : ''} {step.status === 'cancelled'
                                ? 'text-red-500'
                                : ''}"
                        >
                            {step.label}
                        </span>
                        <div class="flex items-center gap-2">
                            {#if step.status === "active"}
                                <span
                                    class="text-[10px] uppercase tracking-wider font-bold bg-blue-500 text-white px-2 py-0.5 rounded animate-pulse"
                                >
                                    Active
                                </span>
                            {/if}
                            {#if step.txId}
                                <a
                                    href="{$web_explorer_uri_tx}{step.txId}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="text-muted-foreground hover:text-primary transition-colors"
                                    title="View Transaction"
                                >
                                    <ExternalLink class="w-4 h-4" />
                                </a>
                            {/if}
                        </div>
                    </div>
                    <p class="text-sm text-muted-foreground">
                        {step.description}
                    </p>
                    {#if step.date}
                        <div
                            class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mt-2 pt-2 border-t border-border/30"
                        >
                            <Clock class="w-3.5 h-3.5" />
                            <span>{step.date}</span>
                            {#if step.height && step.status === "completed"}
                                <span class="ml-auto opacity-60"
                                    >Block: {step.height}</span
                                >
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        {/each}
    </div>
</div>
