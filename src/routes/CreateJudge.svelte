<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { create_profile } from "ergo-reputation-system";
    import { JUDGE } from "$lib/ergo/reputation/types";
    import { web_explorer_uri_tx, explorer_uri } from "$lib/ergo/envs";
    import { get } from "svelte/store";

    let transactionId: string | null = null;
    let isSubmitting: boolean = false;
    let errorMessage: string | null = null;
    let burned_amount_erg: number = 0; // Default to 0 (optional burn)

    async function submit() {
        isSubmitting = true;
        errorMessage = null;
        transactionId = null;

        try {
            if (burned_amount_erg < 0) {
                throw new Error("Burned amount cannot be negative");
            }
            const burned_amount = BigInt(
                Math.floor(burned_amount_erg * 10 ** 9),
            ); // Convert to nanoErgs

            // create_profile(explorerUri, total_supply, type_nft_id, content, sacrified_erg, sacrified_tokens)
            const tx = await create_profile(
                get(explorer_uri),
                1, // total_supply for a judge profile (usually 1 for a unique profile)
                JUDGE,
                null, // content
                burned_amount,
                [], // sacrified_tokens
            );
            transactionId = tx;
        } catch (error: any) {
            console.error(error);
            errorMessage = error.message.includes("insufficient funds")
                ? "Insufficient ERG in your wallet"
                : error.message ||
                  "Error occurred while registering as a judge";
        } finally {
            isSubmitting = false;
        }
    }

    function copyTransactionId() {
        if (transactionId) {
            navigator.clipboard.writeText(transactionId);
            alert("Transaction ID copied to clipboard!");
        }
    }
</script>

<div class="create-judge-container">
    <div class="hero-section text-center">
        <h2 class="project-title">Become a Judge</h2>
        <p class="subtitle">
            Discover the role of a judge and join the action.
        </p>
    </div>

    <div class="content-section">
        {#if !transactionId}
            <h3 class="section-title">What It Means to Be a Judge</h3>
            <ul class="judge-description list-disc pl-6 space-y-3">
                <li>
                    <strong>Nominated Role:</strong> You can be chosen to decide
                    which game submissions are valid, if you accept the game.
                </li>
                <li>
                    <strong>Open Judging:</strong> Judge any game or judge, even
                    if you're not nominated (no impact on game outcome).
                </li>
                <li>
                    <strong>On-Chain Transparency:</strong> All your judgments are
                    recorded on the blockchain for anyone to verify your honesty.
                </li>
                <li>
                    <strong>Build Your Reputation:</strong> A strong, honest track
                    record makes game creators want to nominate you as a judge.
                </li>
                <li>
                    <strong>Negotiate Commissions:</strong> As a judge, you can negotiate
                    with the game creator to receive a portion of their commission
                    for your judging role.
                </li>
                <li>
                    <strong>Burn ERG for Credibility:</strong> Optionally burn ERG
                    to strengthen your reputation proof. This permanent sacrifice
                    signals your commitment to honesty, making you stand out to game
                    creators.
                </li>
            </ul>

            <div class="form-group mt-4">
                <label
                    for="burned_amount"
                    class="block text-sm font-medium text-muted-foreground"
                    >Amount of ERG to Burn (Optional)</label
                >
                <input
                    type="number"
                    id="burned_amount"
                    bind:value={burned_amount_erg}
                    min="0"
                    step="0.001"
                    placeholder="Enter ERG amount (e.g., 1.5)"
                    class="mt-1 w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-background text-foreground"
                />
                <p class="text-sm text-muted-foreground mt-1">
                    Burning ERG enhances your reputation proof, signaling
                    honesty. This amount is permanently burned and cannot be
                    recovered.
                </p>
            </div>

            <div class="form-actions mt-8 flex justify-center">
                <Button
                    size="lg"
                    class="w-full sm:w-auto text-base"
                    on:click={submit}
                    disabled={isSubmitting}
                >
                    {#if isSubmitting}
                        <span class="spinner mr-2"></span> Registering...
                    {:else}
                        Register
                    {/if}
                </Button>
            </div>
        {:else}
            <div class="result-container text-center py-12">
                <h3 class="text-2xl font-bold text-green-500 mb-4">
                    Registration Submitted!
                </h3>
                <p class="mb-2">
                    Your judge registration transaction has been sent to the
                    blockchain.
                </p>
                <p class="text-sm text-muted-foreground mb-4">
                    It may take a few moments to confirm.
                </p>
                <div class="flex items-center justify-center">
                    <p
                        class="font-mono text-xs p-2 rounded bg-slate-800/50 break-all"
                    >
                        <a
                            href={get(web_explorer_uri_tx) + transactionId}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="hover:underline"
                        >
                            {transactionId}
                        </a>
                    </p>
                    <button
                        on:click={copyTransactionId}
                        class="ml-2 text-sm text-muted-foreground hover:underline"
                    >
                        Copy TxID
                    </button>
                </div>
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
    .create-judge-container {
        max-width: 700px;
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
    .content-section {
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
        @apply text-xl font-semibold mb-4 text-slate-800 dark:text-slate-200;
    }
    .judge-description {
        @apply text-base text-muted-foreground leading-relaxed;
    }
    .judge-description li {
        @apply text-base;
    }
    .spinner {
        display: inline-block;
        width: 1rem;
        height: 1rem;
        border: 2px solid currentColor;
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
