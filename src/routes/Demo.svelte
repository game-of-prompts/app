<script lang="ts">
    import {
        type AnyGame,
        type AnyParticipation,
        type GameActive,
        type GameResolution,
        type GameCancellation,
        type GameFinalized,
        type ValidParticipation,
        GameState,
    } from "$lib/common/game";
    import { marked } from "marked";
    import { Button } from "$lib/components/ui/button";
    import {
        ShieldCheck,
        Calendar,
        Trophy,
        Users,
        Share2,
        Edit,
        CheckSquare,
        ExternalLink,
        Sparkles,
        Cpu,
        ChevronDown,
        Settings,
        Play,
        FastForward,
        CheckCircle,
        AlertCircle,
    } from "lucide-svelte";
    import { format, formatDistanceToNow } from "date-fns";
    import { mode } from "mode-watcher";
    import { onMount } from "svelte";

    // Mock Data Generators
    const generateMockGame = (): GameActive => ({
        boxId: "mock_box_id_123",
        box: {} as any,
        platform: {} as any,
        status: "Active",
        gameId: "mock_game_nft_id",
        commissionPercentage: 5,
        secretHash: "mock_secret_hash",
        seed: "mock_seed_value",
        ceremonyDeadline: 1000,
        judges: ["judge1_token", "judge2_token"],
        deadlineBlock: 1200,
        creatorStakeAmount: 1000000000n,
        participationFeeAmount: 100000000n,
        participationTokenId: "",
        perJudgeComissionPercentage: 1n,
        content: {
            rawJsonString: "{}",
            title: "Demo Competition: Best AI Art",
            description:
                "Welcome to the **Game of Prompts** demo! \n\nThis is a simulated competition to help you understand the lifecycle of a game. \n\n**Goal:** Create the most stunning AI-generated image using the provided service.\n\nFollow the steps in the 'Demo Controls' panel to interact with this simulation.",
            serviceId: "mock_service_id",
            imageURL: "https://picsum.photos/seed/gop-demo/800/400",
            indetermismIndex: 1,
        },
        value: 2000000000n,
        reputationOpinions: [],
        reputation: 150,
        constants: {
            DEV_COMMISSION_PERCENTAGE: 2,
            STAKE_DENOMINATOR: 100n,
        } as any,
    });

    // State
    let game: AnyGame = generateMockGame();
    let participations: AnyParticipation[] = [];
    let currentBlockHeight = 1000;
    let demoStep = 0;
    let demoMessage =
        "Welcome! The game is currently ACTIVE. Participants can submit their solutions.";

    // Derived State
    $: isParticipationEnded = currentBlockHeight >= game.deadlineBlock;
    $: deadlineDateDisplay = isParticipationEnded ? "Ended" : "Active";
    $: prizePool = game.participationFeeAmount * BigInt(participations.length);

    // Demo Actions
    function addMockParticipation() {
        const id = participations.length + 1;
        const newParticipation: ValidParticipation = {
            boxId: `mock_participation_${id}`,
            box: {} as any,
            transactionId: `tx_id_${id}`,
            creationHeight: currentBlockHeight,
            value: game.participationFeeAmount,
            gameNftId: game.gameId,
            playerPK_Hex: `player_${id}_pk`,
            playerScript_Hex: "",
            commitmentC_Hex: `commitment_${id}`,
            solverId_RawBytesHex: "",
            hashLogs_Hex: "",
            scoreList: [BigInt(Math.floor(Math.random() * 1000))],
            reputationOpinions: [],
            status: "Submitted",
            spent: false,
        };
        participations = [...participations, newParticipation];
        demoMessage =
            "A new participation has been added! The prize pool increases.";
    }

    function fastForwardToDeadline() {
        currentBlockHeight = game.deadlineBlock + 1;
        demoMessage =
            "The deadline has passed! The game is now in the RESOLUTION phase. No more participations can be accepted.";
        // Transition to Resolution State
        game = {
            ...game,
            status: "Resolution",
            resolutionDeadline: currentBlockHeight + 100,
            revealedS_Hex: "",
            winnerCandidateCommitment: null,
            resolverPK_Hex: null,
            resolverScript_Hex: "",
            resolverCommission: 5,
        } as unknown as GameResolution;
        demoStep = 1;
    }

    function resolveGame() {
        if (participations.length === 0) {
            demoMessage = "Cannot resolve a game with no participants!";
            return;
        }
        // Pick a random winner
        const winner =
            participations[Math.floor(Math.random() * participations.length)];

        game = {
            ...game,
            revealedS_Hex: "revealed_secret_value",
            winnerCandidateCommitment: winner.commitmentC_Hex,
            resolverPK_Hex: "resolver_pk",
        } as GameResolution;

        demoMessage = `Game Resolved! The winner is Participant #${participations.indexOf(winner) + 1}. Judges can now review the result.`;
        demoStep = 2;
    }

    function finalizeGame() {
        game = {
            ...game,
            status: "Finalized",
            judgeFinalizationBlock: currentBlockHeight + 50,
            winnerFinalizationDeadline: currentBlockHeight + 100,
        } as unknown as GameFinalized;
        demoMessage =
            "Game Finalized! Funds have been distributed to the winner, creator, judges, and protocol.";
        demoStep = 3;
    }

    function resetDemo() {
        game = generateMockGame();
        participations = [];
        currentBlockHeight = 1000;
        demoStep = 0;
        demoMessage =
            "Welcome! The game is currently ACTIVE. Participants can submit their solutions.";
    }

    // UI Helpers
    function formatTokenBigInt(amount: bigint, decimals: number = 9) {
        return (Number(amount) / Math.pow(10, decimals)).toFixed(2);
    }

    function getDisplayStake(g: AnyGame) {
        if (
            g.status === "Active" ||
            g.status === "Resolution" ||
            g.status === "Finalized"
        ) {
            return g.creatorStakeAmount;
        }
        return 0n;
    }

    function clampPct(v: number) {
        return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }

    // Prize Distribution Logic (Simplified for Demo)
    $: creatorPct =
        game.status === "Active"
            ? (game as GameActive).commissionPercentage
            : (game as any).resolverCommission || 5;
    $: judgesTotalPct =
        Number((game as any).perJudgeComissionPercentage) * game.judges.length;
    $: developersPct = game.constants.DEV_COMMISSION_PERCENTAGE;
    $: winnerPct = Math.max(
        0,
        100 - (creatorPct + judgesTotalPct + developersPct),
    );
