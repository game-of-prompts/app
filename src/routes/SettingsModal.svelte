<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import {
        explorer_uri,
        web_explorer_uri_tx,
        web_explorer_uri_addr,
        web_explorer_uri_tkn,
        default_explorer_uri,
        default_web_explorer_uri_tx,
        default_web_explorer_uri_addr,
        default_web_explorer_uri_tkn,
    } from "$lib/ergo/envs";
    import { X, RotateCcw } from "lucide-svelte";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    function close() {
        dispatch("close");
    }

    function restoreDefaults() {
        explorer_uri.set(default_explorer_uri);
        web_explorer_uri_tx.set(default_web_explorer_uri_tx);
        web_explorer_uri_addr.set(default_web_explorer_uri_addr);
        web_explorer_uri_tkn.set(default_web_explorer_uri_tkn);
    }
</script>

<div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    on:click|self={close}
    role="dialog"
    aria-modal="true"
>
    <div
        class="bg-background border border-border rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200"
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
                    <Label for="web_explorer_uri_tx"
                        >Web Explorer Transaction URI</Label
                    >
                    <Input
                        id="web_explorer_uri_tx"
                        bind:value={$web_explorer_uri_tx}
                        placeholder="https://sigmaspace.io/en/transaction/"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="web_explorer_uri_addr"
                        >Web Explorer Address URI</Label
                    >
                    <Input
                        id="web_explorer_uri_addr"
                        bind:value={$web_explorer_uri_addr}
                        placeholder="https://sigmaspace.io/en/address/"
                    />
                </div>

                <div class="space-y-2">
                    <Label for="web_explorer_uri_tkn"
                        >Web Explorer Token URI</Label
                    >
                    <Input
                        id="web_explorer_uri_tkn"
                        bind:value={$web_explorer_uri_tkn}
                        placeholder="https://sigmaspace.io/en/token/"
                    />
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
                <Button on:click={close}>Done</Button>
            </div>
        </div>
    </div>
</div>
