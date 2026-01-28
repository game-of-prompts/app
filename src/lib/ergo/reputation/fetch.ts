import { get } from "svelte/store";
import { types, judges } from "$lib/common/store";
import { explorer_uri, CACHE_DURATION_MS } from "$lib/ergo/envs";
import {
    fetchTypeNfts as libFetchTypeNfts,
    searchBoxes,
    type ReputationProof,
    type TypeNFT,
    type RPBox,
    fetchAllProfiles,
    convertToRPBox,
    type ApiBox
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
        const fethed = await fetchAllProfiles(get(explorer_uri), true, [JUDGE], availableTypes);
        if (fethed.length > 0) {
            const judgesMap = new Map<string, ReputationProof>();
            for (const profile of fethed) {
                judgesMap.set(profile.token_id, profile);
            }
            judges.set({ data: judgesMap, last_fetch: Date.now() });
            return get(judges).data;
        }
        else {
            judges.set({ data: new Map(), last_fetch: Date.now() });
            return get(judges).data;
        }
    } catch (e: any) {
        console.error("Failed to fetch and store judges:", e);
        judges.set({ data: new Map(), last_fetch: 0 });
        return get(judges).data;
    }
}

export async function fetchOpinionsAbout(
    objectPointer: string,
    typeNftId?: string
): Promise<RPBox[]> {
    try {
        const boxGenerator = searchBoxes(
            get(explorer_uri),
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
        const types = await fetchTypeNfts();
        if (!boxes || boxes.length === 0) {
            return [];
        }
        return boxes.map((b: ApiBox) => {
            const rpBox = convertToRPBox(b, b.assets[0].tokenId, types);
            (rpBox as any).creationHeight = b.creationHeight;
            return rpBox;
        });
    } catch (e) {
        console.error("Error fetching opinions about:", e);
        return [];
    }
}
