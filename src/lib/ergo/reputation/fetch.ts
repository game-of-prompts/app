import { Network, type RPBox, type ReputationProof, type TypeNFT } from "$lib/ergo/reputation/objects";
import { get } from "svelte/store";
import { types, judges } from "$lib/common/store";
import { explorer_uri, CACHE_DURATION_MS } from "$lib/ergo/envs";
import {
    fetchAllProfiles,
    fetchTypeNfts as libFetchTypeNfts,
    type ReputationProof as LibReputationProof,
    type TypeNFT as LibTypeNFT,
    type RPBox as LibRPBox
} from "ergo-reputation-system";
import { JUDGE } from "./types";

function mapLibTypeToLocalType(t: LibTypeNFT): TypeNFT {
    return {
        ...t,
        box: null
    };
}

function mapLibBoxToLocalBox(b: LibRPBox): RPBox {
    return {
        ...b,
        type: mapLibTypeToLocalType(b.type),
    };
}

export async function fetchTypeNfts(force: boolean = false): Promise<Map<string, TypeNFT>> {
    try {
        if (!force && (Date.now() - get(types).last_fetch < CACHE_DURATION_MS)) {
            return get(types).data;
        }

        const libTypes = await libFetchTypeNfts(get(explorer_uri));

        const typesMap = new Map<string, TypeNFT>();
        for (const [key, value] of libTypes.entries()) {
            typesMap.set(key, mapLibTypeToLocalType(value));
        }

        types.set({ data: typesMap, last_fetch: Date.now() });
        return get(types).data;

    } catch (e: any) {
        console.error("Failed to fetch and store types:", e);
        types.set({ data: new Map(), last_fetch: 0 });
        return get(types).data;
    }
}

function mapLibProofToLocalProof(proof: LibReputationProof): ReputationProof {
    return {
        ...proof,
        type: proof.types.length > 0 ? mapLibTypeToLocalType(proof.types[0]) : { tokenId: "", boxId: '', typeName: "Unknown", description: "", schemaURI: "", isRepProof: false, box: null }, // Map first type to single type
        current_boxes: proof.current_boxes.map(mapLibBoxToLocalBox),
        owner_ergotree: proof.owner_serialized,
        network: proof.network === "ergo" ? Network.ErgoMainnet : Network.ErgoTestnet
    };
}

export async function fetchReputationProofByTokenId(
    tokenId: string,
    ergo: any, // kept for compatibility but unused if using library
    options: { ignoreOwnerHashConflict?: boolean } = {}
): Promise<ReputationProof | null> {
    try {
        const availableTypes = await fetchTypeNfts();

        // Fetch all profiles and find the one with the matching token ID
        // This is inefficient but the library doesn't seem to support fetching a single profile by ID directly yet
        const profiles = await fetchAllProfiles(get(explorer_uri), null, [], availableTypes);

        const found = profiles.find(p => p.token_id === tokenId);

        if (found) {
            return mapLibProofToLocalProof(found);
        }
        return null;
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
        const profiles = await fetchAllProfiles(get(explorer_uri), null, [JUDGE], availableTypes);

        const judgesMap = new Map<string, ReputationProof>();
        for (const profile of profiles) {
            judgesMap.set(profile.token_id, mapLibProofToLocalProof(profile));
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
    // This function was complex and used for searching. 
    // If we only use it for judges, we can redirect to fetchJudges.
    if (type === "judge") {
        return fetchJudges();
    }

    // For other types, we might need to implement using fetchAllProfiles with filters
    // But for now, let's return empty or try to fetch all and filter
    console.warn("fetchReputationProofs called with type other than judge, which is not fully optimized yet.");
    return new Map();
}