<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { web_explorer_uri, detectExplorerSuffixes } from "$lib/ergo/envs";
    import { createEventDispatcher } from "svelte";
    import { AlertTriangle, Loader2 } from "lucide-svelte";

    const dispatch = createEventDispatcher();

    let newUri = "";
    let isChecking = false;
    let errorMessage = "";

    async function handleSave() {
        if (!newUri) {
            errorMessage = "Please enter a URL.";
            return;
        }

        // Ensure trailing slash for consistency if user forgets it,
        // though detection logic might handle it, it's safer to standardize.
        if (!newUri.endsWith("/")) {
            newUri += "/";
        }

        isChecking = true;
        errorMessage = "";

        const isValid = await detectExplorerSuffixes(newUri);
        isChecking = false;

        if (isValid) {
            web_explorer_uri.set(newUri);
            dispatch("close");
        } else {
            errorMessage =
                "The URL seems invalid or unreachable. Please try another one.";
        }
    }
</script>

<div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
>
    <div
        class="bg-background border border-destructive/50 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"
    >
        <div class="p-6 space-y-6">
            <div class="flex flex-col items-center text-center space-y-2">
                <div class="p-3 bg-destructive/10 rounded-full">
                    <AlertTriangle class="h-8 w-8 text-destructive" />
                </div>
                <h2 class="text-xl font-semibold text-destructive">
                    Invalid Explorer Configuration
                </h2>
                <p class="text-sm text-muted-foreground">
                    The configured Web Explorer URL is not working correctly.
                    We've removed the invalid configuration. Please provide a
                    valid one to continue.
                </p>
            </div>

            <div class="space-y-4">
                <div class="space-y-2">
                    <Label for="new-explorer-uri">New Web Explorer URI</Label>
                    <Input
                        id="new-explorer-uri"
                        bind:value={newUri}
                        placeholder="https://sigmaspace.io/en/"
                        class={errorMessage ? "border-destructive" : ""}
                    />
                    {#if errorMessage}
                        <p class="text-xs text-destructive">{errorMessage}</p>
                    {/if}
                </div>

                <Button
                    class="w-full"
                    on:click={handleSave}
                    disabled={isChecking}
                >
                    {#if isChecking}
                        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                    {:else}
                        Save and Continue
                    {/if}
                </Button>
            </div>
        </div>
    </div>
</div>
