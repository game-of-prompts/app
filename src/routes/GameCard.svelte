<script lang="ts">
    import { block_to_time_remaining, block_height_to_timestamp } from "$lib/common/countdown";
    import { game_detail } from "$lib/common/store";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import { onMount, onDestroy } from "svelte";
    import { 
        isGameParticipationEnded, 
        GameState, 
        type AnyGame as Game, 
        isOpenCeremony
    } from "$lib/common/game";
    import { fetch_token_details, fetchParticipations } from "$lib/ergo/fetch";
    import { formatTokenBigInt } from "$lib/utils";

    export let game: Game;
    export let index: number;
    export let opinionContent: string | undefined = undefined;
    export let isInvited: boolean | undefined = undefined;

    $: isEven = index % 2 === 0;

    let participationEnded = true;
    let deadlineTimestamp = 0;
    let remainingTime = "Loading...";
    let statusLabel = "Loading...";
    let statusClasses = "";
    let timer: ReturnType<typeof setInterval> | null = null;
    let initializedBoxId: string | null = null;
    let participations;

    let cardEl: HTMLElement | null = null;
    let scale = 1;
    const maxScale = 1.06;
    const activeRadiusFactor = 0.45;
    let rafId: number | null = null;
    let scheduled = false;

    let isActive = false;

    let tokenSymbol = "ERG";
    let tokenDecimals = 9;

    function scheduleUpdate() {
        if (scheduled) return;
        scheduled = true;
        rafId = requestAnimationFrame(() => {
            scheduled = false;
            updateScale();
        });
    }

    function updateScale() {
        if (!cardEl) return;
        const rect = cardEl.getBoundingClientRect();
        const elemCenterY = rect.top + rect.height / 2;
        const viewportCenterY = window.innerHeight / 2;
        const distance = Math.abs(elemCenterY - viewportCenterY);
        const activeRadius = window.innerHeight * activeRadiusFactor;
        const raw = Math.max(0, 1 - distance / activeRadius);
        const eased = Math.pow(raw, 2);
        scale = 1 + (maxScale - 1) * eased;
        checkIfCentered();
    }

    function onScrollOrResize() {
        scheduleUpdate();
    }

    function handleViewDetails() {
        if (game) {
            game_detail.set(game);
        }
    }

    function checkIfCentered() {
        if (!cardEl) return;
        const rect = cardEl.getBoundingClientRect();
        const cardCenterY = rect.top + rect.height / 2;
        const viewportCenterY = window.innerHeight / 2;
        const distance = Math.abs(cardCenterY - viewportCenterY);
        const threshold = window.innerHeight * 0.1;
        isActive = distance < threshold;
    }

    function handleKeyPress(e: KeyboardEvent) {
        if (e.key === "Enter" && isActive) {
            e.preventDefault();
            handleViewDetails();
        }
    }

    onMount(() => {
        updateScale();
        window.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        window.addEventListener("keydown", handleKeyPress);
        const ro = new ResizeObserver(() => scheduleUpdate());
        if (cardEl) ro.observe(cardEl);
        return () => {
            window.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
            window.removeEventListener("keydown", handleKeyPress);
            ro.disconnect();
            if (rafId) cancelAnimationFrame(rafId);
        };
    });

    onDestroy(() => {
        if (rafId) cancelAnimationFrame(rafId);
    });

    function formatErg(nano: bigint | number): string {
        const erg = Number(nano) / 1e9;
        return erg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }

    async function updateStatus() {
        if (!game) return;
        switch (game.status) {
            case GameState.Active:
                if (participationEnded) {
                    statusLabel = "Awaiting Results";
                    statusClasses = "bg-amber-500/15 text-amber-400 border border-amber-500/30";
                } else if (await isOpenCeremony(game)) {
                    statusLabel = "Collaborate to randomness";
                    statusClasses = "bg-purple-500/15 text-purple-400 border border-purple-500/30";
                } else {
                    statusLabel = `Play for ${formatTokenBigInt(game.participationFeeAmount, tokenDecimals)} ${tokenSymbol}`;
                    statusClasses = "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
                }
                break;
            case GameState.Resolution:
                statusLabel = "Judging in Progress";
                statusClasses = "bg-lime-500/15 text-lime-400 border border-lime-500/30";
                break;
            case GameState.Cancelled_Draining:
                statusLabel = "Cancelled";
                statusClasses = "bg-red-500/15 text-red-400 border border-red-500/30";
                break;
            case GameState.Finalized:
                statusLabel = "Finalized";
                statusClasses = "bg-gray-500/15 text-gray-400 border border-black-500/30";
                break;
            default:
                statusLabel = "Unknown";
                statusClasses = "bg-gray-500/15 text-gray-400 border border-gray-500/30";
        }
    }

    async function tick() {
        if (!game || game.status !== GameState.Active || participationEnded) {
            cleanup();
            return;
        }
        try {
            remainingTime = await block_to_time_remaining(game.deadlineBlock, game.platform);
            const ended = await isGameParticipationEnded(game);
            if (ended) {
                participationEnded = true;
                cleanup();
                await updateStatus();
            }
        } catch {
            remainingTime = "Error";
            cleanup();
        }
    }

    function cleanup() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    async function initialize() {
        if (!game || !game.platform || initializedBoxId === game.boxId) return;
        initializedBoxId = game.boxId;
        cleanup();

        if (game.participationTokenId) {
            try {
                const tokenDetails = await fetch_token_details(game.participationTokenId);
                if (tokenDetails?.name) tokenSymbol = tokenDetails.name;
                if (typeof tokenDetails?.decimals === "number") tokenDecimals = tokenDetails.decimals;
            } catch {
                tokenSymbol = "ERG";
                tokenDecimals = 9;
            }
        } else {
            tokenSymbol = "ERG";
            tokenDecimals = 9;
        }

        participationEnded = await isGameParticipationEnded(game);
        if (game.status === GameState.Active || game.status === GameState.Resolution) {
            deadlineTimestamp = await block_height_to_timestamp(
                game.status === GameState.Active ? game.deadlineBlock : game.deadlineBlock,
                game.platform
            );
        }
        await updateStatus();
        if (game.status === GameState.Active && !participationEnded) {
            await tick();
            if (!participationEnded) timer = setInterval(tick, 30000);
        }

        participations = await fetchParticipations(game);
    }

    $: if (game?.boxId && game.boxId !== initializedBoxId) initialize();
    onMount(() => game && initialize());
    onDestroy(cleanup);
