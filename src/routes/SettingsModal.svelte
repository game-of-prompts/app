<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import {
        explorer_uri,
        web_explorer_uri,
        default_explorer_uri,
        default_web_explorer_uri,
        detectExplorerSuffixes,
        source_explorer_url,
        default_source_explorer_url,
        forum_explorer_url,
        default_forum_explorer_url,
        isDevMode,
    } from "$lib/ergo/envs";
    import { fetchGoPGames } from "$lib/ergo/fetch";
    import { isLoadingGames } from "$lib/common/store";
    import { Checkbox } from "$lib/components/ui/checkbox";
    import { X, RotateCcw, Loader2 } from "lucide-svelte";
    import { createEventDispatcher } from "svelte";
    import { user_volume } from "$lib/common/store";

    const dispatch = createEventDispatcher();

    function close() {
        dispatch("close");
    }

    function restoreDefaults() {
        explorer_uri.set(default_explorer_uri);
        web_explorer_uri.set(default_web_explorer_uri);
        source_explorer_url.set(default_source_explorer_url);
        forum_explorer_url.set(default_forum_explorer_url);
    }

    let previousDevMode = $isDevMode;
    $: if ($isDevMode !== previousDevMode) {
        previousDevMode = $isDevMode;
        fetchGoPGames(true);
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    on:click|self={close}
    role="dialog"
    aria-modal="true"
>
    <div
        class="bg-background border border-border rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
    >
        <div
            class="flex items-center justify-between p-6 border-b border-border"
        >
            <h2 class="text-xl font-semibold">Settings</h2>
            <Button variant="ghost" size="icon" on:click={close}>
                <X class="h-5 w-5" />
            </Button>
        </div>

        <div class="p-6 space-y-6">
            <div class="space-y-4">
                <div class="space-y-2">
                    <Label for="explorer_uri">Explorer API URI</Label>
                    <Input
                        id="explorer_uri"
                        bind:value={$explorer_uri}
                        placeholder="https://api.ergoplatform.com"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="web_explorer_uri">Web Explorer URI</Label>
                    <div class="flex gap-2">
                        <Input
                            id="web_explorer_uri"
                            bind:value={$web_explorer_uri}
                            placeholder="https://sigmaspace.io/en/"
                        />
                        <Button
                            class="hidden"
                            variant="outline"
                            on:click={async () => {
                                const result =
                                    await detectExplorerSuffixes(
                                        $web_explorer_uri,
                                    );
                                if (result.isValid) {
                                    alert(
                                        "Explorer configuration detected successfully!",
                                    );
                                } else {
                                    alert(
                                        "Warning: Could not detect valid explorer endpoints. Please check the URI.",
                                    );
                                }
                            }}
                            title="Detect singular/plural suffixes"
                        >
                            Detect
                        </Button>
                    </div>
                </div>

                <div class="space-y-2">
                    <Label for="source_explorer_url">Source Explorer URL</Label>
                    <Input
                        id="source_explorer_url"
                        bind:value={$source_explorer_url}
                        placeholder="https://reputation-systems.github.io/source-application"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="forum_explorer_url">Forum Explorer URL</Label>
                    <Input
                        id="forum_explorer_url"
                        bind:value={$forum_explorer_url}
                        placeholder="https://reputation-systems.github.io/forum-application"
                    />
                </div>

                <div
                    class="flex items-center space-x-2 pt-4 border-t border-border"
                >
                    <Checkbox
                        id="dev-mode"
                        bind:checked={$isDevMode}
                        disabled={$isLoadingGames}
                    />
                    <Label
                        for="dev-mode"
                        class="cursor-pointer flex items-center gap-2"
                    >
                        <div>
                            <span class="font-medium">Development Mode</span>
                            <span class="block text-xs text-muted-foreground">
                                Use shorter periods for testing (requires app
                                reload to take full effect on contracts)
                            </span>
                        </div>
                        {#if $isLoadingGames}
                            <Loader2
                                class="h-4 w-4 animate-spin text-muted-foreground"
                            />
                        {/if}
                    </Label>
                </div>

                <div class="space-y-2 pt-4 border-t border-border">
                    <Label>Audio Settings</Label>
                    <div class="space-y-2">
                        <label for="volume-slider" class="text-sm font-medium"
                            >Volume</label
                        >
                        <input
                            type="range"
                            id="volume-slider"
                            min="0"
                            max="1"
                            step="0.1"
                            bind:value={$user_volume}
                            class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                        />
                        <div
                            class="flex justify-between text-xs text-muted-foreground"
                        >
                            <span>0</span>
                            <span>1</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex justify-between pt-4 border-t border-border">
                <Button
                    variant="outline"
                    on:click={restoreDefaults}
                    class="text-muted-foreground hover:text-foreground"
                >
                    <RotateCcw class="mr-2 h-4 w-4" />
                    Restore Defaults
                </Button>
                <div hidden class="flex gap-2">
                    <Button
                        variant="ghost"
                        class="text-xs text-muted-foreground"
                        on:click={() => dispatch("openDemo")}
                    >
                        Demo Mode
                    </Button>
                    <Button on:click={close}>Done</Button>
                </div>
            </div>
        </div>
    </div>
</div>
