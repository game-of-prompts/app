<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { getGopJudgesPaidScriptHash } from "$lib/ergo/contract";
    import { distribute_judges_payout } from "$lib/ergo/actions/distribute_judges_payout";
    import { explorer_uri } from "$lib/ergo/envs";
    import type { Box, Amount } from "@fleet-sdk/core";
    import { SConstant } from "@fleet-sdk/serializer";
    import { uint8ArrayToHex } from "$lib/ergo/utils";

    let pendingBoxes: Box<Amount>[] = [];
    let loading = true;
    let error = "";
    let processingBoxId: string | null = null;

    async function fetchPendingPayments() {
        loading = true;
        error = "";
        try {
            const scriptHash = getGopJudgesPaidScriptHash();
            const uri = get(explorer_uri);
            const response = await fetch(
                `${uri}/api/v1/boxes/unspent/byErgoTreeTemplateHash/${scriptHash}`,
            );
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch boxes: ${response.statusText}`,
                );
            }
            const data = await response.json();
            // Filter boxes that match our contract (template hash might return others if shared, but unlikely here)
            // We can also validate registers if needed.
            pendingBoxes = data.items || data; // Explorer API varies
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = false;
        }
    }

    async function handleDistribute(box: Box<Amount>) {
        if (processingBoxId) return;
        processingBoxId = box.boxId;
        try {
            await distribute_judges_payout(box);
            alert("Distribution transaction submitted successfully!");
            // Refresh list after a delay or optimistically remove
            setTimeout(fetchPendingPayments, 5000);
        } catch (e) {
            alert(
                `Error distributing funds: ${e instanceof Error ? e.message : String(e)}`,
            );
        } finally {
            processingBoxId = null;
        }
    }

    function getJudgeCount(box: Box<Amount>): number {
        try {
            const r4 = box.additionalRegisters["R4"];
            if (!r4) return 0;
            // @ts-ignore
            const judges = SConstant.fromHex(r4).data as Uint8Array[];
            return judges.length;
        } catch {
            return 0;
        }
    }

    function getTokenInfo(box: Box<Amount>): string {
        try {
            const r5 = box.additionalRegisters["R5"];
            if (!r5) return "ERG";
            // @ts-ignore
            const tokenIdBytes = SConstant.fromHex(r5).data as Uint8Array;
            const tokenId = uint8ArrayToHex(tokenIdBytes);
            if (!tokenId) return "ERG";

            const asset = box.assets.find((a) => a.tokenId === tokenId);
            return asset ? `${asset.amount} (Token)` : "0 (Token)";
        } catch {
            return "Unknown";
        }
    }

    onMount(() => {
        fetchPendingPayments();
    });
</script>

<div class="container mx-auto p-4">
    <h1 class="text-2xl font-bold mb-4">Pending Judge Payments</h1>

    <button
        class="btn btn-primary mb-4"
        on:click={fetchPendingPayments}
        disabled={loading}
    >
        {loading ? "Refreshing..." : "Refresh List"}
    </button>

    {#if error}
        <div class="alert alert-error mb-4">
            <span>{error}</span>
        </div>
    {/if}

    {#if pendingBoxes.length === 0 && !loading}
        <div class="text-center p-8 bg-base-200 rounded-lg">
            <p>No pending payments found.</p>
        </div>
    {:else}
        <div class="grid gap-4">
            {#each pendingBoxes as box (box.boxId)}
                <div class="card bg-base-100 shadow-xl border border-base-300">
                    <div class="card-body">
                        <h2 class="card-title text-sm break-all">
                            Box ID: {box.boxId}
                        </h2>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 my-2">
                            <div>
                                <span class="font-bold">Value:</span>
                                {(BigInt(box.value) / 1000000000n).toString()} ERG
                            </div>
                            <div>
                                <span class="font-bold">Judges:</span>
                                {getJudgeCount(box)}
                            </div>
                            <div>
                                <span class="font-bold">Token:</span>
                                {getTokenInfo(box)}
                            </div>
                        </div>
                        <div class="card-actions justify-end">
                            <button
                                class="btn btn-secondary"
                                on:click={() => handleDistribute(box)}
                                disabled={!!processingBoxId}
                            >
                                {#if processingBoxId === box.boxId}
                                    <span class="loading loading-spinner"
                                    ></span> Processing...
                                {:else}
                                    Distribute Funds
                                {/if}
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
