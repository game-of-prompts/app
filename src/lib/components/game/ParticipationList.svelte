<script lang="ts">
    import type { AnyGame, AnyParticipation } from '$lib/common/game';
    import ParticipationCard from './ParticipationCard.svelte';
    import { mode } from 'mode-watcher';
    import type { ErgoPlatform } from '$lib/ergo/platform';

    export let participations: AnyParticipation[] = [];
    export let game: AnyGame;
    export let platform: ErgoPlatform;
    export let currentHeight: number;
</script>

<section class="participations-section">
    <h2 class="text-3xl font-semibold mb-8 text-center">
        Participations 
        <span class="text-lg font-normal {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'}">
            ({participations.length})
        </span>
    </h2>
    
    {#if participations && participations.length > 0}
        <div class="flex flex-col gap-6">
            {#each participations as p (p.boxId)}
                <ParticipationCard 
                    participation={p}
                    {game}
                    {platform}
                    {currentHeight}
                />
            {/each}
        </div>
    {:else}
        <div class="text-center py-12 px-6 rounded-lg {$mode === 'dark' ? 'bg-slate-800' : 'bg-gray-50'} border {$mode === 'dark' ? 'border-slate-700' : 'border-gray-200'}">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mx-auto mb-4 opacity-40 text-slate-500"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <p class="font-medium {$mode === 'dark' ? 'text-slate-300' : 'text-slate-700'}">No Participations Yet</p>
            <p class="text-sm {$mode === 'dark' ? 'text-slate-400' : 'text-slate-500'}">
                Be the first one to submit a score!
            </p>
        </div>
    {/if}
</section>