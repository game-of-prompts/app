<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { total_burned_string, type Judge } from "$lib/ergo/reputation/objects";
    import { judge_detail } from "$lib/common/store";

    export let judge: Judge;
    export let index: number;

    $: isEven = index % 2 === 0;

    // Short token id
    $: tokenId = judge?.token_id ?? "Unknown Token";

    // Derived values
    $: opinionsCount = judge?.number_of_boxes > 0 ? judge.number_of_boxes - 1 : 0;
    $: totalErgsBurned = total_burned_string(judge);

    // Wallpaper fallback
    const defaultImages = [
        "https://img.freepik.com/free-photo/view-3d-man-working-justice-law-field_23-2151228049.jpg",
        "https://img.freepik.com/free-photo/view-3d-male-lawyer-suit_23-2151228110.jpg",
        "https://img.freepik.com/free-photo/view-3d-courtroom-scene-lawyer-s-day-celebration_23-2151023376.jpg",
        "https://img.freepik.com/free-photo/view-3d-courtroom-scene-lawyer-s-day-celebration_23-2151023367.jpg"
    ];

    function hashStringToNumber(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    function handleViewDetails() {
        if (judge) {
            judge_detail.set(judge);
        }
    }

    $: wallpaperUrl = judge?.token_id
        ? defaultImages[hashStringToNumber(judge.token_id) % defaultImages.length]
        : defaultImages[0];
</script>

<div class="group relative overflow-hidden rounded-2xl bg-card border border-border/50 shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1">
    <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    
    <div class="flex flex-col lg:flex-row {isEven ? 'lg:flex-row-reverse' : ''} gap-0">
        <div class="relative w-full lg:w-2/5 aspect-video lg:aspect-auto overflow-hidden bg-muted/50">
            {#if wallpaperUrl}
                <img 
                    src={wallpaperUrl} 
                    alt="Judge wallpaper"
                    class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            {/if}
        </div>

        <div class="flex-1 p-6 lg:p-8 flex flex-col justify-between">
            <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <Badge variant="secondary" class="text-xs">
                            {opinionsCount} Opinions
                        </Badge>
                    </div>
                </div>

                <div>
                    <h3 class="text-2xl lg:text-3xl font-bold text-foreground tracking-tight line-clamp-2">
                        Judge {tokenId.slice(0, 4)}...{tokenId.slice(-2)}
                    </h3>
                </div>
            </div>

            <div class="mt-6 space-y-4">
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div class="text-muted-foreground uppercase tracking-wider text-xs">Token ID</div>
                        <code class="font-mono text-xs text-primary/80 font-medium mt-1 block truncate">
                            {tokenId.slice(0, 8)}...{tokenId.slice(-6)}
                        </code>
                    </div>
                    <div>
                        <div class="text-muted-foreground uppercase tracking-wider text-xs">ERGs Burned</div>
                        <div class="font-bold text-foreground mt-1">
                            {totalErgsBurned} ERG
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-4 pt-2 border-t border-border/50">
                    <Button
                        size="lg"
                        class="w-full sm:w-auto transition-all duration-200 hover:scale-[1.03] bg-slate-600 hover:bg-slate-700 text-white dark:bg-slate-300 dark:hover:bg-slate-200 dark:text-slate-900 font-semibold"
                        on:click={handleViewDetails}
                        disabled={!judge}
                    >
                        View Details
                    </Button>
                </div>
            </div>
        </div>
    </div>
</div>