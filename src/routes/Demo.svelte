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
        Info,
        Gavel,
        FileText,
    } from "lucide-svelte";
    import { format, formatDistanceToNow } from "date-fns";
    import { mode } from "mode-watcher";
    import { onMount } from "svelte";

    // Mock Data Generators
    const randomHex = (length: number) =>
        [...Array(length)]
            .map(() => Math.floor(Math.random() * 16).toString(16))
            .join("");

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
        resolverStakeAmount: 1000000000n,
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
            soundtrackURL: "",
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
    let showAddParticipationModal = false;
    let showResolveModal = false;

    // Form fields for participation modal
    let participationPrompt = "";
    let participationSolverId = "";
    let participationPlayerName = "";

    // Derived State
    $: isParticipationEnded = currentBlockHeight >= game.deadlineBlock;
    $: deadlineDateDisplay = isParticipationEnded ? "Ended" : "Active";
    $: prizePool = game.participationFeeAmount * BigInt(participations.length);

    // Demo Actions
    function addMockParticipation() {
        const id = participations.length + 1;
        const realScore = BigInt(Math.floor(Math.random() * 1000));
        const scores = [
            realScore,
            BigInt(Math.floor(Math.random() * 1000)),
            BigInt(Math.floor(Math.random() * 1000)),
        ].sort(() => Math.random() - 0.5);

        const newParticipation: ValidParticipation = {
            boxId: `mock_participation_${id}`,
            box: {} as any,
            transactionId: `tx_id_${id}`,
            creationHeight: currentBlockHeight,
            value: game.participationFeeAmount,
            gameNftId: game.gameId,
            playerPK_Hex: `player_${id}_pk`,
            playerScript_Hex: "",
            commitmentC_Hex: randomHex(64),
            solverId_RawBytesHex: randomHex(64),
            solverId_String: participationSolverId || `solver_${id}`,
            hashLogs_Hex: randomHex(64),
            scoreList: scores,
            reputationOpinions: [],
            status: "Submitted",
            spent: false,
        };
        // Store the real score for demo purposes
        (newParticipation as any).demoRealScore = realScore;
        (newParticipation as any).demoPrompt = participationPrompt;
        (newParticipation as any).demoPlayerName =
            participationPlayerName || `Player ${id}`;

        participations = [...participations, newParticipation];
        demoMessage =
            "A new participation has been added! The prize pool increases.";

        // Reset form fields
        participationPrompt = "";
        participationSolverId = "";
        participationPlayerName = "";
        showAddParticipationModal = false;
    }

    function addMockInvalidParticipation() {
        const id = participations.length + 1;
        const scores = [
            BigInt(999999),
            BigInt(Math.floor(Math.random() * 1000)),
            BigInt(Math.floor(Math.random() * 1000)),
        ].sort(() => Math.random() - 0.5);

        const newParticipation: ValidParticipation = {
            boxId: `mock_participation_${id}`,
            box: {} as any,
            transactionId: `tx_id_${id}`,
            creationHeight: currentBlockHeight,
            value: game.participationFeeAmount,
            gameNftId: game.gameId,
            playerPK_Hex: `player_${id}_pk`,
            playerScript_Hex: "",
            commitmentC_Hex: randomHex(64),
            solverId_RawBytesHex: randomHex(64),
            solverId_String: participationSolverId || "bad_solver_id",
            hashLogs_Hex: randomHex(64),
            scoreList: scores,
            reputationOpinions: [],
            status: "Submitted",
            spent: false,
        };
        // Mark it as "invalid" for demo purposes
        (newParticipation as any).isDemoInvalid = true;
        (newParticipation as any).demoRealScore = BigInt(
            Math.floor(Math.random() * 1000),
        ); // The real score is much lower
        (newParticipation as any).demoPrompt = participationPrompt;
        (newParticipation as any).demoPlayerName =
            participationPlayerName || `Player ${id}`;

        participations = [...participations, newParticipation];
        demoMessage =
            "A SUSPICIOUS participation has been added! It claims a very high score.";

        // Reset form fields
        participationPrompt = "";
        participationSolverId = "";
        participationPlayerName = "";
        showAddParticipationModal = false;
    }

    function calculateEffectiveScore(
        score: bigint,
        deadline: number,
        creation: number,
    ) {
        // Simplified version of the real formula: score * (1 + (deadline - creation) / 1000)
        const bonus = Math.max(0, (deadline - creation) / 100);
        return Number(score) * (1 + bonus);
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

    function resolveGameWithWinner(p: AnyParticipation, index: number) {
        game = {
            ...game,
            revealedS_Hex: "revealed_secret_value",
            winnerCandidateCommitment: p.commitmentC_Hex,
            resolverPK_Hex: "resolver_pk",
        } as GameResolution;
        demoMessage = `Game Resolved! You picked Participant #${index + 1} as the winner.`;
        demoStep = 2;
        showResolveModal = false;
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
        demoStep = 4;
    }

    function judgesInvalidate() {
        const winnerCommitment = (game as GameResolution)
            .winnerCandidateCommitment;
        const winnerIndex = participations.findIndex(
            (p) => p.commitmentC_Hex === winnerCommitment,
        );

        if (winnerIndex !== -1) {
            // Mark as invalidated
            (participations[winnerIndex] as any).status = "Consumed";
            (participations[winnerIndex] as any).reason = "invalidated";
            participations = [...participations];
        }

        // Reset winner in game state
        game = {
            ...game,
            winnerCandidateCommitment: null,
        } as GameResolution;

        demoMessage =
            "Judges have invalidated the winner! The creator's stake is slashed and distributed among judges. The resolver must now pick a different winner.";
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
            return g.resolverStakeAmount;
        }
        return 0n;
    }

    function clampPct(v: number) {
        return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }

    // Prize Distribution Logic (Simplified for Demo)
    $: resolverPct =
        game.status === "Active"
            ? (game as GameActive).commissionPercentage
            : (game as any).resolverCommission || 5;
    $: judgesTotalPct =
        Number((game as any).perJudgeComissionPercentage) * game.judges.length;
    $: developersPct = game.constants.DEV_COMMISSION_PERCENTAGE;
    $: winnerPct = Math.max(
        0,
        100 - (resolverPct + judgesTotalPct + developersPct),
    );

    function isInvalidParticipation(p: AnyParticipation | undefined) {
        return p && (p as any).isDemoInvalid === true;
    }

    function isInvalidated(p: AnyParticipation) {
        return (
            (p as any).status === "Consumed" &&
            (p as any).reason === "invalidated"
        );
    }

    function getSecretHash(g: AnyGame) {
        return (g as any).secretHash || "N/A";
    }

    function getSeed(g: AnyGame) {
        return (g as any).seed || "N/A";
    }

    function getDemoRealScore(p: AnyParticipation) {
        return (p as any).demoRealScore;
    }

    function getScoreClass(score: bigint, p: AnyParticipation, status: string) {
        if (status === "Resolution" || status === "Finalized") {
            return score === getDemoRealScore(p)
                ? "bg-green-500/20 text-green-600 font-bold border border-green-500/30"
                : "bg-muted text-muted-foreground opacity-50";
        }
        return "bg-muted text-muted-foreground";
    }

    $: winnerParticipation = participations.find(
        (p) =>
            p.commitmentC_Hex ===
            (game as GameResolution).winnerCandidateCommitment,
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
                        on:click={() => (showAddParticipationModal = true)}
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
                        on:click={() => (showResolveModal = true)}
                    >
                        <CheckCircle class="w-4 h-4 mr-2" /> Resolve Game
                    </Button>
                {:else if game.status === "Resolution" && game.winnerCandidateCommitment}
                    {#if isInvalidParticipation(winnerParticipation)}
                        <Button
                            variant="destructive"
                            size="sm"
                            on:click={judgesInvalidate}
                        >
                            <Gavel class="w-4 h-4 mr-2" /> Judges Invalidate
                        </Button>
                    {:else}
                        <Button
                            variant="secondary"
                            size="sm"
                            on:click={finalizeGame}
                        >
                            <Trophy class="w-4 h-4 mr-2" /> Finalize Game
                        </Button>
                    {/if}
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
        <!-- DIDACTIC PANEL -->
        <div
            class="mb-8 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-xl p-6 shadow-sm"
        >
            <div class="flex items-start gap-4">
                <div class="bg-indigo-600 p-2 rounded-lg text-white">
                    <Info class="w-6 h-6" />
                </div>
                <div class="flex-1">
                    <h3
                        class="text-indigo-900 dark:text-indigo-300 font-bold text-lg mb-2"
                    >
                        How it works: {game.status} Phase
                    </h3>
                    <div
                        class="text-indigo-800/80 dark:text-indigo-400/80 text-sm space-y-2"
                    >
                        {#if game.status === "Active"}
                            <p>
                                In this phase, the competition is open.
                                Participants submit their <strong
                                    >Commitments (C)</strong
                                >. A commitment is a cryptographic hash that
                                hides the actual prompt, logs, and score until
                                the resolution phase.
                            </p>
                            <p>
                                The <strong>Resolver Stake</strong> ensures the creator
                                will eventually reveal the secret to resolve the
                                game fairly.
                            </p>
                        {:else if game.status === "Resolution" && !game.winnerCandidateCommitment}
                            <p>
                                The deadline has passed. Now the <strong
                                    >Resolver</strong
                                >
                                (usually the creator) must reveal the
                                <strong>Secret (S)</strong>. This secret,
                                combined with each participant's commitment,
                                allows anyone to verify the actual scores.
                            </p>
                            <p>
                                The resolver then selects the participant with
                                the highest valid score as the <strong
                                    >Winner Candidate</strong
                                >.
                            </p>
                        {:else if game.status === "Resolution" && game.winnerCandidateCommitment}
                            <p>
                                A winner has been proposed. Now <strong
                                    >Judges</strong
                                > (off-chain bots or humans) verify the result. They
                                run the solver with the revealed logs to see if they
                                get the same score.
                            </p>
                            <p>
                                If a judge finds the result is fake, they issue
                                an <strong>Invalidation</strong>. If the winner
                                is invalidated, the resolver's stake is slashed!
                            </p>
                            <div
                                class="mt-4 p-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg border border-indigo-200 dark:border-indigo-800"
                            >
                                <p
                                    class="font-bold text-indigo-900 dark:text-indigo-200"
                                >
                                    Game Theory Tip:
                                </p>
                                <p class="text-xs italic">
                                    The resolver is incentivized to pick the real
                                    winner because if they pick a fake one, they
                                    lose their stake. Judges are incentivized to
                                    catch cheaters to earn a portion of the
                                    slashed stake.
                                </p>
                            </div>
                        {:else if game.status === "Finalized"}
                            <p>
                                The game is over. The funds have been
                                distributed. You can see the final prize
                                distribution and the winner in the list below.
                            </p>
                        {/if}
                    </div>
                </div>
            </div>
        </div>

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
                    <div class="flex items-center gap-2 mb-3">
                        <Trophy class="w-5 h-5 text-amber-500" />
                        <span class="font-semibold">Prize Distribution</span>
                    </div>
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
                            style:width="{clampPct(resolverPct)}%"
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
                            Creator ({resolverPct.toFixed(2)}%)
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
                            <div class="info-block">
                                <span
                                    class="block text-xs text-muted-foreground"
                                    >Secret Hash</span
                                >
                                <span class="font-mono break-all"
                                    >{getSecretHash(game)}</span
                                >
                            </div>
                            <div class="info-block">
                                <span
                                    class="block text-xs text-muted-foreground"
                                    >Seed</span
                                >
                                <span class="font-mono break-all"
                                    >{getSeed(game)}</span
                                >
                            </div>
                            {#if game.status === "Resolution" && game.revealedS_Hex}
                                <div class="info-block md:col-span-2">
                                    <span
                                        class="block text-xs text-muted-foreground"
                                        >Revealed Secret (S)</span
                                    >
                                    <span
                                        class="font-mono break-all text-green-600 dark:text-green-400 font-bold"
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
                            class="participation-card relative rounded-lg shadow-lg overflow-hidden border bg-card
                            {game.status === 'Resolution' &&
                            game.winnerCandidateCommitment === p.commitmentC_Hex
                                ? 'border-yellow-400 ring-2 ring-yellow-400/50'
                                : 'border-border'}"
                        >
                            {#if game.status === "Resolution" && game.winnerCandidateCommitment === p.commitmentC_Hex}
                                <div
                                    class="absolute top-0 right-0 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-bl-lg z-10"
                                >
                                    WINNER CANDIDATE
                                </div>
                            {/if}

                            {#if isInvalidated(p)}
                                <div
                                    class="absolute top-0 right-0 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-bl-lg z-10"
                                >
                                    DISQUALIFIED
                                </div>
                            {/if}

                            <div
                                class="p-4 border-b border-border/50 bg-muted/30"
                            >
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-3">
                                        <div
                                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm"
                                        >
                                            #{i + 1}
                                        </div>
                                        <div>
                                            <div
                                                class="text-xs uppercase text-muted-foreground font-semibold"
                                            >
                                                Player
                                            </div>
                                            <div class="font-mono text-sm">
                                                {p.playerPK_Hex}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div
                                class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm"
                            >
                                <div class="info-block">
                                    <span class="info-label">Commitment</span>
                                    <span
                                        class="font-mono text-xs break-all block bg-muted/50 p-1 rounded"
                                        title={p.commitmentC_Hex}
                                    >
                                        {p.commitmentC_Hex.slice(
                                            0,
                                            10,
                                        )}...{p.commitmentC_Hex.slice(-4)}
                                    </span>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Solver ID</span>
                                    <span
                                        class="font-mono text-xs break-all block bg-muted/50 p-1 rounded"
                                        title={p.solverId_RawBytesHex}
                                    >
                                        {p.solverId_RawBytesHex.slice(
                                            0,
                                            10,
                                        )}...{p.solverId_RawBytesHex.slice(-4)}
                                    </span>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Hash Logs</span>
                                    <span
                                        class="font-mono text-xs break-all block bg-muted/50 p-1 rounded"
                                        title={p.hashLogs_Hex}
                                    >
                                        {p.hashLogs_Hex.slice(
                                            0,
                                            10,
                                        )}...{p.hashLogs_Hex.slice(-4)}
                                    </span>
                                </div>
                                <div class="info-block">
                                    <span class="info-label">Score List</span>
                                    <div class="flex flex-wrap gap-1">
                                        {#each p.scoreList as score, idx}
                                            <span
                                                class="font-mono text-xs px-1.5 py-0.5 rounded {getScoreClass(
                                                    score,
                                                    p,
                                                    game.status,
                                                )}"
                                            >
                                                {score.toString()}
                                            </span>
                                        {/each}
                                    </div>
                                    {#if game.status === "Resolution" || game.status === "Finalized"}
                                        <span
                                            class="text-[10px] text-indigo-500 font-semibold mt-1"
                                        >
                                            Eff: {calculateEffectiveScore(
                                                getDemoRealScore(p),
                                                game.deadlineBlock,
                                                p.creationHeight,
                                            ).toFixed(0)}
                                        </span>
                                    {/if}
                                </div>
                            </div>

                            <!-- Didactic Message for this participation -->
                            <div
                                class="bg-blue-50/50 dark:bg-blue-900/10 p-3 border-t border-blue-100 dark:border-blue-800/30 text-xs text-blue-600 dark:text-blue-400 flex gap-2"
                            >
                                <Info class="w-4 h-4 flex-shrink-0 mt-0.5" />
                                <p>
                                    {#if isInvalidParticipation(p)}
                                        {#if game.status === "Active"}
                                            This participation looks suspicious
                                            (high score), but during the Active
                                            phase, everything is hidden by the
                                            commitment.
                                        {:else if game.status === "Resolution"}
                                            <strong>Didactic:</strong> This participation
                                            is invalid! As a judge, your off-chain
                                            bot would test the solver and see that
                                            the logs don't reproduce the claimed
                                            score. You should invalidate this.
                                        {:else}
                                            This participation was flagged as
                                            invalid.
                                        {/if}
                                    {:else}
                                        This participation includes a commitment
                                        (C) which hides the score and logs. The
                                        solver ID identifies the algorithm used.
                                    {/if}
                                </p>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </section>
    </div>

    <!-- Add Participation Modal -->
    {#if showAddParticipationModal}
        <div
            class="modal-overlay fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[100] p-4 backdrop-blur-sm"
            on:click|self={() => (showAddParticipationModal = false)}
            role="presentation"
        >
            <div
                class="modal-content {$mode === 'dark'
                    ? 'bg-slate-800 text-gray-200 border border-slate-700'
                    : 'bg-white text-gray-800 border border-gray-200'} p-6 rounded-xl shadow-2xl w-full max-w-lg lg:max-w-2xl transform transition-all"
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
                        Submit Participation (Demo)
                    </h3>
                    <Button
                        variant="ghost"
                        size="icon"
                        on:click={() => (showAddParticipationModal = false)}
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
                    <div class="space-y-4">
                        <div
                            class="p-4 rounded-lg border text-sm {$mode ===
                            'dark'
                                ? 'bg-blue-900/20 border-blue-800 text-blue-300'
                                : 'bg-blue-50 border-blue-100 text-blue-700'}"
                        >
                            <p class="font-bold mb-1">Didactic Note:</p>
                            <p>
                                In the real app, you would submit your prompt
                                here. The app would then generate multiple
                                scores and create a <strong
                                    >Commitment (C)</strong
                                > to hide them.
                            </p>
                        </div>

                        <div class="grid grid-cols-1 gap-4">
                            <div>
                                <label
                                    for="playerName"
                                    class="block text-sm font-medium mb-1 {$mode ===
                                    'dark'
                                        ? 'text-gray-300'
                                        : 'text-gray-700'}"
                                >
                                    Player Name (Optional)
                                </label>
                                <input
                                    id="playerName"
                                    type="text"
                                    bind:value={participationPlayerName}
                                    placeholder="e.g., Alice"
                                    class="w-full px-4 py-2 rounded-lg border transition-all text-sm {$mode ===
                                    'dark'
                                        ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-500'
                                        : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'}"
                                />
                            </div>

                            <div>
                                <label
                                    for="prompt"
                                    class="block text-sm font-medium mb-1 {$mode ===
                                    'dark'
                                        ? 'text-gray-300'
                                        : 'text-gray-700'}"
                                >
                                    Your Prompt <span class="text-red-500"
                                        >*</span
                                    >
                                </label>
                                <textarea
                                    id="prompt"
                                    bind:value={participationPrompt}
                                    placeholder="Enter your creative prompt here..."
                                    rows="3"
                                    class="w-full px-4 py-2 rounded-lg border transition-all resize-none text-sm {$mode ===
                                    'dark'
                                        ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-500'
                                        : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'}"
                                ></textarea>
                                <p
                                    class="text-xs mt-1 {$mode === 'dark'
                                        ? 'text-gray-500'
                                        : 'text-gray-600'}"
                                >
                                    This prompt will be sent to the AI service
                                    to generate your solution.
                                </p>
                            </div>

                            <div>
                                <label
                                    for="solverId"
                                    class="block text-sm font-medium mb-1 {$mode ===
                                    'dark'
                                        ? 'text-gray-300'
                                        : 'text-gray-700'}"
                                >
                                    Solver ID (Optional)
                                </label>
                                <input
                                    id="solverId"
                                    type="text"
                                    bind:value={participationSolverId}
                                    placeholder="e.g., gpt-4, claude-3, custom-solver"
                                    class="w-full px-4 py-2 rounded-lg border transition-all text-sm {$mode ===
                                    'dark'
                                        ? 'bg-slate-700 border-slate-600 text-slate-300 placeholder-slate-500'
                                        : 'bg-gray-50 border-gray-300 text-gray-700 placeholder-gray-400'}"
                                />
                                <p
                                    class="text-xs mt-1 {$mode === 'dark'
                                        ? 'text-gray-500'
                                        : 'text-gray-600'}"
                                >
                                    The AI service that will process your
                                    prompt.
                                </p>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                            <Button
                                variant="default"
                                class="w-full py-6 text-base {$mode === 'dark'
                                    ? 'bg-slate-500 hover:bg-slate-600 text-white'
                                    : 'bg-slate-500 hover:bg-slate-600 text-white'} font-semibold"
                                on:click={addMockParticipation}
                                disabled={!participationPrompt.trim()}
                            >
                                <Sparkles class="w-5 h-5 mr-2" />
                                Submit Honest Participation
                            </Button>
                            <Button
                                variant="destructive"
                                class="w-full py-6 text-base font-semibold"
                                on:click={addMockInvalidParticipation}
                                disabled={!participationPrompt.trim()}
                            >
                                <AlertCircle class="w-5 h-5 mr-2" />
                                Submit "Cheating" Participation
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Resolve Game Modal -->
    {#if showResolveModal}
        <div
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            on:click={() => (showResolveModal = false)}
        >
            <div
                class="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden modal-content"
                on:click|stopPropagation
            >
                <div class="p-6 border-b border-border bg-muted/30">
                    <h3 class="text-xl font-bold flex items-center gap-2">
                        <CheckCircle class="w-6 h-6 text-green-500" />
                        Resolve Game (Demo)
                    </h3>
                </div>
                <div class="p-6 space-y-6">
                    <div
                        class="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-100 dark:border-yellow-800 text-sm text-yellow-700 dark:text-yellow-300"
                    >
                        <p class="font-bold mb-1">Didactic Note:</p>
                        <p>
                            As the resolver, you now reveal the <strong
                                >Secret (S)</strong
                            >. This allows the protocol to verify which score in
                            each participant's list is the "real" one.
                        </p>
                    </div>

                    <div class="space-y-4">
                        <p class="font-semibold text-sm">
                            Select a Winner Candidate:
                        </p>
                        <div class="grid gap-2 max-h-60 overflow-y-auto p-1">
                            {#each participations as p, i}
                                <button
                                    class="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                                    on:click={() => resolveGameWithWinner(p, i)}
                                >
                                    <div class="flex items-center gap-3">
                                        <div
                                            class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs"
                                        >
                                            #{i + 1}
                                        </div>
                                        <div>
                                            <div
                                                class="text-xs font-mono opacity-60"
                                            >
                                                {p.playerPK_Hex.slice(0, 12)}...
                                            </div>
                                            <div class="text-sm font-bold">
                                                Real Score: {getDemoRealScore(
                                                    p,
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div
                                            class="text-[10px] uppercase text-muted-foreground"
                                        >
                                            Eff. Score
                                        </div>
                                        <div class="font-bold text-indigo-500">
                                            {calculateEffectiveScore(
                                                getDemoRealScore(p),
                                                game.deadlineBlock,
                                                p.creationHeight,
                                            ).toFixed(0)}
                                        </div>
                                    </div>
                                </button>
                            {/each}
                        </div>
                    </div>
                </div>
                <div
                    class="p-4 bg-muted/30 border-t border-border flex justify-end"
                >
                    <Button
                        variant="ghost"
                        on:click={() => (showResolveModal = false)}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="postcss">
    /* Add any specific styles here if needed, mostly using Tailwind */
    .hero-bg-image {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
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
</style>
