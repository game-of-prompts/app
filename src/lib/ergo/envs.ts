
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

export async function detectExplorerSuffixes(baseUrl: string): Promise<boolean> {
    const mockData = {
        token: "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12",
        address: "9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T",
        transaction: "843a5c85ed0f0cf6a936e48eb9d1de0771092ebb7ca54eba0bf95fb13827812b"
    };

    const check = async (path: string) => {
        try {
            const response = await fetch(baseUrl + path, { method: 'HEAD' });
            return response.ok;
        } catch (e) {
            return false;
        }
    };

    let tx = "transaction/";
    let addr = "address/";
    let tkn = "token/";
    let valid = false;

    if (await check(tx + mockData.transaction)) {
        valid = true;
    } else if (await check("transactions/" + mockData.transaction)) {
        tx = "transactions/";
        valid = true;
    }

    if (await check(addr + mockData.address)) {
        valid = true;
    } else if (await check("addresses/" + mockData.address)) {
        addr = "addresses/";
        valid = true;
    }

    if (await check(tkn + mockData.token)) {
        valid = true;
    } else if (await check("tokens/" + mockData.token)) {
        tkn = "tokens/";
        valid = true;
    }

    web_explorer_suffixes.set({ tx, addr, tkn });
    return valid;
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