<script lang="ts">
    // CORE IMPORTS
    import { writable, type Writable } from "svelte/store";
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { block_to_date, time_to_block } from "$lib/common/countdown";
    import { web_explorer_uri_tx, explorer_uri } from "$lib/ergo/envs";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { hexToBytes, uint8ArrayToHex } from "$lib/ergo/utils";
    import {
        validateGameContent,
        getUsagePercentage,
        type GameDetails,
    } from "$lib/ergo/utils/box-size-calculator";

    // UI COMPONENTS
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import {
        Trophy,
        Eye,
        EyeOff,
        Wand2,
        ChevronDown,
        ChevronUp,
        X,
        Trash2,
    } from "lucide-svelte";
    import { fetch_token_details } from "$lib/ergo/fetch";

    import { reputation_proof } from "$lib/common/store";
    import {
        FileSourceCreation,
        fetchFileSourcesByHash,
    } from "source-application";

    $: reputationProofAny = $reputation_proof as any;

    let platform = new ErgoPlatform();

    // --- State declarations
    let gameServiceIdStore = writable("");
    let gameImageHashStore = writable("");
    let gamePaperHashStore = writable("");

    $: gameServiceId = $gameServiceIdStore;
    $: gameImageHash = $gameImageHashStore;
    $: gamePaperHash = $gamePaperHashStore;

    let gameSecret: string = "";
    let showGameSecret: boolean = false;
    let gameTitle: string = "";
    let gameDescription: string = "";
    let creatorTokenId: string = "";
    let indetermismIndex: number = 1;
    let deadlineValue: number;
    let deadlineUnit: "days" | "minutes" = "days";
    let deadlineBlock: number | undefined;
    let deadlineBlockDateText: string = "";
    let creatorStakeAmount: number | undefined;
    let participationFeeAmount: number | undefined;
    let commissionPercentage: number | undefined;
    let perJudgeComissionPercentage: number | undefined;
    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let isSubmitting: boolean = false;

    let participationTokenId: string = ""; // "" para ERG
    let participationTokenDecimals: number = 9;
    let participationTokenName: string = "ERG";

    let selectedTokenOption: string = "ERG";
    let customTokenId: string = "";
    let isCustomToken: boolean = false;

    const DEFAULT_TOKENS = [
        {
            tokenId:
                "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04",
            title: "SigUSD",
            balance: 0,
            decimals: 2,
        },
        {
            tokenId:
                "886b7721bef42f60c6317d37d8752da8aca01898cae7dae61808c4a14225edc8",
            title: "GluonW GAU",
            balance: 0,
            decimals: 9,
        },
    ];

    // --- Box Size Validation ---
    $: gameDetailsObject = {
        title: gameTitle,
        description: gameDescription,
        image: gameImageHash,
        creatorTokenId: creatorTokenId,
        serviceId: gameServiceId,
        paper: gamePaperHash,
        indetermismIndex: indetermismIndex,
    } as GameDetails;

    let contentValidation = validateGameContent(
        {
            title: "",
            description: "",
            image: "",
            creatorTokenId: "",
            serviceId: "",
            paper: "",
            indetermismIndex: 1,
        },
        0,
    );
    let contentUsagePercentage = 0;
    let validationTimer: any;

    $: {
        if (validationTimer) clearTimeout(validationTimer);
        validationTimer = setTimeout(() => {
            const judgesCount = judges.filter(
                (e) => e.value && e.value.trim(),
            ).length;
            contentValidation = validateGameContent(
                gameDetailsObject,
                judgesCount,
                participationTokenId,
            );
            contentUsagePercentage = getUsagePercentage(
                gameDetailsObject,
                judgesCount,
                participationTokenId,
            );
        }, 500);
    }

    $: contentTooLarge = !contentValidation.isValid;
    $: estimatedBoxSize = contentValidation.estimatedBoxSize;

    // --- State for repeaters
    let judges: { id: number; value: string }[] = [{ id: 0, value: "" }];
    let nextJudgeId = 1;
    let judgesExpanded = false;

    // --- Modal state for FileSourceCreation
    let showFileSourceModal = false;
    let activeHashStore: Writable<string> = gameServiceIdStore;
    let modalFileType: "image" | "service" | "paper" = "image";

    function openFileSourceModal(
        hash: string,
        type: "image" | "service" | "paper",
    ) {
        modalFileType = type;
        if (type === "service") activeHashStore = gameServiceIdStore;
        else if (type === "image") activeHashStore = gameImageHashStore;
        else if (type === "paper") activeHashStore = gamePaperHashStore;

        activeHashStore.set(hash);
        showFileSourceModal = true;
    }

    function closeFileSourceModal() {
        showFileSourceModal = false;
    }

    function handleSourceAdded(txId: string) {
        console.log(`${modalFileType} source added:`, txId);
        closeFileSourceModal();
        updateSourceCounts();
    }

    let imageSourceCount = 0;
    let serviceSourceCount = 0;
    let paperSourceCount = 0;

    async function updateSourceCounts() {
        if (gameImageHash && gameImageHash.length === 64) {
            const sources = await fetchFileSourcesByHash(
                gameImageHash,
                $explorer_uri,
            );
            imageSourceCount = sources.length;
        } else {
            imageSourceCount = 0;
        }

        if (gameServiceId && gameServiceId.length === 64) {
            const sources = await fetchFileSourcesByHash(
                gameServiceId,
                $explorer_uri,
            );
            serviceSourceCount = sources.length;
        } else {
            serviceSourceCount = 0;
        }

        if (gamePaperHash && gamePaperHash.length === 64) {
            const sources = await fetchFileSourcesByHash(
                gamePaperHash,
                $explorer_uri,
            );
            paperSourceCount = sources.length;
        } else {
            paperSourceCount = 0;
        }
    }

    // Trigger search when hashes change (debounced ideally, but simple for now)
    $: if (gameImageHash && gameImageHash.length === 64) updateSourceCounts();
    $: if (gameServiceId && gameServiceId.length === 64) updateSourceCounts();
    $: if (gamePaperHash && gamePaperHash.length === 64) updateSourceCounts();

    // --- Logic for repeaters
    function addJudge() {
        judges = [...judges, { id: nextJudgeId++, value: "" }];
    }
    function removeJudge(id: number) {
        judges = judges.filter((j) => j.id !== id);
        if (judges.length === 0) addJudge(); // Always keep at least one input
    }

    // --- Logic functions
    $: {
        if (deadlineValue > 0) {
            calculateBlockLimit(deadlineValue, deadlineUnit);
        } else {
            deadlineBlock = undefined;
            deadlineBlockDateText = "";
        }
    }

    async function calculateBlockLimit(
        value: number,
        unit: "days" | "minutes",
    ) {
        if (!platform || !value || value <= 0) {
            deadlineBlock = undefined;
            deadlineBlockDateText = "";
            return;
        }
        try {
            let target_date = new Date();
            let milliseconds;
            if (unit === "days") {
                milliseconds = value * 24 * 60 * 60 * 1000;
            } else {
                // minutes
                milliseconds = value * 60 * 1000;
            }
            target_date.setTime(target_date.getTime() + milliseconds);
            deadlineBlock = await time_to_block(
                target_date.getTime(),
                platform,
            );
            deadlineBlockDateText = await block_to_date(
                deadlineBlock,
                platform,
            );
        } catch (error) {
            console.error("Error calculating block limit:", error);
            deadlineBlock = undefined;
            deadlineBlockDateText = "Error calculating deadline";
        }
    }

    function toTokenSmallestUnit(value: number | undefined): BigInt {
        if (value === undefined || value === null || isNaN(value))
            return BigInt(0);
        const multiplier = 10 ** participationTokenDecimals;
        return BigInt(Math.round(value * multiplier));
    }

    // --- Token Reactive Logic ---
    let customTokenDebounceTimer: any;
    $: {
        if (customTokenDebounceTimer) clearTimeout(customTokenDebounceTimer);

        isCustomToken = selectedTokenOption === "custom";

        if (isCustomToken) {
            if (customTokenId && customTokenId.length === 64) {
                participationTokenId = customTokenId;
                participationTokenName = "Loading...";

                customTokenDebounceTimer = setTimeout(async () => {
                    try {
                        const { name, decimals } =
                            await fetch_token_details(customTokenId);
                        participationTokenName = name;
                        participationTokenDecimals = decimals;
                    } catch (e) {
                        participationTokenName = "Unknown Token";
                        participationTokenDecimals = 0;
                    }
                }, 500);
            } else {
                participationTokenId = "";
                participationTokenName = "Enter 64-char ID";
                participationTokenDecimals = 0;
            }
        } else if (selectedTokenOption && selectedTokenOption !== "ERG") {
            const token = DEFAULT_TOKENS.find(
                (t) => t.tokenId === selectedTokenOption,
            );

            participationTokenId = token?.tokenId || "";
            participationTokenDecimals = token?.decimals || 0;
            participationTokenName = token?.title || "Unknown";
        } else {
            selectedTokenOption = "ERG";
            participationTokenId = "";
            participationTokenDecimals = 9;
            participationTokenName = "ERG";
        }
    }

    // --- Prize Distribution Reactive Variables ---
    function asNumber(v: any) {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    function clampPct(v: number) {
        return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));
    }

    $: judgesCount = judges.filter((e) => e.value && e.value.trim()).length;
    $: creatorPct = asNumber(commissionPercentage);
    $: perJudgePct = asNumber(perJudgeComissionPercentage);
    $: judgesTotalPct = judgesCount * perJudgePct;
    const developersPct = 5;
    $: totalAllocated = creatorPct + judgesTotalPct + developersPct;
    $: winnerPctRaw = 100 - totalAllocated;
    $: winnerPct = winnerPctRaw < 0 ? 0 : winnerPctRaw;
    $: overAllocated =
        totalAllocated > 100 ? +(totalAllocated - 100).toFixed(3) : 0;

    async function handleSubmit() {
        isSubmitting = true;
        errorMessage = null;
        transactionId = null;

        if (
            !gameServiceId.trim() ||
            !gameSecret.trim() ||
            !gameTitle.trim() ||
            !deadlineBlock ||
            creatorStakeAmount === undefined ||
            participationFeeAmount === undefined ||
            commissionPercentage === undefined ||
            perJudgeComissionPercentage === undefined
        ) {
            errorMessage = "Please fill all required fields correctly.";
            isSubmitting = false;
            return;
        }
        if (gameServiceId.trim().length !== 64) {
            errorMessage = "Game Service ID must be a 64-character hash.";
            isSubmitting = false;
            return;
        }
        if (gameSecret.trim().length !== 64) {
            errorMessage = "Game Secret must be a 64-character hex string.";
            isSubmitting = false;
            return;
        }

        let hashedSecret: string;
        try {
            const data = hexToBytes(gameSecret) ?? new Uint8Array([]);
            const hashBuffer = fleetBlake2b256(data);
            hashedSecret = uint8ArrayToHex(hashBuffer);
        } catch (e: any) {
            errorMessage = "Error hashing secret: " + e.message;
            isSubmitting = false;
            return;
        }

        const judgesArray = judges
            .map((j) => j.value.trim())
            .filter((id) => id);

        const gameDetails = JSON.stringify({
            title: gameTitle,
            description: gameDescription,
            imageURL: gameImageHash,
            creatorTokenId: creatorTokenId,
            serviceId: gameServiceId,
            paper: gamePaperHash,
            indetermismIndex: indetermismIndex,
        });

        try {
            const result = await platform.createGoPGame({
                gameServiceId: gameServiceId,
                hashedSecret: hashedSecret,
                deadlineBlock: deadlineBlock,
                creatorStakeAmount: toTokenSmallestUnit(creatorStakeAmount),
                participationFeeAmount: toTokenSmallestUnit(
                    participationFeeAmount,
                ),
                participationTokenId:
                    participationTokenId === ""
                        ? undefined
                        : participationTokenId,
                commissionPercentage: commissionPercentage,
                judges: judgesArray,
                gameDetailsJson: gameDetails,
                perJudgeComissionPercentage: perJudgeComissionPercentage,
            });
            transactionId = result;
        } catch (error: any) {
            console.error(error);
            errorMessage =
                error.message || "Error occurred while creating the game";
        } finally {
            isSubmitting = false;
        }
    }

    function generateGameSecret() {
        if (typeof window !== "undefined" && window.crypto) {
            const randomBytes = new Uint8Array(32);
            window.crypto.getRandomValues(randomBytes);
            gameSecret = uint8ArrayToHex(randomBytes);
        } else {
            alert("Secure random generation is not available in your browser.");
        }
    }
