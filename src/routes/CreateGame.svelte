<script lang="ts">
    // CORE IMPORTS
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { block_to_date, time_to_block } from "$lib/common/countdown";
    import { web_explorer_uri_tx } from "$lib/ergo/envs";
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
        Eye,
        EyeOff,
        Wand2,
        ChevronDown,
        ChevronUp,
        X,
    } from "lucide-svelte";
    import { fetch_token_details } from "$lib/ergo/fetch";

    let platform = new ErgoPlatform();

    // --- State declarations
    let gameServiceId: string = "";
    let gameSecret: string = "";
    let showGameSecret: boolean = false;
    let gameTitle: string = "";
    let gameDescription: string = "";
    let gameImageURL: string = "";
    let gameWebLink: string = "";
    let indetermismIndex: number = 1;
    let deadlineValue: number;
    let deadlineUnit: "days" | "minutes" = "days";
    let deadlineBlock: number | undefined;
    let deadlineBlockDateText: string = "";
    let creatorStakeErg: number | undefined;
    let participationFeeErg: number | undefined;
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
        imageURL: gameImageURL,
        webLink: gameWebLink,
        serviceId: gameServiceId,
        mirrorUrls: mirrors.map((m) => m.value.trim()).filter((url) => url),
        indetermismIndex: indetermismIndex,
    } as GameDetails;

    let contentValidation = validateGameContent(
        {
            title: "",
            description: "",
            imageURL: "",
            webLink: "",
            serviceId: "",
            mirrorUrls: [],
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
            );
            contentUsagePercentage = getUsagePercentage(
                gameDetailsObject,
                judgesCount,
            );
        }, 500);
    }

    $: contentTooLarge = !contentValidation.isValid;
    $: estimatedBoxSize = contentValidation.estimatedBoxSize;

    // --- State for repeaters
    let judges: { id: number; value: string }[] = [{ id: 0, value: "" }];
    let mirrors: { id: number; value: string }[] = [{ id: 0, value: "" }];
    let nextJudgeId = 1;
    let nextMirrorId = 1;
    let judgesExpanded = false;
    let mirrorsExpanded = false;

    // --- Logic for repeaters
    function addJudge() {
        judges = [...judges, { id: nextJudgeId++, value: "" }];
    }
    function removeJudge(id: number) {
        judges = judges.filter((j) => j.id !== id);
        if (judges.length === 0) addJudge(); // Always keep at least one input
    }
    function addMirror() {
        mirrors = [...mirrors, { id: nextMirrorId++, value: "" }];
    }
    function removeMirror(id: number) {
        mirrors = mirrors.filter((m) => m.id !== id);
        if (mirrors.length === 0) addMirror(); // Always keep at least one input
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

    function toNanoErg(ergValue: number | undefined): BigInt {
        if (ergValue === undefined || ergValue === null || isNaN(ergValue))
            return BigInt(0);
        return BigInt(Math.round(ergValue * 1000000000));
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
                        const { name, decimals } = await fetch_token_details(customTokenId);
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
            creatorStakeErg === undefined ||
            participationFeeErg === undefined ||
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
        const mirrorUrlsArray = mirrors
            .map((m) => m.value.trim())
            .filter((url) => url);

        const gameDetails = JSON.stringify({
            title: gameTitle,
            description: gameDescription,
            imageURL: gameImageURL,
            webLink: gameWebLink,
            serviceId: gameServiceId,
            mirrorUrls: mirrorUrlsArray,
            indetermismIndex: indetermismIndex,
        });

        try {
            const result = await platform.createGoPGame({
                gameServiceId: gameServiceId,
                hashedSecret: hashedSecret,
                deadlineBlock: deadlineBlock,
                creatorStakeNanoErg: toNanoErg(creatorStakeErg),
                participationFeeAmount: toTokenSmallestUnit(participationFeeErg),
                participationTokenId: participationTokenId === "" ? undefined : participationTokenId,
                commissionPercentage: Math.round(commissionPercentage),
                judges: judgesArray,
                gameDetailsJson: gameDetails,
                perJudgeComissionPercentage: Math.round(
                    perJudgeComissionPercentage,
                ),
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
        <h2 class="project-title">Create a New Competition</h2>
        <p class="subtitle">Fill in the details to launch your game.</p>
    </div>

    <div class="space-y-8">
        {#if !transactionId}
            <section class="form-section">
                <h3 class="section-title">Core Game Identity</h3>
                <p class="section-description">
                    Essential information that defines your game.
                </p>
                <div
                    class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6"
                >
                    <div class="form-group">
                        <Label for="gameTitle">Game Title</Label>
                        <Input
                            id="gameTitle"
                            bind:value={gameTitle}
                            placeholder="The official title of the game"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <Label for="gameServiceId"
                            >Game Service ID (64-char hash)</Label
                        >
                        <Input
                            id="gameServiceId"
                            bind:value={gameServiceId}
                            placeholder="64-character hexadecimal hash"
                            required
                            maxlength={64}
                            pattern="[a-fA-F0-9]{64}"
                        />
                    </div>
                    <div class="form-group lg:col-span-2">
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
                        <div class="relative">
                            <Input
                                type={showGameSecret ? "text" : "password"}
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
                        <p class="text-xs mt-1 text-muted-foreground">
                            This will be hashed. Keep the original S safe.
                        </p>
                    </div>
                    <div class="form-group">
                        <Label for="indetermismIndex">Indetermism Index</Label>
                        <Input
                            id="indetermismIndex"
                            type="number"
                            bind:value={indetermismIndex}
                            min="1"
                            step="1"
                            placeholder="Number of executions for reproducibility"
                            required
                        />
                    </div>
                </div>
            </section>

            <section class="form-section">
                <h3 class="section-title">On-Chain Rules & Economy</h3>
                <p class="section-description">
                    Parameters that will be enforced by the smart contract.
                </p>
                <div
                    class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6"
                >
                    <div class="form-group">
                        <Label for="deadlineValue">Participation Deadline</Label
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
                    <div class="form-group">
                        <Label for="creatorStakeErg">Creator Stake (ERG)</Label>
                        <Input
                            id="creatorStakeErg"
                            bind:value={creatorStakeErg}
                            type="number"
                            min="0"
                            step="0.001"
                            placeholder="ERG to stake"
                            required
                        />
                    </div>
<div class="form-group lg:col-span-2">
                        <Label for="participationFee"
                            >Participation Fee ({participationTokenName})</Label
                        >
                        <div class="flex space-x-2">
                            <Input
                                id="participationFee"
                                bind:value={participationFeeErg}
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
                                
                                <option value="custom">Other Token ID...</option>
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
                                <Input
                                    id="customTokenId"
                                    bind:value={customTokenId}
                                    placeholder="Enter the 64-character token ID"
                                    class="w-full bg-slate-50 dark:bg-slate-900/50 border-slate-500/20 text-xs font-mono"
                                    maxlength={64}
                                    pattern="[a-fA-F0-9]{64}"
                                />
                                {#if customTokenId.length === 64 && participationTokenName !== "Loading..." && participationTokenName !== "Enter 64-char ID"}
                                    <p class="text-xs text-muted-foreground mt-1">
                                        Token: {participationTokenName} (Decimals: {participationTokenDecimals})
                                    </p>
                                {/if}
                            </div>
                        {/if}
                    </div>
                    <div class="form-group">
                        <Label for="commissionPercentage"
                            >Creator Commission (%)</Label
                        >
                        <Input
                            id="commissionPercentage"
                            bind:value={commissionPercentage}
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            placeholder="e.g., 20 for 20%"
                            required
                        />
                    </div>
                    <div class="form-group">
                        <Label for="perJudgeComissionPercentage"
                            >Judge Commission (%)</Label
                        >
                        <Input
                            id="perJudgeComissionPercentage"
                            bind:value={perJudgeComissionPercentage}
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            placeholder="e.g., 1 for 1%"
                            required
                        />
                    </div>
                    <div class="form-group lg:col-span-2">
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
                                        on:click={addJudge}>+ Add Judge</Button
                                    >
                                </div>
                            {/if}
                        </div>
                    </div>

                    <div class="form-group lg:col-span-2">
                        <Label>Prize Distribution Preview</Label>
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
                                title="Dev Fund: {developersPct.toFixed(2)}%"
                            ></div>
                        </div>
                        <div class="distribution-legend">
                            <div class="legend-item">
                                <div class="legend-color winner"></div>
                                <span>Winner(s) ({winnerPct.toFixed(2)}%)</span>
                            </div>
                            <div class="legend-item">
                                <div class="legend-color creator"></div>
                                <span>Creator ({creatorPct.toFixed(2)}%)</span>
                            </div>
                            <div class="legend-item">
                                <div class="legend-color judges"></div>
                                <span
                                    >Judges ({judgesTotalPct.toFixed(2)}%)</span
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
                    class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6"
                >
                    <div class="form-group lg:col-span-2">
                        <Label for="gameDescription">Game Description</Label>
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
                    <div class="form-group">
                        <Label for="gameWebLink">Game Info Link</Label>
                        <Input
                            id="gameWebLink"
                            type="url"
                            bind:value={gameWebLink}
                            placeholder="https://example.com/my-game"
                        />
                    </div>
                    <div class="form-group">
                        <Label for="gameImageURL">Game Image URL</Label>
                        <Input
                            id="gameImageURL"
                            type="url"
                            bind:value={gameImageURL}
                            placeholder="https://example.com/image.png"
                        />
                    </div>
                    <div class="form-group lg:col-span-2">
                        <div class="repeater-container">
                            <button
                                type="button"
                                class="repeater-header"
                                on:click={() =>
                                    (mirrorsExpanded = !mirrorsExpanded)}
                            >
                                <Label
                                    >Alternative Downloads (Game Service)</Label
                                >
                                {#if mirrorsExpanded}
                                    <ChevronUp class="w-5 h-5" />
                                {:else}
                                    <ChevronDown class="w-5 h-5" />
                                {/if}
                            </button>
                            {#if mirrorsExpanded}
                                <div class="repeater-content">
                                    {#each mirrors as mirror (mirror.id)}
                                        <div class="repeater-item">
                                            <Input
                                                type="url"
                                                bind:value={mirror.value}
                                                placeholder="https://example.com/mirror"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                on:click={() =>
                                                    removeMirror(mirror.id)}
                                                aria-label="Remove Mirror URL"
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
                                        on:click={addMirror}>+ Add URL</Button
                                    >
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
            </section>

            <div class="form-actions mt-2 flex justify-end">
                <Button
                    on:click={handleSubmit}
                    size="lg"
                    disabled={isSubmitting ||
                        !gameServiceId.trim() ||
                        !gameSecret.trim() ||
                        !gameTitle.trim() ||
                        !deadlineBlock ||
                        creatorStakeErg === undefined ||
                        participationFeeErg === undefined ||
                        commissionPercentage === undefined ||
                        overAllocated > 0 ||
                        contentTooLarge}
                    class="w-full sm:w-auto text-base"
                >
                    {isSubmitting ? "Submitting..." : "Create Game"}
                </Button>
            </div>
        {:else}
            <div class="result-container text-center py-12">
                <h3 class="text-2xl font-bold text-green-500 mb-4">
                    Game Submitted!
                </h3>
                <p class="mb-2">
                    Your game creation transaction has been sent to the
                    blockchain.
                </p>
                <p class="text-sm text-muted-foreground mb-4">
                    It may take a few moments to confirm.
                </p>
                <p
                    class="font-mono text-xs p-2 rounded bg-slate-800/50 break-all"
                >
                    <a
                        href={web_explorer_uri_tx + transactionId}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                    >
                        {transactionId}
                    </a>
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
    </div>
</div>

<style lang="postcss">
    .create-game-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 10px 15px 4rem;
    }
    .project-title {
        text-align: center;
        font-size: 2.8rem;
        font-family: "Russo One", sans-serif;
        color: hsl(var(--foreground));
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
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
