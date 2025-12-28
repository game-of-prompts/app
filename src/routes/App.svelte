<script lang="ts">
    import { onMount } from "svelte";
    import {
        address,
        connected,
        balance,
        game_detail,
        timer,
        judge_detail,
        network,
    } from "$lib/common/store";
    import CreateGame from "./CreateGame.svelte";
    import TokenAcquisition from "./TokenAcquisition.svelte";
    import GameDetails from "./GameDetails.svelte";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { loadGameById } from "$lib/common/load_by_id";
    import { browser } from "$app/environment";
    import { page } from "$app/stores";
    import { type AnyGame as Game } from "$lib/common/game";
    import { network_id } from "$lib/ergo/envs";
    import Kya from "./kya.svelte";
    import Theme from "./Theme.svelte";
    import { get } from "svelte/store";
    import { slide } from "svelte/transition";
    import CreateJudge from "./CreateJudge.svelte";
    import { reputation_proof } from "$lib/common/store";
    import ShowJudge from "./ShowJudge.svelte";
    import {
        fetchReputationProofs,
        fetchAllProfiles,
    } from "$lib/ergo/reputation/fetch";
    import { type ReputationProof } from "ergo-reputation-system";
    import { total_burned } from "$lib/ergo/reputation/utils";
    import JudgeList from "./JudgeList.svelte";
    import {
        WalletButton,
        WalletAddressChangeHandler,
        walletConnected,
        walletAddress,
        walletBalance,
        walletManager,
    } from "wallet-svelte-component";
    import { Settings, Menu, X, Wallet } from "lucide-svelte";
    import SettingsModal from "./SettingsModal.svelte";
    import {
        explorer_uri,
        web_explorer_uri_tx,
        web_explorer_uri_addr,
        web_explorer_uri_tkn,
    } from "$lib/ergo/envs";
    import { Button } from "$lib/components/ui/button";
    import { fetchTypeNfts } from "$lib/ergo/reputation/fetch";

    // Sync stores
    $: connected.set($walletConnected);
    $: address.set($walletAddress);
    $: balance.set(
        $walletBalance?.nanoErgs ? Number($walletBalance.nanoErgs) : 0,
    );

    let activeTab = "participateGame";
    let showCopyMessage = false;
    let showWalletInfo = false;
    let mobileMenuOpen = false;
    let showSettings = false;

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

    onMount(() => {
        if (!browser) return;

        network.set(network_id == "mainnet" ? "ergo-mainnet" : "ergo-testnet");

        const gameToken = $page.url.searchParams.get("game");
        if (gameToken) {
            loadGameById(gameToken);
        }

        getCurrentHeight();
        balanceUpdateInterval = window.setInterval(updateWalletInfo, 30000);

        scrollingTextElement?.addEventListener(
            "animationiteration",
            handleAnimationIteration,
        );

        // Load settings
        const storedSettings = localStorage.getItem("gop_settings");
        if (storedSettings) {
            try {
                const settings = JSON.parse(storedSettings);
                if (settings.explorer_uri)
                    explorer_uri.set(settings.explorer_uri);
                if (settings.web_explorer_uri_tx)
                    web_explorer_uri_tx.set(settings.web_explorer_uri_tx);
                if (settings.web_explorer_uri_addr)
                    web_explorer_uri_addr.set(settings.web_explorer_uri_addr);
                if (settings.web_explorer_uri_tkn)
                    web_explorer_uri_tkn.set(settings.web_explorer_uri_tkn);
            } catch (e) {
                console.error("Error loading settings:", e);
            }
        }

        const unsubscribeSettings = [
            explorer_uri,
            web_explorer_uri_tx,
            web_explorer_uri_addr,
            web_explorer_uri_tkn,
        ].map((store) =>
            store.subscribe(() => {
                if (browser) {
                    const settings = {
                        explorer_uri: get(explorer_uri),
                        web_explorer_uri_tx: get(web_explorer_uri_tx),
                        web_explorer_uri_addr: get(web_explorer_uri_addr),
                        web_explorer_uri_tkn: get(web_explorer_uri_tkn),
                    };
                    localStorage.setItem(
                        "gop_settings",
                        JSON.stringify(settings),
                    );
                }
            }),
        );

        return () => {
            if (balanceUpdateInterval) clearInterval(balanceUpdateInterval);
            scrollingTextElement?.removeEventListener(
                "animationiteration",
                handleAnimationIteration,
            );
            unsubscribeSettings.forEach((unsub) => unsub());
        };
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
    });

    judge_detail.subscribe((value) => {
        if (value) {
            activeTab = "judges";
        }
    });

    async function updateWalletInfo() {
        try {
            await walletManager.refreshBalance();
            current_height = await platform.get_current_height();

            const proofs = await fetchReputationProofs(
                (window as any).ergo,
                false,
                "judge",
                null,
            );

            if (proofs.size > 0) {
                const types = await fetchTypeNfts();
                const profiles = await fetchAllProfiles(
                    get(explorer_uri),
                    get(address),
                    [],
                    types,
                );
                if (profiles.length > 0) {
                    reputation_proof.set(profiles[0]);
                }
            }
        } catch (error) {
            console.error("Error updating wallet info:", error);
        }
    }

    async function getCurrentHeight() {
        try {
            current_height = await platform.get_current_height();
        } catch (error) {
            console.error("Error fetching current height:", error);
        }
    }

    async function changeUrl(game: Game | null) {
        if (typeof window === "undefined") return;
        const url = new URL(window.location.href);
        if (game !== null) {
            url.searchParams.set("game", game.gameId);
        } else {
            url.searchParams.delete("game");
        }
        window.history.pushState({}, "", url);
    }

    $: changeUrl($game_detail);
