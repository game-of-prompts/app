<script lang="ts">
    import { onMount } from 'svelte';
    import { address, connected, balance, game_detail, timer, judge_detail } from "$lib/common/store";
    import CreateGame from './CreateGame.svelte';
    import TokenAcquisition from './TokenAcquisition.svelte';
    import GameDetails from './GameDetails.svelte';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { loadGameById } from '$lib/common/load_by_id';
    import { browser } from '$app/environment';
    import { page } from '$app/stores';
    import { type Game } from '$lib/common/game';
    import Kya from './kya.svelte';
    import Theme from './Theme.svelte';
    import { Badge } from "$lib/components/ui/badge";
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import { get } from 'svelte/store';
    import { fade } from 'svelte/transition';
    import CreateJudge from './CreateJudge.svelte';
    import { reputation_proof } from '$lib/common/store';
    import ShowJudge from './ShowJudge.svelte';
    import { fetchReputationProofs } from '$lib/ergo/reputation/fetch';
    import { total_burned } from '$lib/ergo/reputation/objects';
    import JudgeList from './JudgeList.svelte';

    let activeTab = 'participateGame';
    let showCopyMessage = false;
    let showWalletInfo = false;
    let mobileMenuOpen = false;

    let platform = new ErgoPlatform();

    const footerMessages = [
        "Direct P2P to your node. No central servers. Powered by Ergo Blockchain.",
        "Package your solution. Compete in a verifiable environment. Based on the Celaut paradigm.",
        "This web page is the public gateway to GoP. Transparently hosted on GitHub. Or run it yourself for full P2P sovereignty.",
    ];
    let activeMessageIndex = 0;
    let scrollingTextElement: HTMLElement;

    function handleAnimationIteration() {
        activeMessageIndex = (activeMessageIndex + 1) % footerMessages.length;
    }

    let current_height: number | null = null;
    let balanceUpdateInterval: number;

    onMount(async () => {
        if (!browser) return;
        
        // Conectar wallet
        await platform.connect();

        const gameToken = $page.url.searchParams.get('game');
        if (gameToken) {
            await loadGameById(gameToken, platform);
        }

        getCurrentHeight();
        balanceUpdateInterval = setInterval(updateWalletInfo, 30000);

        scrollingTextElement?.addEventListener('animationiteration', handleAnimationIteration);

        return () => {
            if (balanceUpdateInterval) clearInterval(balanceUpdateInterval);
            scrollingTextElement?.removeEventListener('animationiteration', handleAnimationIteration);
        }
    });

    connected.subscribe(async (isConnected) => {
        if (isConnected) {
            await updateWalletInfo();
        }
    });

    function changeTab(tab: string) {
        const timerValue = get(timer);
        if (timerValue.countdownInterval) {
            clearInterval(timerValue.countdownInterval);
        }
        timer.set({ countdownInterval: 0, target: 0 });
        game_detail.set(null);
        judge_detail.set(null);
        activeTab = tab;
        mobileMenuOpen = false;
    }

    game_detail.subscribe((value) => {
        if (value) {
            activeTab = "participateGame";
        }
    })

    judge_detail.subscribe((value) => {
        if (value) {
            activeTab = "judges";
        }
    })

    async function updateWalletInfo() {
        try {
            await platform.get_balance();
            current_height = await platform.get_current_height();

            const proofs = await fetchReputationProofs(ergo, false, "judge", null);

            if (proofs.size > 0) {
                let maxBurned = -Infinity;
                let selectedProof = null;

                for (const [key, proof] of proofs.entries()) {
                    const burned = total_burned(proof);
                    if (burned > maxBurned) {
                        maxBurned = burned;
                        selectedProof = proof;
                    }
                }

                if (selectedProof) {
                    reputation_proof.set(selectedProof);
                    console.log("Added judge proof with highest burned: ", maxBurned);
                } else {
                    console.log("No valid proof found.");
                }
            }
        } catch (error) {
            console.error("Error updating wallet info:", error);
        }
    }

    async function getCurrentHeight() {
        try { current_height = await platform.get_current_height(); }
        catch (error) { console.error("Error fetching current height:", error); }
    }

    async function changeUrl(game: Game|null) {
        if (typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        if (game !== null) { url.searchParams.set("game", game.gameId); }
        else { url.searchParams.delete("game"); }
        window.history.pushState({}, '', url);
    }

    $: ergInErgs = $balance ? ($balance / 1_000_000_000).toFixed(4) : 0;
    $: changeUrl($game_detail);

</script>

<header class="navbar-container">
    <div class="navbar-content">
        <a href="#" on:click|preventDefault={() => changeTab('participateGame')} class="logo-container">
            <img 
                src="logo-large.svg" 
                alt="Game of Prompts Logo" 
                class="block dark:hidden logo-image" 
            />

            <img 
                src="logo-large-dark.svg" 
                alt="Game of Prompts Logo" 
                class="hidden dark:block logo-image" 
            />
        </a>

        <nav class="desktop-nav">
            <ul class="nav-links">
                <li class:active={activeTab === 'participateGame'}><a href="#" on:click|preventDefault={() => changeTab('participateGame')}>Competitions</a></li>
                <li class:active={activeTab === 'createGame'}><a href="#" on:click|preventDefault={() => changeTab('createGame')}>Create Competition</a></li>
                <li class:active={activeTab === 'judges'}><a href="#" on:click|preventDefault={() => changeTab('judges')}>Judges</a></li>
                {#if !$reputation_proof}
                    <li class:active={activeTab === 'createJudge'}><a href="#" on:click|preventDefault={() => changeTab('createJudge')}>Become a Judge</a></li>
                {:else}
                    <li class:active={activeTab === 'showJudge'}><a href="#" on:click|preventDefault={() => changeTab('showJudge')}>My reputation</a></li>
                {/if}
            </ul>
        </nav>

        <div class="user-section">
            {#if $address}
                <div class="user-info">
                    <div class="badge-container">
                        <Badge variant="secondary">{ergInErgs} ERG</Badge>
                        <button on:click={() => showWalletInfo = true} class="address-badge">
                            {$address.slice(0, 6)}...{$address.slice(-4)}
                        </button>
                    </div>
                </div>
                <button class="wallet-button" on:click={() => showWalletInfo = true} aria-label="Wallet info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2-2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
                </button>
            {/if}
            <div class="theme-toggle">
                <Theme />
            </div>
        </div>

        <button class="mobile-menu-button" on:click={() => (mobileMenuOpen = !mobileMenuOpen)} aria-label="Toggle menu">
            <div class="hamburger" class:open={mobileMenuOpen}>
                <span /><span /><span />
            </div>
        </button>
    </div>
</header>

{#if mobileMenuOpen}
    <div class="mobile-nav" transition:fade={{ duration: 200 }}>
        <ul class="mobile-nav-links">
            
        </ul>
    </div>
{/if}

{#if $address}
    <Dialog.Root bind:open={showWalletInfo}>
        <Dialog.Content>
            <Dialog.Header>
                <Dialog.Title>Wallet Info</Dialog.Title>
            </Dialog.Header>
            <div class="py-4">
                Address: {$address}
                </div>
        </Dialog.Content>
    </Dialog.Root>
{/if}

<main class="pb-16">
    {#if $game_detail === null && $judge_detail == null}
        {#if activeTab === 'participateGame'}
            <TokenAcquisition />
        {/if}
        {#if activeTab === 'createGame'}
            <CreateGame />
        {/if}
        {#if activeTab === 'judges'}
            <JudgeList />
        {/if}
        {#if activeTab === 'createJudge'}
            <CreateJudge />
        {/if}
        {#if activeTab === 'showJudge'}
            <ShowJudge />
        {/if}
    {:else if $game_detail !== null}
        <GameDetails />
    {:else}
        <ShowJudge />
    {/if}
</main>

<footer class="page-footer">
    <div class="footer-left">
        <Kya />
    </div>

    <div class="footer-center">
        <div bind:this={scrollingTextElement} class="scrolling-text-wrapper">
            {footerMessages[activeMessageIndex]}
        </div>
    </div>

    <div class="footer-right">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M0.502 2.999L6 0L11.495 3.03L6.0025 5.96L0.502 2.999V2.999ZM6.5 6.8365V12L11.5 9.319V4.156L6.5 6.8365V6.8365ZM5.5 6.8365L0.5 4.131V9.319L5.5 12V6.8365Z" fill="currentColor"></path></svg>
        {#if current_height}
            <span>{current_height}</span>
        {/if}
    </div>
</footer>

<style lang="postcss">
    :global(body) {
        background-color: hsl(var(--background));
    }
    
    .navbar-container {
        @apply sticky top-0 z-50 w-full border-b backdrop-blur-lg;
        background-color: hsl(var(--background) / 0.8);
        border-bottom-color: hsl(var(--border));
    }

    .navbar-content {
        @apply container flex h-16 items-center;
    }

    .logo-container {
        @apply mr-4 flex items-center;
    }

    .logo-image {
        @apply h-10 w-auto;
    }

    .desktop-nav {
        @apply hidden md:flex flex-1;
    }

    .nav-links {
        @apply flex items-center gap-6 text-sm;
    }

    .nav-links li a {
        @apply transition-colors text-muted-foreground;
    }

    .nav-links li a:hover {
        @apply text-foreground;
    }

    .nav-links li.active a {
        @apply text-foreground font-semibold;
    }

    .user-section {
        @apply flex items-center gap-4;
    }

    .user-info {
        @apply hidden sm:flex;
    }

    .badge-container {
        @apply flex items-center gap-2;
    }

    .address-badge {
        @apply inline-flex select-none items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold;
        @apply bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent;
        @apply transition-colors;
    }

    .wallet-button {
        @apply sm:hidden;
    }

    .mobile-menu-button {
        @apply md:hidden;
    }
    
    main {
        @apply pb-16;
    }

    .page-footer {
        @apply fixed bottom-0 left-0 right-0 z-40;
        @apply flex items-center;
        @apply h-12 px-6 gap-6;
        @apply border-t text-sm text-muted-foreground;
        background-color: hsl(var(--background) / 0.8);
        border-top-color: hsl(var(--border));
        backdrop-filter: blur(4px);
    }

    .footer-left,
    .footer-right {
        @apply flex items-center gap-2 flex-shrink-0;
    }

    .footer-center {
        @apply flex-1 overflow-hidden;
        -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
        mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
    }

    .scrolling-text-wrapper {
        @apply inline-block whitespace-nowrap;
        animation: scroll-left 40s linear infinite;
        transition: animation-duration 0.5s ease;
    }

    @keyframes scroll-left {
        from {
            transform: translateX(100vw);
        }
        to {
            transform: translateX(-100%);
        }
    }

</style>