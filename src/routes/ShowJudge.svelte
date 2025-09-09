<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { reputation_proof } from '$lib/common/store';
    import { get } from 'svelte/store';
    import type { ReputationProof, RPBox } from '$lib/ergo/reputation/objects';

    // Obtener la prueba de reputación desde el store
    const proof: ReputationProof | undefined = get(reputation_proof);
</script>

<div class="show-judge-container">
    <div class="hero-section text-center">
        <h2 class="project-title">Judge Reputation Proof</h2>
        <p class="subtitle">Details of your reputation proof as a judge.</p>
    </div>

    <div class="content-section">
        {#if proof}
            <h3 class="section-title">Reputation Proof Details</h3>
            <ul class="proof-details list-disc pl-6 space-y-3">
                <li><strong>Token ID:</strong> {proof.token_id}</li>
                <li><strong>Type:</strong> {proof.type.typeName} ({proof.type.description})</li>
                <li><strong>Total Amount:</strong> {proof.total_amount}</li>
                <li><strong>Owner Address:</strong> {proof.owner_address}</li>
                <li><strong>Owner Hash (Serialized):</strong> {proof.owner_hash_serialized}</li>
                <li><strong>Can Be Spent:</strong> {proof.can_be_spend ? 'Yes' : 'No'}</li>
                <li><strong>Network:</strong> {proof.network}</li>
                <li><strong>Number of Boxes:</strong> {proof.number_of_boxes}</li>
                {#if proof.data && Object.keys(proof.data).length > 0}
                    <li><strong>Data:</strong> {JSON.stringify(proof.data)}</li>
                {/if}
            </ul>

            {#if proof.current_boxes && proof.current_boxes.length > 0}
                <h3 class="section-title mt-8">Reputation Boxes</h3>
                <div class="boxes-container">
                    {#each proof.current_boxes as box (box.box_id)}
                        <div class="box-item p-4 bg-slate-800/20 rounded-lg border border-white/10 mb-4">
                            <h4 class="text-lg font-semibold text-slate-200">Box ID: {box.box_id}</h4>
                            <ul class="list-disc pl-6 space-y-2 mt-2">
                                <li><strong>Token ID:</strong> {box.token_id}</li>
                                <li><strong>Token Amount:</strong> {box.token_amount}</li>
                                <li><strong>Type:</strong> {box.type.typeName}</li>
                                <li><strong>Object Pointer:</strong> {box.object_pointer}</li>
                                <li><strong>Is Locked:</strong> {box.is_locked ? 'Yes' : 'No'}</li>
                                <li><strong>Polarization:</strong> {box.polarization ? 'Positive' : 'Negative'}</li>
                                <li><strong>Content:</strong> {box.content ? (typeof box.content === 'object' ? JSON.stringify(box.content) : box.content) : 'None'}</li>
                            </ul>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="text-muted-foreground mt-4">No reputation boxes available.</p>
            {/if}
        {:else}
            <div class="no-proof text-center py-12">
                <h3 class="text-2xl font-bold text-red-500 mb-4">No Reputation Proof Found</h3>
                <p class="mb-4">It looks like you haven't registered a reputation proof yet.</p>
                <Button size="lg" href="/create-judge">Register as a Judge</Button>
            </div>
        {/if}
    </div>
</div>

<style lang="postcss">
    .show-judge-container {
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
    .content-section {
        @apply p-6 bg-background/50 backdrop-blur-lg rounded-xl shadow border border-white/10;
        animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .section-title {
        @apply text-xl font-semibold mb-4 text-slate-800 dark:text-slate-200;
    }
    .proof-details {
        @apply text-base text-muted-foreground leading-relaxed;
    }
    .proof-details li {
        @apply text-base;
    }
    .boxes-container {
        @apply flex flex-col gap-4;
    }
    .box-item {
        @apply transition-all duration-200;
    }
</style>