</script>

<div
    class="min-h-screen {$mode === 'dark'
        ? 'bg-slate-900 text-gray-200'
        : 'bg-gray-50 text-gray-800'}"
>
    <!-- DEMO CONTROLS BAR -->
    <div class="sticky top-0 z-50 bg-indigo-600 text-white shadow-lg p-4">
        <div
            class="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4"
        >
            <div class="flex items-center gap-3">
                <div class="bg-white/20 p-2 rounded-full">
                    <Play class="w-6 h-6" />
                </div>
                <div>
                    <h2 class="font-bold text-lg">Demo Mode</h2>
                    <p class="text-sm text-indigo-100">{demoMessage}</p>
                </div>
            </div>

            <div class="flex gap-2 flex-wrap justify-center">
                {#if game.status === "Active"}
                    <Button
                        variant="secondary"
                        size="sm"
                        on:click={addMockParticipation}
                    >
                        <Users class="w-4 h-4 mr-2" /> Add Participant
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        on:click={fastForwardToDeadline}
                    >
                        <FastForward class="w-4 h-4 mr-2" /> Fast Forward to Deadline
                    </Button>
                {:else if game.status === "Resolution" && !game.winnerCandidateCommitment}
                    <Button
                        variant="secondary"
                        size="sm"
                        on:click={resolveGame}
                    >
                        <CheckCircle class="w-4 h-4 mr-2" /> Resolve Game
                    </Button>
                {:else if game.status === "Resolution" && game.winnerCandidateCommitment}
                    <Button
                        variant="secondary"
                        size="sm"
                        on:click={finalizeGame}
                    >
                        <Trophy class="w-4 h-4 mr-2" /> Finalize Game
                    </Button>
                {:else if game.status === "Finalized"}
                    <Button variant="secondary" size="sm" on:click={resetDemo}>
                        <Sparkles class="w-4 h-4 mr-2" /> Restart Demo
                    </Button>
                {/if}
                <Button
                    variant="destructive"
                    size="sm"
                    on:click={resetDemo}
                    class="ml-2"
                >
                    Reset
                </Button>
            </div>
        </div>
    </div>

    <div class="game-container max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <!-- HERO SECTION -->
        <section
            class="hero-section relative rounded-xl shadow-2xl overflow-hidden mb-12"
        >
            <div class="hero-bg-image">
                <img
                    src={game.content.imageURL}
                    alt=""
                    class="absolute inset-0 w-full h-full object-cover blur-md scale-110"
                />
                <div
                    class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/60 to-transparent"
                ></div>
            </div>
            <div
                class="relative z-10 p-8 md:p-12 flex flex-col md:flex-row gap-8 items-center text-white"
            >
                <div class="md:w-1/3 flex-shrink-0">
                    <img
                        src={game.content.imageURL}
                        alt="Game Banner"
                        class="w-full h-auto max-h-96 object-contain rounded-lg shadow-lg"
                    />
                </div>
                <div
                    class="flex-1 text-center md:text-left mt-6 md:mt-0 ml-0 md:ml-6"
                >
                    <div class="flex items-center gap-2 mb-2">
                        <span
                            class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider
                            {game.status === 'Active'
                                ? 'bg-green-500/80'
                                : game.status === 'Resolution'
                                  ? 'bg-yellow-500/80'
                                  : game.status === 'Finalized'
                                    ? 'bg-blue-500/80'
                                    : 'bg-gray-500/80'}"
                        >
                            {game.status}
                        </span>
                        <span class="text-sm opacity-75"
                            >Block Height: {currentBlockHeight}</span
                        >
                    </div>

                    <h1
                        class="text-4xl lg:text-5xl font-bold font-['Russo_One'] mb-3 text-white"
                    >
                        {game.content.title}
                    </h1>

                    <div
                        class="stat-blocks-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mt-6"
                    >
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <Users class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{game.reputation}</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Reputation</span
                            >
                        </div>
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <Edit class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{formatTokenBigInt(
                                    game.participationFeeAmount,
                                )} ERG</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Fee per Player</span
                            >
                        </div>
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <Users class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{participations.length}</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Participants</span
                            >
                        </div>
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <Trophy class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{formatTokenBigInt(prizePool)} ERG</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Prize Pool</span
                            >
                        </div>
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <ShieldCheck class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{formatTokenBigInt(getDisplayStake(game))} ERG</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Creator Stake</span
                            >
                        </div>
                        <div
                            class="stat-block bg-white/10 backdrop-blur-sm p-3 rounded-lg flex flex-col items-center justify-center"
                        >
                            <Calendar class="w-5 h-5 mb-1 opacity-80" />
                            <span class="font-bold text-lg"
                                >{isParticipationEnded
                                    ? "Ended"
                                    : "Active"}</span
                            >
                            <span
                                class="text-xs opacity-70 uppercase tracking-wide"
                                >Deadline</span
                            >
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- INFO SECTION -->
        <section
            class="game-info-section mb-12 p-6 rounded-xl shadow-lg bg-card border border-border/50"
        >
            <div
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6"
            >
                <!-- Description -->
                <div
                    class="prose prose-sm {$mode === 'dark'
                        ? 'text-slate-300'
                        : 'text-gray-800'} max-w-none mb-6 md:col-span-2 lg:col-span-3"
                >
                    {@html marked.parse(game.content.description)}
                </div>

                <!-- Prize Distribution -->
                <div class="form-group lg:col-span-2">
                    <span class="mb-3 block font-semibold"
                        >Prize Distribution</span
                    >
                    <div
                        class="w-full h-4 bg-gray-200 rounded-full overflow-hidden flex"
                    >
                        <div
                            class="bg-yellow-400 h-full"
                            style:width="{clampPct(winnerPct)}%"
                            title="Winner"
                        ></div>
                        <div
                            class="bg-blue-500 h-full"
                            style:width="{clampPct(creatorPct)}%"
                            title="Creator"
                        ></div>
                        <div
                            class="bg-purple-500 h-full"
                            style:width="{clampPct(judgesTotalPct)}%"
                            title="Judges"
                        ></div>
                        <div
                            class="bg-gray-500 h-full"
                            style:width="{clampPct(developersPct)}%"
                            title="Devs"
                        ></div>
                    </div>
                    <div class="flex flex-wrap gap-4 mt-2 text-xs">
                        <div class="flex items-center gap-1">
                            <div
                                class="w-3 h-3 bg-yellow-400 rounded-full"
                            ></div>
                            Winner ({winnerPct.toFixed(2)}%)
                        </div>
                        <div class="flex items-center gap-1">
                            <div class="w-3 h-3 bg-blue-500 rounded-full"></div>
                            Creator ({creatorPct.toFixed(2)}%)
                        </div>
                        <div class="flex items-center gap-1">
                            <div
                                class="w-3 h-3 bg-purple-500 rounded-full"
                            ></div>
                            Judges ({judgesTotalPct.toFixed(2)}%)
                        </div>
                        <div class="flex items-center gap-1">
                            <div class="w-3 h-3 bg-gray-500 rounded-full"></div>
                            Protocol ({developersPct.toFixed(2)}%)
                        </div>
                    </div>
                </div>

                <!-- Technical Details -->
                <div class="col-span-1 md:col-span-2 lg:col-span-3 mt-4">
                    <details
                        class="group p-4 rounded-lg border bg-card shadow-sm"
                    >
                        <summary
                            class="flex justify-between items-center font-medium cursor-pointer list-none"
                        >
                            <div class="flex items-center gap-2">
                                <Settings class="w-5 h-5 text-gray-500" />
                                <span>Technical Details (Demo)</span>
                            </div>
                            <ChevronDown
                                class="w-5 h-5 transition group-open:rotate-180"
                            />
                        </summary>
                        <div
                            class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 text-sm"
                        >
                            <div class="info-block">
                                <span
                                    class="block text-xs text-muted-foreground"
                                    >Game ID</span
                                >
                                <span class="font-mono">{game.gameId}</span>
                            </div>
                            <div class="info-block">
                                <span
                                    class="block text-xs text-muted-foreground"
                                    >Status</span
                                >
                                <span class="font-mono">{game.status}</span>
                            </div>
                            {#if game.status === "Resolution" && game.revealedS_Hex}
                                <div class="info-block md:col-span-2">
                                    <span
                                        class="block text-xs text-muted-foreground"
                                        >Revealed Secret (S)</span
                                    >
                                    <span class="font-mono break-all"
                                        >{game.revealedS_Hex}</span
                                    >
                                </div>
                            {/if}
                        </div>
                    </details>
                </div>
            </div>
        </section>

        <!-- PARTICIPATIONS LIST -->
        <section class="participations-section">
            <h3 class="text-2xl font-bold mb-4">
                Participations ({participations.length})
            </h3>
            {#if participations.length === 0}
                <div
                    class="p-8 text-center border-2 border-dashed border-gray-300 rounded-xl"
                >
                    <p class="text-gray-500">
                        No participations yet. Use the Demo Controls to add one.
                    </p>
                </div>
            {:else}
                <div class="grid gap-4">
                    {#each participations as p, i}
                        <div
                            class="p-4 rounded-lg border bg-card shadow-sm flex items-center justify-between
                            {game.status === 'Resolution' &&
                            game.winnerCandidateCommitment === p.commitmentC_Hex
                                ? 'border-yellow-400 ring-2 ring-yellow-400/50'
                                : 'border-border'}"
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-bold text-gray-600"
                                >
                                    #{i + 1}
                                </div>
                                <div>
                                    <p class="font-mono text-sm">
                                        Commitment: {p.commitmentC_Hex}
                                    </p>
                                    <p class="text-xs text-muted-foreground">
                                        Tx: {p.transactionId}
                                    </p>
                                </div>
                            </div>
                            {#if game.status === "Resolution" && game.winnerCandidateCommitment === p.commitmentC_Hex}
                                <div
                                    class="flex items-center gap-2 text-yellow-600 font-bold"
                                >
                                    <Trophy class="w-5 h-5" />
                                    <span>Winner Candidate</span>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </section>
    </div>
</div>

<style>
    /* Add any specific styles here if needed, mostly using Tailwind */
    .hero-bg-image {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
    }
</style>
