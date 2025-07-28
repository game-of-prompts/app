<script lang="ts">
    import { onMount } from 'svelte';
    import { address, connected, balance, game_detail, timer } from "$lib/common/store";
    import CreateGame from './CreateGame.svelte';
    import TokenAcquisition from './TokenAcquisition.svelte';
    import GameDetails from './GameDetails.svelte';
    import { ErgoPlatform } from '$lib/ergo/platform';
    import { loadGameById } from '$lib/common/load_by_id';
    import { browser } from '$app/environment';
    import { page } from '$app/stores';
    import { type Game } from '$lib/common/game';
    import Kya from './kya.svelte';
    import { web_explorer_uri_addr } from '$lib/ergo/envs';
    import Theme from './Theme.svelte';
    import { Badge } from "$lib/components/ui/badge";
    import { Button, buttonVariants } from '$lib/components/ui/button';
    import * as Dialog from "$lib/components/ui/dialog/index.js";
    import * as Alert from "$lib/components/ui/alert";
    import { get } from 'svelte/store';
    import { fade } from 'svelte/transition';

    let activeTab = 'participateGame';
    let showCopyMessage = false;
    let showWalletInfo = false;
    let mobileMenuOpen = false;

    let platform = new ErgoPlatform();

    onMount(async () => {
        if (!browser) return;
        // Connect wallet on mount
        await platform.connect();

        const gameToken = $page.url.searchParams.get('game');
        if (gameToken) {
            await loadGameById(gameToken, platform);
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
        activeTab = tab;
        mobileMenuOpen = false;
    }

    function copyToClipboard() {
        if ($address) {
            navigator.clipboard.writeText($address)
                .then(() => {
                    showCopyMessage = true;
                    setTimeout(() => showCopyMessage = false, 2000);
                })
                .catch(err => console.error('Failed to copy text: ', err));
        }
    }

    async function updateWalletInfo() {
        try {
            await platform.get_balance();
            current_height = await platform.get_current_height();
        } catch (error) {
            console.error("Error updating wallet info:", error);
        }
    }

    let current_height: number | null = null;
    let balanceUpdateInterval: number;

    onMount(() => {
        getCurrentHeight();
        if (browser) {
            balanceUpdateInterval = setInterval(updateWalletInfo, 30000);
        }
        return () => {
            if (balanceUpdateInterval) clearInterval(balanceUpdateInterval);
        }
    });

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
            <img src="logo-large.svg" alt="Game of Prompts Logo" class="logo-image" />
        </a>

        <nav class="desktop-nav">
            <ul class="nav-links">
                <li class:active={activeTab === 'participateGame'}><a href="#" on:click|preventDefault={() => changeTab('participateGame')}>Games</a></li>
                <li class:active={activeTab === 'createGame'}><a href="#" on:click|preventDefault={() => changeTab('createGame')}>Create Game</a></li>
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
             <li class:active={activeTab === 'participateGame'}><a href="#" on:click|preventDefault={() => changeTab('participateGame')}>Games</a></li>
             <li class:active={activeTab === 'myParticipations'}><a href="#" on:click|preventDefault={() => changeTab('myParticipations')}>My Participations</a></li>
             <li class:active={activeTab === 'myGames'}><a href="#" on:click|preventDefault={() => changeTab('myGames')}>My Games</a></li>
             <li class:active={activeTab === 'createGame'}><a href="#" on:click|preventDefault={() => changeTab('createGame')}>Create Game</a></li>
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
    {#if $game_detail === null}
        {#if activeTab === 'participateGame'}
            <TokenAcquisition />
        {/if}
        {#if activeTab === 'createGame'}
            <CreateGame />
        {/if}
    {:else}
        <GameDetails />
    {/if}
</main>

<footer class="page-footer">
    <div class="footer-left">
        <Kya />
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
        /* REASONING: Ensure body background uses theme variables for a cohesive look. */
        background-color: hsl(var(--background));
    }
    
    .navbar-container {
        @apply sticky top-0 z-50 w-full border-b backdrop-blur-lg;
        /* REASONING: Simplified to a clean, standard sticky header with a bottom border for separation. */
        background-color: hsl(var(--background) / 0.8);
        border-bottom-color: hsl(var(--border));
    }

    .navbar-content {
        @apply container flex h-16 items-center;
        /* REASONING: Removed card styles. It's now a simple flex container to align items.
           Using a standard height `h-16` provides consistent vertical spacing. */
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
        /* REASONING: A more subtle default state for nav links. */
    }

    .nav-links li a:hover {
        @apply text-foreground;
        /* REASONING: Simple text color change on hover is cleaner. */
    }

    .nav-links li.active a {
        @apply text-foreground font-semibold;
        /* REASONING: The active state is now just bolded text in the primary foreground color.
           This is a modern, minimalist way to indicate the current page. */
    }

    .user-section {
        @apply flex items-center gap-4;
    }

    .user-info {
        @apply hidden sm:flex; /* Hide on extra small screens */
    }

    .badge-container {
        @apply flex items-center gap-2;
    }

    /* REASONING: Created a specific class for the address badge to style it like a button. */
    .address-badge {
        @apply inline-flex select-none items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold;
        @apply bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent;
        @apply transition-colors;
    }

    .wallet-button {
        @apply sm:hidden; /* Only show on small screens where user-info is hidden */
        /* (styles for the button itself are unchanged) */
    }

    .mobile-menu-button {
        @apply md:hidden; /* Only show on screens where desktop-nav is hidden */
    }
    
    /* (All other styles like hamburger, mobile menu are unchanged) */

    main {
        /* REASONING: To prevent the fixed footer from obscuring the last piece of content
        in the main section, we add padding to the bottom of the main element
        equal to the footer's height plus some extra space. */
        @apply pb-16;
    }

    .page-footer {
        /* REASONING: This creates a dedicated footer bar pinned to the bottom of the viewport,
        ensuring a clean separation from the main content instead of overlapping it. */
        @apply fixed bottom-0 left-0 right-0 z-40; /* Pinned to bottom, below header (z-50) */
        @apply flex items-center justify-between;
        @apply h-12 px-6; /* Consistent height and horizontal padding */
        @apply border-t text-sm text-muted-foreground;
        background-color: hsl(var(--background) / 0.8);
        border-top-color: hsl(var(--border));
        backdrop-filter: blur(4px);
    }

    .footer-left,
    .footer-right {
        @apply flex items-center gap-2;
    }
</style>