</script>

<header class="navbar-container">
    <div class="navbar-content">
        <a
            href="#"
            on:click|preventDefault={() => changeTab("participateGame")}
            class="logo-container hidden md:flex"
        >
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
                <li class:active={activeTab === "participateGame"}>
                    <a
                        href="#"
                        on:click|preventDefault={() =>
                            changeTab("participateGame")}>Competitions</a
                    >
                </li>
                <li class:active={activeTab === "createGame"}>
                    <a
                        href="#"
                        on:click|preventDefault={() => changeTab("createGame")}
                        >Create Competition</a
                    >
                </li>
                <li class:active={activeTab === "judges"}>
                    <a
                        href="#"
                        on:click|preventDefault={() => changeTab("judges")}
                        >Judges</a
                    >
                </li>
                {#if !$reputation_proof}
                    <li class:active={activeTab === "createJudge"}>
                        <a
                            href="#"
                            on:click|preventDefault={() =>
                                changeTab("createJudge")}>Become a Judge</a
                        >
                    </li>
                {:else}
                    <li class:active={activeTab === "showJudge"}>
                        <a
                            href="#"
                            on:click|preventDefault={() =>
                                changeTab("showJudge")}>My reputation</a
                        >
                    </li>
                {/if}
            </ul>
        </nav>

        <div class="user-section hidden md:flex">
            <WalletButton />
            <div class="theme-toggle">
                <Theme />
            </div>
            <Button
                variant="ghost"
                size="icon"
                on:click={() => (showSettings = true)}
            >
                <Settings class="h-[1.2rem] w-[1.2rem]" />
            </Button>
        </div>

        <button
            class="mobile-menu-button"
            on:click={() => (mobileMenuOpen = !mobileMenuOpen)}
            aria-label="Toggle menu"
        >
            {#if mobileMenuOpen}
                <X class="h-6 w-6" />
            {:else}
                <Menu class="h-6 w-6" />
            {/if}
        </button>
    </div>
</header>

{#if mobileMenuOpen}
    <div class="mobile-nav" transition:slide={{ duration: 200 }}>
        <ul class="mobile-nav-links">
            <li class:active={activeTab === "participateGame"}>
                <a
                    href="#"
                    on:click|preventDefault={() => changeTab("participateGame")}
                    >Competitions</a
                >
            </li>
            <li class:active={activeTab === "createGame"}>
                <a
                    href="#"
                    on:click|preventDefault={() => changeTab("createGame")}
                    >Create Competition</a
                >
            </li>
            <li class:active={activeTab === "judges"}>
                <a href="#" on:click|preventDefault={() => changeTab("judges")}
                    >Judges</a
                >
            </li>
            {#if !$reputation_proof}
                <li class:active={activeTab === "createJudge"}>
                    <a
                        href="#"
                        on:click|preventDefault={() => changeTab("createJudge")}
                        >Become a Judge</a
                    >
                </li>
            {:else}
                <li class:active={activeTab === "showJudge"}>
                    <a
                        href="#"
                        on:click|preventDefault={() => changeTab("showJudge")}
                        >My reputation</a
                    >
                </li>
            {/if}
        </ul>

        <div class="my-4 border-t border-border"></div>

        <div class="mobile-user-controls">
            <div class="flex items-center justify-between mb-4">
                <span class="text-sm font-medium text-muted-foreground"
                    >Theme & Settings</span
                >
                <div class="flex gap-2">
                    <Theme />
                    <Button
                        variant="ghost"
                        size="icon"
                        on:click={() => {
                            showSettings = true;
                            mobileMenuOpen = false;
                        }}
                    >
                        <Settings class="h-5 w-5" />
                    </Button>
                </div>
            </div>

            <div class="w-full flex justify-center">
                <WalletButton />
            </div>
        </div>
    </div>
{/if}

<main class="pb-16">
    {#if $game_detail === null && $judge_detail == null}
        {#if activeTab === "participateGame"}
            <TokenAcquisition />
        {/if}
        {#if activeTab === "createGame"}
            <CreateGame />
        {/if}
        {#if activeTab === "judges"}
            <JudgeList />
        {/if}
        {#if activeTab === "createJudge"}
            <CreateJudge />
        {/if}
        {#if activeTab === "showJudge"}
            <ShowJudge />
        {/if}
    {:else if $game_detail !== null}
        <GameDetails />
    {:else}
        <ShowJudge />
    {/if}
</main>

{#if showSettings}
    <SettingsModal on:close={() => (showSettings = false)} />
{/if}

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
        <svg
            width="14"
            height="14"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            ><path
                d="M0.502 2.999L6 0L11.495 3.03L6.0025 5.96L0.502 2.999V2.999ZM6.5 6.8365V12L11.5 9.319V4.156L6.5 6.8365V6.8365ZM5.5 6.8365L0.5 4.131V9.319L5.5 12V6.8365Z"
                fill="currentColor"
            ></path></svg
        >
        {#if current_height}
            <span>{current_height}</span>
        {/if}
    </div>
</footer>

<WalletAddressChangeHandler />

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
        @apply justify-end md:justify-start;
    }

    .logo-container {
        @apply mr-6 flex items-center;
    }

    .logo-image {
        height: 2rem;
        width: auto;
        margin-right: 5rem;
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
        @apply items-center gap-4;
    }

    .mobile-menu-button {
        @apply md:hidden p-2 rounded-md hover:bg-accent hover:text-accent-foreground;
    }

    .mobile-nav {
        @apply md:hidden fixed left-0 right-0 z-40 border-b shadow-lg flex flex-col;
        top: 4rem;
        background-color: hsl(var(--background));
        border-bottom-color: hsl(var(--border));
        max-height: calc(100vh - 4rem);
        overflow-y: auto;
    }

    .mobile-nav-links {
        @apply flex flex-col p-4 space-y-4;
    }

    .mobile-nav-links li a {
        @apply block text-base font-medium transition-colors hover:text-primary;
    }

    .mobile-nav-links li.active a {
        @apply text-primary font-bold;
    }

    .mobile-user-controls {
        @apply p-4 bg-accent/10;
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
        -webkit-mask-image: linear-gradient(
            to right,
            transparent,
            black 10%,
            black 90%,
            transparent
        );
        mask-image: linear-gradient(
            to right,
            transparent,
            black 10%,
            black 90%,
            transparent
        );
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