</script>

<div
    bind:this={cardEl}
    class="group relative overflow-hidden rounded-2xl bg-card border border-border/50 shadow-lg transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 will-change-transform {isActive ? 'game-card-active' : ''}"
    style="transform-origin:center center; transform: translateZ(0) scale({scale});"
>
    <div class="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    
    <div class="flex flex-col lg:flex-row {isEven ? 'lg:flex-row-reverse' : ''} gap-0">
        <div class="relative w-full lg:w-2/5 aspect-video lg:aspect-auto overflow-hidden bg-muted/50">
            {#if game.content?.imageURL}
                <img 
                    src={game.content.imageURL} 
                    alt={game.content.title}
                    class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            {:else}
                <div class="flex items-center justify-center h-full">
                    <div class="text-6xl font-bold text-muted/20">{game.gameId.slice(0, 4)}</div>
                </div>
            {/if}
        </div>

        <div class="flex-1 p-6 lg:p-8 flex flex-col justify-between">
            <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-2">
                        {#if isInvited}
                            <Badge variant="outline" class="text-xs font-medium border-primary/30 text-primary">
                                Invited Judge
                            </Badge>
                        {/if}
                        <Badge variant="secondary" class="text-xs">
                            {participations?.length ?? "n/a"} Players
                        </Badge>
                    </div>
                    <div class="px-3 py-1 rounded-full text-xs font-semibold {statusClasses}">
                        {statusLabel}
                    </div>
                </div>

                <div>
                    <h3 class="text-2xl lg:text-3xl font-bold text-foreground tracking-tight line-clamp-2">
                        {game.content?.title || 'Untitled Game'}
                    </h3>
                    <p class="mt-2 text-sm text-muted-foreground line-clamp-3">
                        {game.content?.description || 'No description available.'}
                    </p>
                </div>

                {#if opinionContent}
                    <blockquote class="border-l-4 border-primary/30 pl-4 italic text-sm text-muted-foreground">
                        "{opinionContent}"
                    </blockquote>
                {/if}
            </div>

            <div class="mt-6 space-y-4">
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <div class="text-muted-foreground uppercase tracking-wider text-xs">Game ID</div>
                        <code class="font-mono text-xs text-primary/80 font-medium mt-1 block truncate">
                            {game.gameId.slice(0, 8)}...{game.gameId.slice(-6)}
                        </code>
                    </div>
                    <div>
                        <div class="text-muted-foreground uppercase tracking-wider text-xs">Prize Pool</div>
                        <div class="font-bold text-foreground mt-1">
                            {formatErg(game.value)} ERG
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
                    <div class="space-y-1">
                        <div class="text-xs uppercase text-muted-foreground tracking-wider">
                            {game.status === GameState.Active && !participationEnded ? 'Closes in' : 'Status Update'}
                        </div>
                        <div class="text-base font-semibold text-foreground">
                            {game.status === GameState.Active && !participationEnded ? remainingTime : statusLabel}
                        </div>
                        {#if deadlineTimestamp && (game.status === GameState.Resolution || participationEnded)}
                            <div class="text-xs text-muted-foreground">
                                Deadline: {new Date(deadlineTimestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                        {/if}
                    </div>

                    <Button
                        size="lg"
                        class="w-full sm:w-auto transition-all duration-200 hover:scale-[1.03] bg-slate-600 hover:bg-slate-700 text-white dark:bg-slate-300 dark:hover:bg-slate-200 dark:text-slate-900 font-semibold"
                        on:click={handleViewDetails}
                        disabled={!game}
                    >
                        View Details
                    </Button>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    .will-change-transform {
        transition: transform 260ms cubic-bezier(.22,.9,.27,1), box-shadow 260ms;
    }

    [style*="scale(1.0"]:not([style*="scale(1)"]) {
        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
    }

    .game-card-active {
        outline: 2px solid var(--color-primary);
        outline-offset: 4px;
    }
</style>
