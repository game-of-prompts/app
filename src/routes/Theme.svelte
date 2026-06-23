<script lang="ts">
    import Sun from "lucide-svelte/icons/sun";
    import Moon from "lucide-svelte/icons/moon";

    import { toggleMode } from "mode-watcher";
    import { Button } from "$lib/components/ui/button/index.js";

    // Single-click circular toggle (light <-> dark), following
    // StabilityNexus/BenefactionPlatform-Ergo PR #172. `toggleMode` flips the
    // active mode in one step; the wrapper spins 180deg per click so the
    // sun/moon swap reads as a rotation rather than a hard cut. The system
    // default is still respected until the user makes a first explicit choice.
    let rotationDeg = 0;

    function handleToggleClick() {
        toggleMode();
        rotationDeg += 180;
    }
</script>

<div class="theme-toggle-motion" style={`transform: rotate(${rotationDeg}deg);`}>
    <Button
        variant="outline"
        size="icon"
        class="rounded-full"
        on:click={handleToggleClick}
    >
        <Sun
            class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
        />
        <Moon
            class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
        />
        <span class="sr-only">Toggle theme</span>
    </Button>
</div>

<style>
    .theme-toggle-motion {
        display: inline-block;
        transition: transform 700ms ease;
    }
</style>
