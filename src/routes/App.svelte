<script lang="ts">
    import { onMount } from 'svelte';
    import { address, connected, balance, game_detail, timer } from "$lib/common/store";
    import CreateGame from './CreateGame.svelte';
    import TokenAcquisition from './TokenAcquisition.svelte';
    import CardDetails from './CardDetails.svelte';
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
        await platform.connect();

        const gameToken = $page.url.searchParams.get('game');

        if (gameToken) {
            await loadGameById(gameToken, platform);
        }
    });

    connected.subscribe(async (isConnected) => {
        console.log("Connected to the network.");
        if (isConnected) {
            // Update the balance information whenever connection state changes
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
        mobileMenuOpen = false; // Close mobile menu after selection
    }

    // Function to copy the wallet address to the clipboard
    function copyToClipboard() {
        if ($address) {
            navigator.clipboard.writeText($address)
                .then(() => {
                    showCopyMessage = true;
                    setTimeout(() => showCopyMessage = false, 2000); // Hide message after 2 seconds
                })
                .catch(err => console.error('Failed to copy text: ', err));
        }
    }

    function disconnect() {
        if ($address) {
            
        }
    }

    // Close the modal if the user clicks outside of it
    function handleOutsideClick(event: MouseEvent) {
        showWalletInfo = false;
    }

    function toggleMobileMenu() {
        mobileMenuOpen = !mobileMenuOpen;
    }

    let current_height: number | null = null;

    async function getCurrentHeight() {
        try {
            current_height = await platform.get_current_height();
        } catch (error) {
            console.error("Error fetching current height:", error);
        }
    }
    getCurrentHeight();

    async function changeUrl(game: Game|null) {
        if (typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        
        if (game !== null) {
            url.searchParams.set("game", game.gameId);
        } else {
            url.searchParams.delete("game");
        }
        
        window.history.pushState({}, '', url);
    }

    $: ergInErgs = $balance ? ($balance / 1_000_000_000).toFixed(4) : 0;
    $: changeUrl($game_detail);

    // Function to update wallet information periodically
    async function updateWalletInfo() {
        try {
            await platform.get_balance(); // This updates the balance store
            // Update current height
            current_height = await platform.get_current_height();
        } catch (error) {
            console.error("Error updating wallet info:", error);
        }
    }

    // Set up periodic balance refresh (every 30 seconds)
    let balanceUpdateInterval: number;

    onMount(() => {
        if (browser) {
            balanceUpdateInterval = setInterval(updateWalletInfo, 30000);
        }

        return () => {
            if (balanceUpdateInterval) {
                clearInterval(balanceUpdateInterval);
            }
        }
    });

</script>

<header class="navbar-container">
    <div class="navbar-content">
        <!-- Logo Section -->
        <div class="logo-container">
            <img src="logo-large.svg" alt="Logo" class="logo-image" />
        </div>

        <!-- Desktop Navigation -->
        <nav class="desktop-nav">
            <ul class="nav-links">
                <li class={activeTab === 'participateGame' ? 'active' : ''}>
                    <a href="#" on:click={() => changeTab('participateGame')}>
                        Games
                    </a>
                </li>
                <li class={activeTab === 'myParticipations' ? 'active' : ''}>
                    <a href="#" on:click={() => changeTab('myParticipations')}>
                        My Participations
                    </a>
                </li>
                <li class={activeTab === 'myGames' ? 'active' : ''}>
                    <a href="#" on:click={() => changeTab('myGames')}>
                        My Games
                    </a>
                </li>
                <li class={activeTab === 'createGame' ? 'active' : ''}>
                    <a href="#" on:click={() => changeTab('createGame')}>
                        Create Game
                    </a>
                </li>
            </ul>
        </nav>

        <!-- User Info and Theme -->
        <div class="user-section">
            {#if $address}
                <div class="user-info">
                    <div class="badge-container">
                        <Badge style="background-color: slate; color: black; font-size: 0.9em;">
                            {ergInErgs} ERG
                        </Badge>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <a on:click={() => showWalletInfo = true}>
                            <Badge style="background-color: slate; color: black; font-size: 0.9em;">
                                {$address.slice(0, 6) + '...' + $address.slice(-4)}
                            </Badge>
                        </a>
                    </div>
                </div>
                
                <!-- Wallet Button for smaller screens -->
                <button class="wallet-button" on:click={() => showWalletInfo = true} aria-label="Wallet info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
                </button>
            {/if}
            
            <div class="theme-toggle">
                <Theme />
            </div>
        </div>

        <!-- Mobile Menu Button -->
        <button class="mobile-menu-button" on:click={toggleMobileMenu} aria-label="Toggle menu">
            <div class="hamburger {mobileMenuOpen ? 'open' : ''}">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </button>
    </div>
</header>

<!-- Mobile Navigation Menu -->
{#if mobileMenuOpen}
    <div class="mobile-nav" transition:fade={{ duration: 200 }}>
        <ul class="mobile-nav-links">
            <li class={activeTab === 'participateGame' ? 'active' : ''}>
                <a href="#" on:click={() => changeTab('participateGame')}>
                    Games
                </a>
            </li>
            <li class={activeTab === 'createGame' ? 'active' : ''}>
                <a href="#" on:click={() => changeTab('createGame')}>
                    New Project
                </a>
            </li>
        </ul>
    </div>
{/if}

<!-- svelte-ignore a11y-no-static-element-interactions -->
{#if $address}
    <Dialog.Root bind:open={showWalletInfo}>
    <Dialog.Content class="sm:max-w-[425px] md:max-w-[600px] lg:max-w-[800px]">
        <Dialog.Header>
        <Dialog.Title>Wallet Info</Dialog.Title>
        </Dialog.Header>
        <div class="py-4">
        <!-- svelte-ignore a11y-missing-attribute -->
        <a>Address: {$address.slice(0, 19) + '...' + $address.slice(-8)}</a>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-missing-attribute -->
        <a on:click={copyToClipboard}>🔗</a>
        <a href="{web_explorer_uri_addr + $address}" target="_blank">🔍</a>
    
        {#if showCopyMessage}
        <Alert.Root>
            <Alert.Description>
                Wallet address copied to clipboard!
            </Alert.Description>
        </Alert.Root>
        {/if}
    
        <p>Total balance: {ergInErgs} {platform.main_token}</p>

        <p class="text-muted-foreground text-sm" style="margin-top: 2rem;">
        To disconnect, please delete this webpage from the connected dApps settings in the Nautilus extension. Then reload the page.
        </p>
    
        <Dialog.Footer>
        <Button
        disabled
        class={buttonVariants({ variant: "outline" })}
        on:click={disconnect}>
            Disconnect
        </Button>
        </Dialog.Footer>
        </div>
    </Dialog.Content>
    </Dialog.Root>
{/if}

{#if $game_detail === null}
    {#if activeTab === 'participateGame'}
        <TokenAcquisition />
    {/if}
    {#if activeTab === 'createGame'}
        <CreateGame />
    {/if}
{:else}
    <CardDetails />
{/if}

<div class="bottom-left"> 
    <Kya />
</div>

<div class="bottom-right">
    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4"><path d="M0.502 2.999L6 0L11.495 3.03L6.0025 5.96L0.502 2.999V2.999ZM6.5 6.8365V12L11.5 9.319V4.156L6.5 6.8365V6.8365ZM5.5 6.8365L0.5 4.131V9.319L5.5 12V6.8365Z" fill="currentColor"></path></svg>
    {current_height}
</div>

<style>
       :global(html) {
        height: 100%;
        scroll-behavior: smooth;
        overflow-y: auto;
    }

    :global(body) {
        margin: 0;
        padding: 0;
        overflow-y: auto !important; 
        overflow-x: hidden;
        height: 100%;
    }
    

    :global(.bits-dropdown-menu-content-wrapper) {
        position: absolute !important;
        z-index: 999 !important;
        pointer-events: auto !important;
    }
    

    :global(.bits-dropdown-menu-root-open) {
        position: static !important;
        overflow: visible !important;
    }
    /* Navbar Styles */
    .navbar-container {
        position: sticky;
        top: 0;
        left: 0;
        right: 0;
        z-index: 50;
        padding: 0.5rem 1rem;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        background-color: rgba(0, 0, 0, 0.05);
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
    }

    .navbar-content {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 16px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }

    /* Logo Styles */
    .logo-container {
        display: flex;
        align-items: center;
        cursor: pointer;
        transition: transform 0.2s ease;
        padding: 0.25rem 0.5rem;
        border-radius: 12px;
        flex-shrink: 0;
        margin-right: 1rem;
    }

    .logo-container:hover {
        transform: scale(1.02);
        box-shadow: 0 0 15px rgba(100, 116, 139, 0.2);
    }

    .logo-image {
        display: inline-block;
        object-fit: contain;
        width: 100%;
        height: auto;
        max-height: 4rem;
    }

    /* Desktop Navigation */
    .desktop-nav {
        display: none;
        flex: 1;
        overflow: hidden;
    }

    @media (min-width: 768px) {
        .desktop-nav {
            display: block;
        }
    }

    .nav-links {
        display: flex;
        list-style: none;
        margin: 0;
        padding: 0;
        gap: 1.5rem;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none; /* IE and Edge */
    }

    .nav-links::-webkit-scrollbar {
        display: none; /* Chrome, Safari, Opera */
    }

    .nav-links li {
        position: relative;
    }

    .nav-links li a {
        color: inherit;
        text-decoration: none;
        font-weight: 500;
        padding: 0.5rem 0.75rem;
        display: block;
        transition: all 0.2s ease;
        border-radius: 8px;
        border-bottom: 2px solid transparent;
    }

    .nav-links li a:hover {
        color: slate;
        background: rgba(100, 116, 139, 0.05);
        box-shadow: 0 0 10px rgba(100, 116, 139, 0.1);
    }

    .nav-links li.active a {
        border-bottom: 2px solid slate;
        color: slate;
        background: rgba(100, 116, 139, 0.1);
        box-shadow: 0 0 15px rgba(100, 116, 139, 0.15);
    }

    /* User Section */
    .user-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.25rem 0.5rem;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        flex-shrink: 0;
    }

    .user-info {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .badge-container {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .wallet-button {
        display: none;
        background: rgba(100, 116, 139, 0.15);
        border: none;
        color: slate;
        border-radius: 8px;
        padding: 0.4rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .wallet-button:hover {
        background: rgba(100, 116, 139, 0.3);
        box-shadow: 0 0 10px rgba(100, 116, 139, 0.2);
    }

    @media (max-width: 1024px) {
        .wallet-button {
            display: flex;
        }
    }

    /* Mobile Menu Button */
    .mobile-menu-button {
        display: block;
        background: none;
        border: none;
        cursor: pointer;
        z-index: 100;
        padding: 0.5rem;
        border-radius: 8px;
        transition: background-color 0.2s ease;
        margin-left: 0.5rem;
    }

    .mobile-menu-button:hover {
        background-color: rgba(100, 116, 139, 0.1);
    }

    @media (min-width: 768px) {
        .mobile-menu-button {
            display: none;
        }
    }

    .hamburger {
        width: 24px;
        height: 20px;
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }

    .hamburger span {
        display: block;
        height: 3px;
        width: 100%;
        background-color: slate;
        border-radius: 3px;
        transition: all 0.3s ease;
        box-shadow: 0 0 5px rgba(100, 116, 139, 0.3);
    }

    .hamburger.open span:nth-child(1) {
        transform: translateY(8.5px) rotate(45deg);
    }

    .hamburger.open span:nth-child(2) {
        opacity: 0;
    }

    .hamburger.open span:nth-child(3) {
        transform: translateY(-8.5px) rotate(-45deg);
    }

    /* Mobile Navigation */
    .mobile-nav {
        position: fixed;
        top: 4.5rem;
        left: 50%;
        transform: translateX(-50%);
        width: 90%;
        max-width: 400px;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: 1rem;
        z-index: 99;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(100, 116, 139, 0.1);
    }

    .mobile-nav-links {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .mobile-nav-links li a {
        color: white;
        text-decoration: none;
        font-weight: 500;
        padding: 0.75rem;
        display: block;
        border-radius: 8px;
        transition: all 0.2s ease;
    }

    .mobile-nav-links li a:hover {
        background-color: rgba(100, 116, 139, 0.1);
        box-shadow: 0 0 15px rgba(100, 116, 139, 0.1);
    }

    .mobile-nav-links li.active a {
        background-color: rgba(100, 116, 139, 0.2);
        color: slate;
        box-shadow: 0 0 15px rgba(100, 116, 139, 0.2);
    }

    /* Bottom Sections */
    .bottom-left, .bottom-right {
        position: fixed;
        bottom: 1rem;
        display: flex;
        gap: 0.5rem;
        z-index: 10;
    }

    .bottom-left {
        left: 1rem;
    }

    .bottom-right {
        right: 1rem;
        align-items: center;
        gap: 0.5rem;
        background: rgba(0, 0, 0, 0.2);
        padding: 0.5rem 0.75rem;
        border-radius: 8px;
        font-size: 0.875rem;
    }

    .discord-button, .github-button {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.2);
        color: inherit;
        transition: all 0.2s ease;
    }

    .discord-button:hover, .github-button:hover {
        background: rgba(255, 255, 255, 0.1);
        transform: translateY(-2px);
    }

    /* Responsive Adjustments */
    @media (max-width: 1024px) {
        .navbar-content {
            padding: 0.4rem;
        }
        
        .nav-links {
            gap: 0.5rem;
        }
        
        .user-info {
            display: none;
        }
        
        .user-section {
            padding: 0.25rem;
            gap: 0.35rem;
        }
    }
    
    @media (max-width: 768px) {
        .navbar-content {
            gap: 0.25rem;
            justify-content: space-between;
        }
        
        .logo-text {
            font-size: 1.35rem;
        }
        
        .user-section {
            background: transparent;
            padding: 0.25rem;
            gap: 0;
            margin-left: auto; 
            order: 2; 
            display: flex;
            align-items: center;
        }
        
        .wallet-button {
            background: rgba(100, 116, 139, 0.25);
            padding: 0.35rem;
            margin-right: 0.5rem;
            display: flex;
        }
        
        /* Hide theme toggle on smaller screens */
        .theme-toggle {
            display: none;
        }

        /* Position mobile menu button at the extreme right */
        .mobile-menu-button {
            margin-left: 0;
            order: 3; /* Always at the end */
        }
    }

    /* Additional responsive styles for the navbar */
    @media (max-width: 1024px) {
        .navbar-content {
            padding: 0.25rem;
        }
        
        .logo-container {
            padding: 0.25rem 0.25rem;
            margin-right: 0.5rem;
        }
    }

    /* Added better wrapping for the user section elements */
    .user-section, .theme-toggle, .wallet-button {
        display: flex;
        align-items: center;
    }
</style>