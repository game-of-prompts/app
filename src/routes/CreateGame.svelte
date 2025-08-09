<script lang="ts">
    // CORE IMPORTS
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
    import { block_to_date, time_to_block } from '$lib/common/countdown';
    import { web_explorer_uri_tx } from '$lib/ergo/envs';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { hexToBytes, uint8ArrayToHex } from "$lib/ergo/utils";

    // UI COMPONENTS
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Button } from '$lib/components/ui/button';
    import { Input } from "$lib/components/ui/input";
    import { Eye, EyeOff, Wand2 } from 'lucide-svelte';

    let platform = new ErgoPlatform();

    // --- State declarations
    let gameServiceId: string = "";
    let gameSecret: string = "";
    let showGameSecret: boolean = false;
    let gameTitle: string = "";
    let gameDescription: string = "";
    let gameImageURL: string = "";
    let gameWebLink: string = "";
    let mirrorUrls: string = "";
    let invitedJudges: string = "";
    let deadlineValue: number;
    let deadlineUnit: 'days' | 'minutes' = 'days';
    let deadlineBlock: number | undefined;
    let deadlineBlockDateText: string = "";
    let creatorStakeErg: number | undefined;
    let participationFeeErg: number | undefined;
    let commissionPercentage: number | undefined;
    let transactionId: string | null = null;
    let errorMessage: string | null = null;
    let isSubmitting: boolean = false;

    // --- Logic functions
    $: {
        if (deadlineValue > 0) {
            calculateBlockLimit(deadlineValue, deadlineUnit);
        } else {
            deadlineBlock = undefined;
            deadlineBlockDateText = "";
        }
    }

    async function calculateBlockLimit(value: number, unit: 'days' | 'minutes') {
        if (!platform || !value || value <= 0) {
            deadlineBlock = undefined;
            deadlineBlockDateText = "";
            return;
        }
        try {
            let target_date = new Date();
            let milliseconds;
            if (unit === 'days') {
                milliseconds = value * 24 * 60 * 60 * 1000;
            } else { // minutes
                milliseconds = value * 60 * 1000;
            }
            target_date.setTime(target_date.getTime() + milliseconds);
            deadlineBlock = await time_to_block(target_date.getTime(), platform);
            deadlineBlockDateText = await block_to_date(deadlineBlock, platform);
        } catch (error) {
            console.error("Error calculating block limit:", error);
            deadlineBlock = undefined;
            deadlineBlockDateText = "Error calculating deadline";
        }
    }

    function toNanoErg(ergValue: number | undefined): BigInt {
        if (ergValue === undefined || ergValue === null || isNaN(ergValue)) return BigInt(0);
        return BigInt(Math.round(ergValue * 1000000000));
    }

    async function handleSubmit() {
        isSubmitting = true;
        errorMessage = null;
        transactionId = null;

        if (!gameServiceId.trim() || !gameSecret.trim() || !gameTitle.trim() || !deadlineBlock || creatorStakeErg === undefined || participationFeeErg === undefined || commissionPercentage === undefined) {
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

        const gameDetails = JSON.stringify({
            title: gameTitle,
            description: gameDescription,
            imageURL: gameImageURL,
            webLink: gameWebLink,
            serviceId: gameServiceId,
            mirrorUrls: mirrorUrls.split(',').map(url => url.trim()).filter(url => url),
        });

        const judgesArray = invitedJudges.split(',').map(id => id.trim()).filter(id => id);

        try {
            const result = await platform.createGoPGame({
                gameServiceId: gameServiceId,
                hashedSecret: hashedSecret,
                deadlineBlock: deadlineBlock,
                creatorStakeNanoErg: toNanoErg(creatorStakeErg),
                participationFeeNanoErg: toNanoErg(participationFeeErg),
                commissionPercentage: Math.round(commissionPercentage), // <-- CAMBIO REALIZADO AQUÍ
                invitedJudges: judgesArray,
                gameDetailsJson: gameDetails,
            });
            transactionId = result;
        } catch (error: any) {
            console.error(error);
            errorMessage = error.message || "Error occurred while creating the game";
        } finally {
            isSubmitting = false;
        }
    }

    function generateGameSecret() {
        if (typeof window !== 'undefined' && window.crypto) {
            const randomBytes = new Uint8Array(32); // 32 bytes = 256 bits
            window.crypto.getRandomValues(randomBytes);
            gameSecret = uint8ArrayToHex(randomBytes);
        } else {
            alert("Secure random generation is not available in your browser.");
        }
    }
</script>

<div class="create-game-container">
    <div class="hero-section text-center">
        <h2 class="project-title">Create a New Game</h2>
        <p class="subtitle">Fill in the details to launch your game.</p>
    </div>

    <div class="space-y-8">
        {#if !transactionId}
            <section class="form-section">
                <h3 class="section-title">Core Game Identity</h3>
                <p class="section-description">Essential information that defines your game.</p>
                <div class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
                    <div class="form-group">
                        <Label for="gameTitle">Game Title</Label>
                        <Input id="gameTitle" bind:value={gameTitle} placeholder="The official title of the game" required />
                    </div>
                    <div class="form-group">
                        <Label for="gameServiceId">Game Service ID (64-char hash)</Label>
                        <Input id="gameServiceId" bind:value={gameServiceId} placeholder="64-character hexadecimal hash" required maxlength={64} pattern="[a-fA-F0-9]{64}" />
                    </div>
                    <div class="form-group lg:col-span-2">
                        <div class="flex justify-between items-center">
                            <Label for="gameSecret">Game Secret (S)</Label>
                            <Button variant="outline" size="sm" on:click={generateGameSecret} class="text-xs">
                                <Wand2 class="w-3 h-3 mr-2"/>
                                Generate
                            </Button>
                        </div>
                        <div class="relative">
                            <Input type={showGameSecret ? 'text' : 'password'} id="gameSecret" bind:value={gameSecret} placeholder="Enter or generate a 64-char hex secret" required maxlength={64} pattern="[a-fA-F0-9]{64}" />
                            <button type="button" on:click={() => showGameSecret = !showGameSecret} class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200" aria-label={showGameSecret ? 'Hide secret' : 'Show secret'}>
                                {#if showGameSecret} <EyeOff class="h-5 w-5" /> {:else} <Eye class="h-5 w-5" /> {/if}
                            </button>
                        </div>
                        <p class="text-xs mt-1 text-muted-foreground">This will be hashed. Keep the original S safe.</p>
                    </div>
                </div>
            </section>

            <section class="form-section">
                <h3 class="section-title">On-Chain Rules & Economy</h3>
                <p class="section-description">Parameters that will be enforced by the smart contract.</p>
                <div class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
                    <div class="form-group">
                        <Label for="deadlineValue">Participation Deadline</Label>
                        <div class="flex space-x-2">
                            <Input id="deadlineValue" type="number" bind:value={deadlineValue} min="1" placeholder="Time until deadline" autocomplete="off" />
                            <select bind:value={deadlineUnit} class="p-2 border border-slate-500/20 rounded-md bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-slate-500/20">
                                <option value="days">Days</option>
                                <option value="minutes">Minutes</option>
                            </select>
                        </div>
                        {#if deadlineBlock && deadlineBlockDateText}
                            <p class="text-xs mt-1 text-muted-foreground">Ends on block: {deadlineBlock} (approx. {deadlineBlockDateText})</p>
                        {/if}
                    </div>
                    <div class="form-group">
                        <Label for="creatorStakeErg">Creator Stake (ERG)</Label>
                        <Input id="creatorStakeErg" bind:value={creatorStakeErg} type="number" min="0" step="0.001" placeholder="ERG to stake" required />
                    </div>
                    <div class="form-group">
                        <Label for="participationFeeErg">Participation Fee (ERG per entry)</Label>
                        <Input id="participationFeeErg" bind:value={participationFeeErg} type="number" min="0" step="0.001" placeholder="ERG cost per player" required />
                    </div>
                    <div class="form-group">
                        <Label for="commissionPercentage">Creator Commission (%)</Label>
                        <Input id="commissionPercentage" bind:value={commissionPercentage} type="number" min="0" max="100" step="0.1" placeholder="e.g., 5 for 5%" required />
                    </div>
                    <div class="form-group lg:col-span-2">
                        <Label for="invitedJudges">Invited Judges (Reputation Token IDs)</Label>
                        <Input id="invitedJudges" bind:value={invitedJudges} placeholder="Comma-separated token IDs (optional)" />
                    </div>
                </div>
            </section>

            <section class="form-section">
                <h3 class="section-title">Content & Metadata (Optional)</h3>
                <p class="section-description">Additional details to enrich your game's presentation.</p>
                <div class="form-grid grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-6">
                    <div class="form-group lg:col-span-2">
                        <Label for="gameDescription">Game Description</Label>
                        <Textarea id="gameDescription" bind:value={gameDescription} placeholder="Detailed description of the game, rules, objectives, scoring..." required class="h-32" />
                    </div>
                    <div class="form-group">
                        <Label for="gameWebLink">Game Info Link</Label>
                        <Input id="gameWebLink" type="url" bind:value={gameWebLink} placeholder="https://example.com/my-game" />
                    </div>
                    <div class="form-group">
                        <Label for="gameImageURL">Game Image URL</Label>
                        <Input id="gameImageURL" type="url" bind:value={gameImageURL} placeholder="https://example.com/image.png" />
                    </div>
                    <div class="form-group lg:col-span-2">
                        <Label for="mirrorUrls">Mirror Download URLs</Label>
                        <Input id="mirrorUrls" type="text" bind:value={mirrorUrls} placeholder="Comma-separated URLs" />
                    </div>
                </div>
            </section>

            <div class="form-actions mt-2 flex justify-end">
                 <Button on:click={handleSubmit}
                    size="lg"
                    disabled={ isSubmitting || !gameServiceId.trim() || !gameSecret.trim() || !gameTitle.trim() || !deadlineBlock || creatorStakeErg === undefined || participationFeeErg === undefined || commissionPercentage === undefined }
                    class="w-full sm:w-auto text-base">
                    {isSubmitting ? 'Submitting...' : 'Create Game'}
                </Button>
            </div>

        {:else}
             <div class="result-container text-center py-12">
                <h3 class="text-2xl font-bold text-green-500 mb-4">Game Submitted!</h3>
                <p class="mb-2">Your game creation transaction has been sent to the blockchain.</p>
                <p class="text-sm text-muted-foreground mb-4">It may take a few moments to confirm.</p>
                <p class="font-mono text-xs p-2 rounded bg-slate-800/50 break-all">
                    <a href="{web_explorer_uri_tx + transactionId}" target="_blank" rel="noopener noreferrer" class="hover:underline">
                        {transactionId}
                    </a>
                </p>
            </div>
        {/if}

        {#if errorMessage && !isSubmitting}
            <div class="error mt-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center text-red-500">
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
        font-family: 'Russo One', sans-serif;
        color: hsl(var(--foreground));
        text-shadow: 0 1px 2px rgba(0,0,0,0.1);
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
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
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

    :global(.form-group input), :global(.form-group select), :global(.form-group textarea) {
        @apply bg-slate-50 dark:bg-slate-900/50 border-slate-500/20 focus:border-primary/50 focus:ring-primary/20 focus:ring-2;
    }
</style>