import { get } from "svelte/store";
import { types, judges } from "$lib/common/store";
import { explorer_uri, CACHE_DURATION_MS } from "$lib/ergo/envs";
import {
    fetchTypeNfts as libFetchTypeNfts,
    searchBoxes,
    type ReputationProof,
    type TypeNFT,
    type RPBox,
    fetchAllProfiles
} from "reputation-system";
import { JUDGE } from "./types";

export async function fetchTypeNfts(force: boolean = false): Promise<Map<string, TypeNFT>> {
    try {
        if (!force && (Date.now() - get(types).last_fetch < CACHE_DURATION_MS)) {
            return get(types).data;
        }

        const typesMap = await libFetchTypeNfts(get(explorer_uri));

        types.set({ data: typesMap, last_fetch: Date.now() });
        return get(types).data;

    } catch (e: any) {
        console.error("Failed to fetch and store types:", e);
        types.set({ data: new Map(), last_fetch: 0 });
        return get(types).data;
    }
}

export async function fetchReputationProofByTokenId(tokenId: string): Promise<ReputationProof | null> {
    try {
        const availableTypes = await fetchTypeNfts();
        const profiles = await fetchAllProfiles(get(explorer_uri), true, [JUDGE], availableTypes);
        return profiles.find(p => p.token_id === tokenId) || null;
    } catch (error) {
        console.error(`Error fetching reputation proof for token ${tokenId}:`, error);
        return null;
    }
}

export async function fetchJudges(force: boolean = false): Promise<Map<string, ReputationProof>> {
    try {
        if (!force && (Date.now() - get(judges).last_fetch < CACHE_DURATION_MS)) {
            return get(judges).data;
        }

        const availableTypes = await fetchTypeNfts();
        const boxGenerator = searchBoxes(
            get(explorer_uri),
            undefined,
            JUDGE,
            undefined,  // object_pointer
            undefined,  // is_locked
            undefined,  // polarization
            undefined,  // content
            undefined,  // owner_ergotree
            undefined,  // limit
            undefined   // offset
        );

        const judgesMap = new Map<string, ReputationProof>();
        for await (const batch of boxGenerator) {
            for (const box of batch) {
                const tokenId = box.assets && box.assets.length > 0 ? box.assets[0].tokenId : null;
                if (tokenId) {
                    const profile = await fetchReputationProofByTokenId(tokenId, null);
                    if (profile) {
                        judgesMap.set(tokenId, profile);
                    }
                }
            }
        }

        judges.set({ data: judgesMap, last_fetch: Date.now() });
        return get(judges).data;
    } catch (e: any) {
        console.error("Failed to fetch and store judges:", e);
        judges.set({ data: new Map(), last_fetch: 0 });
        return get(judges).data;
    }
}

// Kept for compatibility if needed, but fetchJudges should be preferred
export async function fetchReputationProofs(
    ergo: any,
    all: boolean,
    type: "game" | "participation" | "judge",
    value: string | null
): Promise<Map<string, ReputationProof>> {
    if (type === "judge") {
        return fetchJudges();
    }

    console.warn("fetchReputationProofs called with type other than judge, which is not fully optimized yet.");
    return new Map();
}
export async function fetchOpinionsAbout(
    explorerUri: string,
    objectPointer: string,
    typeNftId?: string
): Promise<RPBox[]> {
    try {
        const boxGenerator = searchBoxes(
            explorerUri,
            undefined, // tokenId (issuer)
            typeNftId,
            objectPointer,
            undefined,
            undefined,
            undefined,
            undefined,
            100 // limit
        );

        const { value: boxes } = await boxGenerator.next();
        return boxes || [];
    } catch (e) {
        console.error("Error fetching opinions about:", e);
        return [];
    }
}
