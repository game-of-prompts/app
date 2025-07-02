<script lang="ts">
    import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto"; // Para el hashing
    import { block_to_date, time_to_block } from '$lib/common/countdown';
    import { web_explorer_uri_tx } from '$lib/ergo/envs';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { Label } from "$lib/components/ui/label/index.js";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Button } from '$lib/components/ui/button';
    import { Input } from "$lib/components/ui/input";
    import { Eye, EyeOff } from 'lucide-svelte';
    import { hexToBytes, uint8ArrayToHex } from "$lib/ergo/utils";

    let platform = new ErgoPlatform();

    // Game Information
    let gameServiceId: string = "";
    let gameSecret: string = ""; 
    let showGameSecret: boolean = false; 
    let gameTitle: string = "";
    let gameDescription: string = "";
    let gameImageURL: string = ""; 
    let gameWebLink: string = ""; 
    let mirrorUrls: string = ""; 

    // On-chain parameters
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

    $: {
        if (deadlineValue && deadlineValue > 0) {
            calculateBlockLimit(deadlineValue, deadlineUnit);
        } else {
            deadlineBlock = undefined;
            deadlineBlockDateText = "";
        }
    }

    async function calculateBlockLimit(value: number, unit: 'days' | 'minutes') {
        if (!platform || !value || value <=0) {
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
        if (creatorStakeErg < 0 || participationFeeErg < 0) {
            errorMessage = "Stake and Fee cannot be negative.";
            isSubmitting = false;
            return;
        }
        if (commissionPercentage < 0 || commissionPercentage > 100) {
            errorMessage = "Commission must be between 0 and 100.";
            isSubmitting = false;
            return;
        }

        let hashedSecret: string; 
        try {
            if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && TextEncoder) {
                const data = hexToBytes(gameSecret) ?? new Uint8Array([]); 
                const hashBuffer = fleetBlake2b256(data);
                hashedSecret = uint8ArrayToHex(hashBuffer);
            } else {
                throw new Error("Web Crypto API not available for hashing placeholder. Implement server-side or use a JS crypto library for BLAKE2b-256.");
            }
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

        try {
            // @ts-ignore 
            const result = await platform.createGoPGame({
                gameServiceId: gameServiceId, 
                hashedSecret: hashedSecret,    
                deadlineBlock: deadlineBlock,
                creatorStakeNanoErg: toNanoErg(creatorStakeErg),
                participationFeeNanoErg: toNanoErg(participationFeeErg),
                commissionPercentage: commissionPercentage,
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

</script>

<div>
    <div class="container mx-auto py-4">
        <h2 class="project-title">Create a New Game</h2>

       <div class="form-container bg-background/80 backdrop-blur-lg rounded-xl p-6 mb-6">
            <div class="form-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                
                <div class="form-group lg:col-span-1">
                    <Label for="gameTitle" class="text-sm font-medium mb-2 block">Game Title</Label>
                    <Input 
                        type="text" 
                        id="gameTitle" 
                        bind:value={gameTitle} 
                        placeholder="Enter the official title of the game" 
                        required 
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

                <div class="form-group lg:col-span-1">
                    <Label for="gameServiceId" class="text-sm font-medium mb-2 block">Game Service ID (64-char hash)</Label> 
                    <Input 
                        type="text" 
                        id="gameServiceId" 
                        bind:value={gameServiceId} 
                        placeholder="Enter 64-character hexadecimal hash"
                        required 
                        maxlength={64}  
                        pattern="[a-fA-F0-9]{64}"                    
                        title="Must be a 64-character hexadecimal string."
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>
                
                <div class="form-group lg:col-span-1">
                    <Label for="gameSecret" class="text-sm font-medium mb-2 block">Game Secret (S)</Label>
                    <div class="relative"> 
                        <Input 
                            type={showGameSecret ? 'text' : 'password'} 
                            id="gameSecret" 
                            bind:value={gameSecret} 
                            placeholder="Enter 64-char hex secret (S)"       
                            required 
                            maxlength={64}                                   
                            pattern="[a-fA-F0-9]{64}"                       
                            title="Must be a 64-character hexadecimal string." 
                            class="w-full pr-10 border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                        />
                        <button
                            type="button"
                            on:click={() => showGameSecret = !showGameSecret}
                            class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-200 focus:outline-none"
                            aria-label={showGameSecret ? 'Hide secret' : 'Show secret'}
                        > 
                            {#if showGameSecret}
                                <EyeOff class="h-5 w-5" />
                            {:else}
                                <Eye class="h-5 w-5" />
                            {/if}
                        </button>
                    </div>
                     <p class="text-xs mt-1 text-muted-foreground">This 64-char hex secret (S) will be hashed (BLAKE2b-256) to hashS. Keep original S safe.</p>
                </div>

                <div class="form-group">
                    <Label for="deadlineValue" class="text-sm font-medium mb-2 block">Participation Deadline</Label>
                    <div class="flex space-x-2">
                        <Input
                            id="deadlineValue"
                            type="number"
                            bind:value={deadlineValue}
                            min="1"
                            placeholder={deadlineUnit === 'days' ? "Days until participation ends" : "Minutes until participation ends"}
                            aria-label="Enter the limit for participation"
                            class="flex-grow border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1"
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
                    <Label for="creatorStakeErg" class="text-sm font-medium mb-2 block">Creator Stake (ERG)</Label>
                    <Input 
                        type="number" 
                        id="creatorStakeErg" 
                        bind:value={creatorStakeErg} 
                        min="0" step="0.001" 
                        placeholder="ERG to stake as creator" 
                        required
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

                <div class="form-group">
                    <Label for="participationFeeErg" class="text-sm font-medium mb-2 block">Participation Fee (ERG per entry)</Label>
                    <Input 
                        type="number" 
                        id="participationFeeErg" 
                        bind:value={participationFeeErg} 
                        min="0" step="0.001" 
                        placeholder="ERG cost for players to submit" 
                        required
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>
                
                <div class="form-group">
                    <Label for="commissionPercentage" class="text-sm font-medium mb-2 block">Creator Commission (%)</Label>
                    <Input 
                        type="number" 
                        id="commissionPercentage" 
                        bind:value={commissionPercentage} 
                        min="0" max="100" step="0.1" 
                        placeholder="e.g., 5 for 5%" 
                        required
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

                <div class="form-group">
                    <Label for="gameWebLink" class="text-sm font-medium mb-2 block">Game Info Link (Optional)</Label>
                    <Input 
                        type="url" 
                        id="gameWebLink" 
                        bind:value={gameWebLink} 
                        placeholder="https://example.com/my-gop-game-rules" 
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

                <div class="form-group sm:col-span-2 lg:col-span-3">
                    <Label for="gameDescription" class="text-sm font-medium mb-2 block">Game Description</Label>
                    <Textarea 
                        id="gameDescription" 
                        bind:value={gameDescription} 
                        placeholder="Detailed description of the game, rules, objectives, scoring..." 
                        required 
                        class="w-full h-28 lg:h-32 border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>
                
                <div class="form-group">
                    <Label for="gameImageURL" class="text-sm font-medium mb-2 block">Game Image URL (Optional)</Label>
                    <Input 
                        type="url" 
                        id="gameImageURL" 
                        bind:value={gameImageURL} 
                        placeholder="https://example.com/image.png" 
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

                <div class="form-group sm:col-span-2">
                    <Label for="mirrorUrls" class="text-sm font-medium mb-2 block">Mirror Download URLs (Optional)</Label>
                    <Input 
                        type="text" 
                        id="mirrorUrls" 
                        bind:value={mirrorUrls} 
                        placeholder="Comma-separated URLs for game service mirrors" 
                        class="w-full border-slate-500/20 focus:border-slate-500/40 focus:ring-slate-500/20 focus:ring-1" 
                    />
                </div>

            </div>

            <div class="form-actions mt-6 flex justify-center">
                {#if transactionId}
                    <div class="result bg-background/80 backdrop-blur-lg border border-slate-500/20 rounded-lg p-4 w-full max-w-xl">
                        <p class="text-center">
                            <strong>Game Creation Transaction ID:</strong>
                            <a href="{web_explorer_uri_tx + transactionId}" target="_blank" rel="noopener noreferrer" class="text-slate-400 hover:text-slate-300 underline transition-colors">
                                {transactionId}
                            </a>
                        </p>
                        <p class="text-center mt-2 text-sm">Your game is being published on the Ergo blockchain. It may take a few moments to confirm.</p>
                    </div>
                {:else}
                    <Button on:click={handleSubmit} 
                        disabled={
                            isSubmitting || 
                            !gameServiceId.trim() || gameServiceId.trim().length !== 64 ||
                            !gameSecret.trim() || gameSecret.trim().length !== 64 ||
                            !gameTitle.trim() || 
                            !deadlineBlock || 
                            creatorStakeErg === undefined || 
                            participationFeeErg === undefined || 
                            commissionPercentage === undefined
                        } 
                        class="bg-slate-500 hover:bg-slate-600 text-black border-none py-2 px-6 text-lg font-semibold rounded-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-lg disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-none"
                    >
                        {isSubmitting ? 'Submitting Game to Blockchain...' : 'Create Game'}
                    </Button>  
                {/if}
            </div>
            
            {#if errorMessage}
                <div class="error mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
                    <p class="text-red-500">{errorMessage}</p>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    /* Tus estilos originales se mantienen intactos */
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 10px 15px;
    }

    .project-title {
        text-align: center;
        font-size: 2.2rem;
        margin: 20px 0 30px;
        color: slate;
        font-family: 'Russo One', sans-serif;
        letter-spacing: 0.02em;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        position: relative;
    }

    .project-title::after {
        content: '';
        position: absolute;
        bottom: -10px;
        left: 50%;
        transform: translateX(-50%);
        width: 100px;
        height: 3px;
        background: linear-gradient(90deg, rgba(100, 116, 139, 0), rgba(100, 116, 139, 1), rgba(100, 116, 139, 0));
    }

    .form-container {
        animation: fadeIn 0.5s ease-in;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    .form-group {
        margin-bottom: 1rem; 
    }
    .form-group:last-child {
        margin-bottom: 0;
    }
    
    .form-grid .lg\:col-span-3 {
        margin-bottom: 1rem;
    }


    @media (max-width: 768px) {
        .project-title {
            font-size: 1.8rem;
            margin: 15px 0 25px;
        }
        .form-grid {
            grid-template-columns: 1fr; 
        }
        .form-group.sm\:col-span-2, .form-group.lg\:col-span-1, .form-group.lg\:col-span-3 {
             grid-column: span 1 / span 1; 
        }
    }
</style>