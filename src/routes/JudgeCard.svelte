<script lang="ts">
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button";
    import { total_burned_string, type ReputationProof } from "$lib/ergo/reputation/objects";

    export let judge: ReputationProof;
    export let index: number;

    $: isEven = index % 2 === 0;

    // Short token id
    $: tokenIdShort = judge?.token_id
        ? `${judge.token_id.slice(0, 8)}...${judge.token_id.slice(-8)}`
        : "Unknown Token";

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

    $: wallpaperUrl = judge?.token_id
        ? defaultImages[hashStringToNumber(judge.token_id) % defaultImages.length]
        : defaultImages[0];

</script>

<div
    class="judge-row flex flex-col md:flex-row items-center gap-6 md:gap-12 lg:px-12 xl:px-20"
    class:md:flex-row-reverse={!isEven}
>
    <!-- Image / Wallpaper -->
    <div class="judge-image w-full md:w-1/2 rounded-xl overflow-hidden shadow-md flex-shrink-0">
        <img src={wallpaperUrl} alt="Judge wallpaper" class="w-full h-64 object-cover" />
    </div>

    <!-- Content -->
    <div class="content-wrapper w-full text-center md:text-left flex flex-col justify-center">
        <Badge variant="secondary" class="mb-3">
            {opinionsCount} Opinions
        </Badge>

        <h3 class="text-2xl font-bold font-['Russo_One'] mb-2 text-slate-700 dark:text-slate-300">
            Judge Token
        </h3>

        <div class="text-xs text-gray-500 dark:text-gray-400 mb-4 space-y-1">
            <p>
                Token ID:
                <span
                    class="font-mono bg-gray-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded text-slate-700 dark:text-slate-300"
                >
                    {tokenIdShort}
                </span>
            </p>
        </div>

        <div class="status-info flex flex-col sm:flex-row gap-6 items-center mb-6 justify-center md:justify-start">
            <div class="text-center md:text-left">
                <div class="text-xs uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    Opinions
                </div>
                <div class="px-3 py-1 rounded-full text-sm font-semibold mt-1 bg-slate-200 dark:bg-slate-700">
                    {opinionsCount}
                </div>
            </div>
            <div class="text-center md:text-left">
                <div class="text-xs uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    ERGs Burned
                </div>
                <div class="text-lg font-semibold text-slate-700 dark:text-slate-200 mt-1">
                    {totalErgsBurned} ERG
                </div>
            </div>
        </div>

        <Button
            size="lg"
            class="w-full sm:w-auto transition-all duration-200 hover:scale-[1.03] bg-slate-600 hover:bg-slate-700 text-white dark:bg-slate-300 dark:hover:bg-slate-200 dark:text-slate-900 font-semibold"
        >
            View Details
        </Button>
    </div>
</div>

<style>
    .judge-row {
        padding: 1.5rem;
        background-color: var(--card);
        border-radius: 1rem;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05),
            0 4px 6px -2px rgba(0, 0, 0, 0.05);
        border: 1px solid var(--border);
        transition: box-shadow 0.3s ease, transform 0.3s ease;
    }
    .judge-row:hover {
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
            0 10px 10px -5px rgba(0, 0, 0, 0.04);
        transform: translateY(-3px);
    }

    .judge-image img {
        transition: transform 0.4s ease;
        border-radius: 0.75rem;
    }
    .judge-image img:hover {
        transform: scale(1.05);
    }
</style>