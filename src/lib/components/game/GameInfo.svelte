<script lang="ts">
    import type { AnyGame } from '$lib/common/game';
    import { web_explorer_uri_tkn, web_explorer_uri_addr } from '$lib/ergo/envs';
    import { pkHexToBase58Address } from '$lib/ergo/utils';
    import { mode } from "mode-watcher";

    export let game: AnyGame;
    export let isOwner: boolean;

    // Reactive variable for cleaner template code
    $: creatorAddr = pkHexToBase58Address(game.gameCreatorPK_Hex);
</script>

<section class="game-info-section mb-12 p-6 rounded-xl shadow {$mode === 'dark' ? 'bg-slate-800' : 'bg-white'}">
    <h2 class="text-2xl font-semibold mb-6">Details</h2>
    
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
        <div class="info-block">
            <span class="info-label">Competition ID (NFT)</span>
            <a href="{web_explorer_uri_tkn + game.gameId}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={game.gameId}>
                {game.gameId.slice(0, 20)}...{game.gameId.slice(-4)}
            </a>
        </div>
        <div class="info-block">
            <span class="info-label">Service ID</span>
            <span class="info-value font-mono text-xs break-all" title={game.content.serviceId}>{game.content.serviceId}</span>
        </div>
        <div class="info-block">
            <span class="info-label">Creator Address {isOwner ? '(You)' : ''}</span>
            <a href="{web_explorer_uri_addr + creatorAddr}" target="_blank" rel="noopener noreferrer" class="info-value font-mono text-xs break-all hover:underline" title={creatorAddr}>
                {creatorAddr.slice(0, 12)}...{creatorAddr.slice(-6)}
            </a>
        </div>
        {#if game.hashS}
        <div class="info-block col-span-1 md:col-span-2 lg:col-span-3">
            <span class="info-label">Hashed Secret (S)</span>
            <span class="info-value font-mono text-xs break-all">{game.hashS}</span>
        </div>
        {/if}
    </div>
</section>

<style lang="postcss">
    .info-block {
        display: flex;
        flex-direction: column;
    }
    .info-label {
        font-size: 0.75rem;
        line-height: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        @apply text-slate-400 mb-1;
    }
    :global(.light) .info-label {
        @apply text-gray-500;
    }
    .info-value {
        font-weight: 500;
    }
</style>