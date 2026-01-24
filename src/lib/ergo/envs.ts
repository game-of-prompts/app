
import { writable, derived } from 'svelte/store';

export const default_explorer_uri = "https://api.ergoplatform.com";
export const default_web_explorer_uri = "https://explorer.ergoplatform.com/";

export const explorer_uri = writable<string>(default_explorer_uri);
export const web_explorer_uri = writable<string>(default_web_explorer_uri);

export const web_explorer_suffixes = writable<{ tx: string, addr: string, tkn: string }>({
    tx: "transaction/",
    addr: "address/",
    tkn: "token/"
});

export const web_explorer_uri_tx = derived([web_explorer_uri, web_explorer_suffixes], ([$uri, $suffixes]) => $uri + $suffixes.tx);
export const web_explorer_uri_addr = derived([web_explorer_uri, web_explorer_suffixes], ([$uri, $suffixes]) => $uri + $suffixes.addr);
export const web_explorer_uri_tkn = derived([web_explorer_uri, web_explorer_suffixes], ([$uri, $suffixes]) => $uri + $suffixes.tkn);

export async function detectExplorerSuffixes(baseUrl: string): Promise<{ isValid: boolean, logs: string[] }> {
    const mockData = {
        token: "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12",
        address: "9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T",
        transaction: "843a5c85ed0f0cf6a936e48eb9d1de0771092ebb7ca54eba0bf95fb13827812b"
    };

    const logs: string[] = [];
    const check = async (path: string) => {
        const url = baseUrl + path;
        try {
            const response = await fetch(url, { method: 'GET', mode: 'no-cors' });
            if (response.ok || response.type === 'opaque') {
                logs.push(`✅ ${url} is reachable.`);
                return true;
            } else {
                logs.push(`❌ ${url} returned status ${response.status}.`);
                return false;
            }
        } catch (e) {
            logs.push(`❌ ${url} failed to load (Network Error).`);
            return false;
        }
    };

    // Check Transactions
    let tx = "transaction/";
    let txFound = false;
    if (await check(tx + mockData.transaction)) {
        txFound = true;
    } else if (await check("transactions/" + mockData.transaction)) {
        tx = "transactions/";
        txFound = true;
    } else {
        // Try to check the other one just for logging purposes if the first one failed
        // The previous logic was if/else if, so if the first one worked, the second wasn't checked.
        // The user wants to know what worked and what didn't.
        // But for setting the suffix, we just need one to work.
        // Let's check both if the first fails, or maybe check both anyway?
        // "Por ejemplo: ... no ha funcionado ... si, etc ..." implies checking alternatives.
        // If I check "transaction/" and it works, I might not need to check "transactions/", but for the user report it might be nice.
        // However, strictly speaking, we just need to find A working one.
        // Let's stick to: check singular. If fail, check plural.
        // If singular worked, we are good.
        // Wait, the user said: "algunas veces van en plural y otras en singular,asi que la idea es que se prueben ambos"
        // "si alguno de los tres tipos de elementos no van ni en singular ni en plural debemos de considerar que el web explorer es invalido"
    }

    // To be thorough and provide the requested feedback "tested X and Y", let's check both if the first fails,
    // or maybe we should just check the one we are going to use?
    // If I check "transaction/" and it fails, I check "transactions/".
    // If "transaction/" works, I don't *need* to check "transactions/", but the user example shows a failure then a success.
    // So the current logic of `if (singular) ... else if (plural)` is mostly fine, but we need to ensure we capture the failure of singular if we fall back to plural.
    // My `check` function logs the result, so that's covered.

    // Check Addresses
    let addr = "address/";
    let addrFound = false;
    if (await check(addr + mockData.address)) {
        addrFound = true;
    } else if (await check("addresses/" + mockData.address)) {
        addr = "addresses/";
        addrFound = true;
    }

    // Check Tokens
    let tkn = "token/";
    let tknFound = false;
    if (await check(tkn + mockData.token)) {
        tknFound = true;
    } else if (await check("tokens/" + mockData.token)) {
        tkn = "tokens/";
        tknFound = true;
    }

    const isValid = txFound && addrFound && tknFound;

    if (isValid) {
        web_explorer_suffixes.set({ tx, addr, tkn });
    }

    return { isValid, logs };
}
export const default_source_explorer_url = "https://reputation-systems.github.io/source-application";
export const source_explorer_url = writable<string>(default_source_explorer_url);
export const default_forum_explorer_url = "https://reputation-systems.github.io/forum-application";
export const forum_explorer_url = writable<string>(default_forum_explorer_url);
export const REPUTATION_PROOF_TOTAL_SUPPLY = 100_000_000;
export const CACHE_DURATION_MS = 10000; // 10 seconds
export const isDevMode = writable<boolean>(false);

/**
 * Controls whether chained transactions are used.
 * Currently disabled due to: https://github.com/game-of-prompts/app/issues/2
 * Affects:
 * - end_game_chained.ts (handleEndGame)
 * - judges_invalidation_chained.ts (judgesInvalidate)
 */
export const USE_CHAINED_TRANSACTIONS = false;

/**
 * Controls whether web explorer URL validation is performed.
 * Set to false to disable:
 * - Validation on app startup
 * - The "Detect" button in settings
 * - The InvalidExplorerModal popup
 */
export const VALIDATE_WEB_EXPLORER = false;