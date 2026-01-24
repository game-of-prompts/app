
import { detectExplorerSuffixes, web_explorer_suffixes } from './src/lib/ergo/envs';
import { get } from 'svelte/store';

async function test() {
    console.log("Testing SigmaSpace (Singular)...");
    await detectExplorerSuffixes("https://sigmaspace.io/en/");
    console.log("Suffixes:", get(web_explorer_suffixes));

    console.log("\nTesting ErgoPlatform Testnet (Plural)...");
    await detectExplorerSuffixes("https://testnet.ergoplatform.com/");
    console.log("Suffixes:", get(web_explorer_suffixes));
}

// Since this is a Svelte project, I might need to run this in a way that handles imports.
// But I can just check the logic manually or use a simplified version for testing.
console.log("Note: This script needs a Svelte environment to run. I will verify manually by checking the code logic.");
