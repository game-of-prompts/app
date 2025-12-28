<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { total_burned_string } from "ergo-reputation-system";
  import { type ReputationProof } from "ergo-reputation-system";
  import { judge_detail } from "$lib/common/store";

  export let judge: ReputationProof;
  export let index: number;

  $: tokenId = judge?.token_id ?? "Unknown Token";
  $: opinionsCount = judge?.number_of_boxes > 0 ? judge.number_of_boxes - 1 : 0;
  $: totalErgsBurned = total_burned_string(judge);

  function handleViewDetails() {
    if (judge) judge_detail.set(judge);
  }
</script>

<div
  class="group relative overflow-hidden rounded-xl bg-card border border-border/50 shadow-md
  transition-all duration-200 hover:shadow-lg hover:-translate-y-1 p-4 sm:p-5 flex flex-col
  justify-between max-w-sm w-full"
>
  <div class="space-y-4">
    <!-- Header: Title + Badge -->
    <div class="flex items-center justify-between">
      <h3
        class="text-xl font-bold text-foreground tracking-tight leading-tight"
      >
        Judge {tokenId.slice(0, 4)}...{tokenId.slice(-2)}
      </h3>
      <Badge
        variant="secondary"
        class="text-[11px] px-2 py-0.5 font-medium shrink-0"
      >
        {opinionsCount} Opinions
      </Badge>
    </div>

    <!-- Token ID and ERGs Burned on same row -->
    <div class="grid grid-cols-2 gap-3 text-xs sm:text-sm">
      <div>
        <div class="text-muted-foreground uppercase tracking-wider text-[10px]">
          Token ID
        </div>
        <code
          class="font-mono text-[11px] text-primary/80 font-medium mt-1 block truncate"
        >
          {tokenId.slice(0, 8)}...{tokenId.slice(-6)}
        </code>
      </div>

      <div class="text-right">
        <div class="text-muted-foreground uppercase tracking-wider text-[10px]">
          ERGs Burned
        </div>
        <div class="font-semibold text-foreground mt-1">
          {totalErgsBurned} ERG
        </div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div
    class="flex items-center justify-end gap-3 pt-3 mt-3 border-t border-border/40"
  >
    <Button
      size="sm"
      class="w-full sm:w-auto transition-all duration-150 hover:scale-[1.02] 
      bg-slate-600 hover:bg-slate-700 text-white dark:bg-slate-300 
      dark:hover:bg-slate-200 dark:text-slate-900 font-semibold"
      on:click={handleViewDetails}
      disabled={!judge}
    >
      View Details
    </Button>
  </div>
</div>