</script>

<div class="create-game-container">
    <div class="hero-section text-center">
        <h2
            class="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4 bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent inline-block"
        >
            Create a New Competition
        </h2>
        <p class="subtitle">Fill in the details to launch your game.</p>
    </div>

    {#if !transactionId}
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div class="lg:col-span-8 space-y-8">
                <section class="form-section">
                    <h3 class="section-title">Core Game Identity</h3>
                    <p class="section-description">
                        Essential information that defines your game.
                    </p>
                    <div
                        class="form-grid grid grid-cols-1 lg:grid-cols-4 gap-x-6 gap-y-6"
                    >
                        <div class="form-group lg:col-span-3">
                            <Label for="gameTitle">Game Title</Label>
                            <Input
                                id="gameTitle"
                                bind:value={gameTitle}
                                placeholder="The official title of the game"
                                required
                            />
                        </div>
                        <div class="form-group lg:col-span-1">
                            <Label for="indetermismIndex"
                                >Indetermism Index</Label
                            >
                            <Input
                                id="indetermismIndex"
                                type="number"
                                bind:value={indetermismIndex}
                                min="1"
                                step="1"
                                placeholder="Executions"
                                required
                            />
                        </div>
                        <div class="form-group lg:col-span-4">
                            <Label for="gameServiceId"
                                >Game Service ID (64-char hash)</Label
                            >
                            <div class="flex gap-2">
                                <Input
                                    id="gameServiceId"
                                    bind:value={$gameServiceIdStore}
                                    placeholder="64-character hexadecimal hash"
                                    required
                                    maxlength={64}
                                    pattern="[a-fA-F0-9]{64}"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    on:click={() => gameServiceIdStore.set("")}
                                    class="shrink-0"
                                    title="Clear hash"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                        <div class="form-group lg:col-span-4">
                            <div class="flex justify-between items-center">
                                <Label for="gameSecret">Game Secret (S)</Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    on:click={generateGameSecret}
                                    class="text-xs"
                                >
                                    <Wand2 class="w-3 h-3 mr-2" />
                                    Generate
                                </Button>
                            </div>
                            <div class="flex gap-2">
                                <div class="relative flex-grow">
                                    <Input
                                        type={showGameSecret
                                            ? "text"
                                            : "password"}
                                        id="gameSecret"
                                        bind:value={gameSecret}
                                        placeholder="Enter or generate a 64-char hex secret"
                                        required
                                        maxlength={64}
                                        pattern="[a-fA-F0-9]{64}"
                                    />
                                    <button
                                        type="button"
                                        on:click={() =>
                                            (showGameSecret = !showGameSecret)}
                                        class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200"
                                        aria-label={showGameSecret
                                            ? "Hide secret"
                                            : "Show secret"}
                                    >
                                        {#if showGameSecret}
                                            <EyeOff class="h-5 w-5" />
                                        {:else}
                                            <Eye class="h-5 w-5" />
                                        {/if}
                                    </button>
                                </div>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    on:click={() => (gameSecret = "")}
                                    class="shrink-0"
                                    title="Clear secret"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </Button>
                            </div>
                            <p class="text-xs mt-1 text-muted-foreground">
                                This will be hashed. Keep the original S safe.
                            </p>
                        </div>
                    </div>
                </section>

                <section class="form-section">
                    <h3 class="section-title">On-Chain Rules & Economy</h3>
                    <p class="section-description">
                        Parameters that will be enforced by the smart contract.
                    </p>
                    <div
                        class="form-grid grid grid-cols-1 lg:grid-cols-4 gap-x-6 gap-y-6"
                    >
                        <div class="form-group lg:col-span-2">
                            <Label for="deadlineValue"
                                >Participation Deadline</Label
                            >
                            <div class="flex space-x-2">
                                <Input
                                    id="deadlineValue"
                                    type="number"
                                    bind:value={deadlineValue}
                                    min="1"
                                    placeholder="Time until deadline"
                                    autocomplete="off"
                                />
                                <select
                                    bind:value={deadlineUnit}
                                    class="p-2 border border-slate-500/20 rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-slate-500/20"
                                >
                                    <option value="days">Days</option>
                                    <option value="minutes">Minutes</option>
                                </select>
                            </div>
                            {#if deadlineBlock && deadlineBlockDateText}
                                <p class="text-xs mt-1 text-muted-foreground">
                                    Ends on block: {deadlineBlock} (approx. {deadlineBlockDateText})
                                </p>
                            {/if}
                        </div>
                        <div class="form-group lg:col-span-2">
                            <Label for="creatorStakeAmount"
                                >Creator Stake ({participationTokenName})</Label
                            >
                            <Input
                                id="creatorStakeAmount"
                                bind:value={creatorStakeAmount}
                                type="number"
                                min="0"
                                step="0.001"
                                placeholder="{participationTokenName} to stake"
                                required
                            />
                        </div>
                        <div class="form-group lg:col-span-4">
                            <Label for="participationFee"
                                >Participation Fee ({participationTokenName})</Label
                            >
                            <div class="flex space-x-2">
                                <Input
                                    id="participationFee"
                                    bind:value={participationFeeAmount}
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    placeholder="Cost per player"
                                    required
                                    class="flex-grow"
                                />

                                <select
                                    bind:value={selectedTokenOption}
                                    class="p-2 border border-slate-500/20 rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-slate-500/20"
                                >
                                    <option value="ERG">ERG (Ergo)</option>

                                    {#each DEFAULT_TOKENS as token (token.tokenId)}
                                        <option value={token.tokenId}>
                                            {token.title}
                                        </option>
                                    {/each}

                                    <option value="custom"
                                        >Other Token ID...</option
                                    >
                                </select>
                            </div>

                            {#if isCustomToken}
                                <div class="mt-3 pl-1">
                                    <Label
                                        for="customTokenId"
                                        class="text-xs font-medium mb-1.5 block"
                                    >
                                        Custom Token ID
                                    </Label>
                                    <div class="flex gap-2">
                                        <Input
                                            id="customTokenId"
                                            bind:value={customTokenId}
                                            placeholder="Enter the 64-character token ID"
                                            class="w-full bg-slate-50 dark:bg-slate-900/50 border-slate-500/20 text-xs font-mono"
                                            maxlength={64}
                                            pattern="[a-fA-F0-9]{64}"
                                        />
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            on:click={() =>
                                                (customTokenId = "")}
                                            class="shrink-0 h-9 w-9"
                                            title="Clear token ID"
                                        >
                                            <Trash2 class="w-4 h-4" />
                                        </Button>
                                    </div>
                                    {#if customTokenId.length === 64 && participationTokenName !== "Loading..." && participationTokenName !== "Enter 64-char ID"}
                                        <p
                                            class="text-xs text-muted-foreground mt-1"
                                        >
                                            Token: {participationTokenName} (Decimals:
                                            {participationTokenDecimals})
                                        </p>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                        <div class="form-group lg:col-span-2">
                            <Label for="commissionPercentage"
                                >Creator Commission (%)</Label
                            >
                            <Input
                                id="commissionPercentage"
                                bind:value={commissionPercentage}
                                type="number"
                                min="0"
                                max="100"
                                step="0.0001"
                                placeholder="e.g., 20 for 20%"
                                required
                            />
                        </div>
                        <div class="form-group lg:col-span-2">
                            <Label for="perJudgeComissionPercentage"
                                >Judge Commission (%)</Label
                            >
                            <Input
                                id="perJudgeComissionPercentage"
                                bind:value={perJudgeComissionPercentage}
                                type="number"
                                min="0"
                                max="100"
                                step="0.0001"
                                placeholder="e.g., 1 for 1%"
                                required
                            />
                        </div>
                        <div class="form-group lg:col-span-4">
                            <div class="repeater-container">
                                <button
                                    type="button"
                                    class="repeater-header"
                                    on:click={() =>
                                        (judgesExpanded = !judgesExpanded)}
                                >
                                    <Label
                                        >Invited Judges (Reputation Token IDs)</Label
                                    >
                                    {#if judgesExpanded}
                                        <ChevronUp class="w-5 h-5" />
                                    {:else}
                                        <ChevronDown class="w-5 h-5" />
                                    {/if}
                                </button>
                                {#if judgesExpanded}
                                    <div class="repeater-content">
                                        {#each judges as judge (judge.id)}
                                            <div class="repeater-item">
                                                <Input
                                                    bind:value={judge.value}
                                                    placeholder="Token ID (optional)"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    on:click={() =>
                                                        removeJudge(judge.id)}
                                                    aria-label="Remove Judge"
                                                >
                                                    <X
                                                        class="w-4 h-4 text-red-500"
                                                    />
                                                </Button>
                                            </div>
                                        {/each}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            on:click={addJudge}
                                            >+ Add Judge</Button
                                        >
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <div class="form-group lg:col-span-4">
                            <div class="flex items-center gap-2 mb-3">
                                <Trophy class="w-5 h-5 text-amber-500" />
                                <Label class="mb-0"
                                    >Prize Distribution Preview</Label
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
                            <div class="distribution-legend">
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
                                        >Creator ({creatorPct.toFixed(
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
                    </div>
                </section>

                <section class="form-section">
                    <h3 class="section-title">Content & Metadata (Optional)</h3>
                    <p class="section-description">
                        Additional details to enrich your game's presentation.
                    </p>
                    <div
                        class="form-grid grid grid-cols-1 lg:grid-cols-4 gap-x-6 gap-y-6"
                    >
                        <div class="form-group lg:col-span-4">
                            <Label for="gameDescription">Game Description</Label
                            >
                            <div class="relative">
                                <Textarea
                                    id="gameDescription"
                                    bind:value={gameDescription}
                                    placeholder="Detailed description of the game, rules, objectives, scoring..."
                                    required
                                    class="h-32 {contentTooLarge
                                        ? 'border-red-500 focus:ring-red-500'
                                        : ''}"
                                />
                                <div
                                    class="absolute bottom-2 right-2 text-xs {contentTooLarge
                                        ? 'text-red-500 font-bold'
                                        : 'text-muted-foreground'} bg-background/80 px-1 rounded"
                                >
                                    {contentUsagePercentage}% used ({estimatedBoxSize}
                                    bytes)
                                </div>
                            </div>
                            {#if contentTooLarge}
                                <p class="text-xs text-red-500 mt-1">
                                    {contentValidation.message}
                                </p>
                            {/if}
                        </div>
                        <div class="form-group lg:col-span-4">
                            <Label for="creatorTokenId"
                                >Creator Reputation Proof ID (Optional)</Label
                            >
                            <Input
                                id="creatorTokenId"
                                bind:value={creatorTokenId}
                                placeholder="Enter a token ID to link to the creator"
                            />
                        </div>
                        <div class="form-group lg:col-span-4">
                            <Label for="gameImageHash">Game Image Hash</Label>
                            <div class="flex gap-2">
                                <Input
                                    id="gameImageHash"
                                    bind:value={$gameImageHashStore}
                                    placeholder="Blake2b256 hash (64-character hex)"
                                    maxlength={64}
                                    pattern="[a-fA-F0-9]{64}"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    on:click={() => gameImageHashStore.set("")}
                                    class="shrink-0"
                                    title="Clear hash"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </Button>
                            </div>
                            <p class="text-xs mt-1 text-muted-foreground">
                                The Blake2b256 hash of the game's image file
                            </p>
                        </div>
                        <div class="form-group lg:col-span-4">
                            <Label for="gamePaperHash"
                                >Game Paper Hash (Optional)</Label
                            >
                            <div class="flex gap-2">
                                <Input
                                    id="gamePaperHash"
                                    bind:value={$gamePaperHashStore}
                                    placeholder="Blake2b256 hash (64-character hex)"
                                    maxlength={64}
                                    pattern="[a-fA-F0-9]{64}"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    on:click={() => gamePaperHashStore.set("")}
                                    class="shrink-0"
                                    title="Clear hash"
                                >
                                    <Trash2 class="w-4 h-4" />
                                </Button>
                            </div>
                            <p class="text-xs mt-1 text-muted-foreground">
                                The Blake2b256 hash of a markdown file with
                                detailed game description
                            </p>
                        </div>
                    </div>
                </section>
                <div class="form-actions mt-8">
                    <Button
                        on:click={handleSubmit}
                        size="lg"
                        disabled={isSubmitting ||
                            !gameServiceId.trim() ||
                            !gameSecret.trim() ||
                            !gameTitle.trim() ||
                            !deadlineBlock ||
                            creatorStakeAmount === undefined ||
                            participationFeeAmount === undefined ||
                            commissionPercentage === undefined ||
                            overAllocated > 0 ||
                            contentTooLarge}
                        class="w-full text-lg font-bold py-6 shadow-lg shadow-primary/20"
                    >
                        {isSubmitting ? "Submitting..." : "Create Competition"}
                    </Button>
                </div>
            </div>

            <div class="lg:col-span-4 space-y-8 lg:sticky lg:top-24 h-fit">
                <!-- FILE SOURCES SECTIONS -->
                {#if $reputation_proof}
                    <section class="form-section">
                        <h3 class="section-title">File Sources (Optional)</h3>
                        <p class="section-description">
                            Share download locations for game files.
                        </p>

                        <div class="flex flex-col gap-6">
                            <!-- Game Service Download Sources -->
                            <div
                                class="form-group p-5 rounded-xl border border-slate-500/10 bg-slate-500/5 backdrop-blur-sm hover:border-primary/30 transition-colors"
                            >
                                <Label
                                    class="text-base font-bold mb-1 flex items-center gap-2"
                                >
                                    <div
                                        class="w-2 h-2 rounded-full bg-purple-500"
                                    ></div>
                                    Service Source
                                </Label>
                                <p
                                    class="text-xs text-muted-foreground mb-4 leading-relaxed"
                                >
                                    Provide download locations for the game
                                    service executable or package.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    on:click={() =>
                                        openFileSourceModal(
                                            gameServiceId,
                                            "service",
                                        )}
                                    class="w-full bg-background/50 hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                                >
                                    Add Service Source
                                </Button>
                                {#if serviceSourceCount > 0}
                                    <div
                                        class="flex items-center justify-center gap-2 mt-3 py-1 px-3 rounded-full bg-green-500/10 border border-green-500/20 w-fit mx-auto"
                                    >
                                        <div
                                            class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"
                                        ></div>
                                        <span
                                            class="text-[10px] text-green-500 font-bold uppercase tracking-wider"
                                        >
                                            {serviceSourceCount} source(s) active
                                        </span>
                                    </div>
                                {/if}
                            </div>

                            <!-- Image Download Sources -->
                            <div
                                class="form-group p-5 rounded-xl border border-slate-500/10 bg-slate-500/5 backdrop-blur-sm hover:border-primary/30 transition-colors"
                            >
                                <Label
                                    class="text-base font-bold mb-1 flex items-center gap-2"
                                >
                                    <div
                                        class="w-2 h-2 rounded-full bg-blue-500"
                                    ></div>
                                    Image Source
                                </Label>
                                <p
                                    class="text-xs text-muted-foreground mb-4 leading-relaxed"
                                >
                                    Provide download locations for the game's
                                    cover image or assets.
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    on:click={() =>
                                        openFileSourceModal(
                                            gameImageHash,
                                            "image",
                                        )}
                                    class="w-full bg-background/50 hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                                >
                                    Add Image Source
                                </Button>
                                {#if imageSourceCount > 0}
                                    <div
                                        class="flex items-center justify-center gap-2 mt-3 py-1 px-3 rounded-full bg-green-500/10 border border-green-500/20 w-fit mx-auto"
                                    >
                                        <div
                                            class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"
                                        ></div>
                                        <span
                                            class="text-[10px] text-green-500 font-bold uppercase tracking-wider"
                                        >
                                            {imageSourceCount} source(s) active
                                        </span>
                                    </div>
                                {/if}
                            </div>

                            <!-- Game Paper Download Sources -->
                            <div
                                class="form-group p-5 rounded-xl border border-slate-500/10 bg-slate-500/5 backdrop-blur-sm hover:border-primary/30 transition-colors"
                            >
                                <Label
                                    class="text-base font-bold mb-1 flex items-center gap-2"
                                >
                                    <div
                                        class="w-2 h-2 rounded-full bg-amber-500"
                                    ></div>
                                    Paper Source
                                </Label>
                                <p
                                    class="text-xs text-muted-foreground mb-4 leading-relaxed"
                                >
                                    Provide download locations for the detailed
                                    game documentation (markdown file).
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    on:click={() =>
                                        openFileSourceModal(
                                            gamePaperHash,
                                            "paper",
                                        )}
                                    class="w-full bg-background/50 hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                                >
                                    Add Paper Source
                                </Button>
                                {#if paperSourceCount > 0}
                                    <div
                                        class="flex items-center justify-center gap-2 mt-3 py-1 px-3 rounded-full bg-green-500/10 border border-green-500/20 w-fit mx-auto"
                                    >
                                        <div
                                            class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"
                                        ></div>
                                        <span
                                            class="text-[10px] text-green-500 font-bold uppercase tracking-wider"
                                        >
                                            {paperSourceCount} source(s) active
                                        </span>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </section>
                {/if}
            </div>
        </div>
    {:else}
        <div class="result-container text-center py-12">
            <h3 class="text-2xl font-bold text-green-500 mb-4">
                Game Submitted!
            </h3>
            <p class="mb-2">
                Your game creation transaction has been sent to the blockchain.
            </p>
            <p class="text-sm text-muted-foreground mb-4">
                It may take a few moments to confirm.
            </p>
            <p
                class="font-mono text-xs p-2 rounded bg-green-500/10 dark:bg-slate-800/50 break-all"
            >
                Transaction ID: <a
                    href={$web_explorer_uri_tx + transactionId}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-blue-500 hover:underline">{transactionId}</a
                >
            </p>
        </div>
    {/if}

    {#if errorMessage && !isSubmitting}
        <div
            class="error mt-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center text-red-500"
        >
            <p>{errorMessage}</p>
        </div>
    {/if}

    <!-- File Source Modal -->
    {#if showFileSourceModal}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md"
            on:click={closeFileSourceModal}
            on:keydown={(e) => e.key === "Escape" && closeFileSourceModal()}
            role="button"
            tabindex="0"
            aria-label="Close modal"
        >
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-3xl mx-4 overflow-hidden"
                on:click|stopPropagation
            >
                <div class="p-0">
                    <FileSourceCreation
                        title={modalFileType === "image"
                            ? "Add Image Source"
                            : modalFileType === "service"
                              ? "Add Game Service Source"
                              : "Add Paper Source"}
                        profile={reputationProofAny}
                        explorerUri={$explorer_uri}
                        hash={activeHashStore}
                        onSourceAdded={handleSourceAdded}
                        class="border-none shadow-none bg-transparent rounded-none"
                    />
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="postcss">
    .create-game-container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem 20px 4rem;
    }

    .subtitle {
        font-size: 1.1rem;
        color: hsl(var(--muted-foreground));
        margin-top: 0.5rem;
        margin-bottom: 3rem;
    }
    .form-section {
        @apply p-6 bg-background/50 backdrop-blur-lg rounded-xl shadow border border-white/10;
        animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .section-title {
        @apply text-xl font-semibold mb-1 text-slate-800 dark:text-slate-200;
    }
    .section-description {
        @apply text-sm text-muted-foreground mb-6;
    }
    .form-group {
        @apply flex flex-col gap-2;
    }
    :global(.form-group label) {
        @apply text-sm font-medium;
    }
    :global(.form-group input),
    :global(.form-group select),
    :global(.form-group textarea) {
        @apply bg-slate-50 dark:bg-slate-900/50 border-slate-500/20 focus:border-primary/50 focus:ring-primary/20 focus:ring-2;
    }

    /* Repeater Styles */
    .repeater-container {
        @apply w-full flex flex-col gap-2;
    }
    .repeater-header {
        @apply flex justify-between items-center w-full cursor-pointer;
    }
    .repeater-header > :global(label) {
        @apply cursor-pointer;
    }
    .repeater-content {
        @apply flex flex-col gap-3 pl-2 pt-2 border-l border-slate-500/20;
    }
    .repeater-item {
        @apply flex items-center gap-2;
    }
    .repeater-item > :global(input) {
        @apply flex-grow;
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
