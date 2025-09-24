import { Network, type RPBox, type ReputationProof, type TypeNFT } from "$lib/ergo/reputation/objects";
import { hexToBytes, hexToUtf8, serializedToRendered, SString, uint8ArrayToHex } from "$lib/ergo/utils";
import { get } from "svelte/store";
import { types, connected, judges } from "$lib/common/store";
import { explorer_uri, CACHE_DURATION_MS } from "$lib/ergo/envs";
import { getReputationProofErgoTreeHex, getReputationProofTemplateHash, getDigitalPublicGoodTemplateHash } from "$lib/ergo/contract";
import { type Amount, type Box, ErgoAddress, SByte, SColl } from "@fleet-sdk/core";
import { blake2b256 } from "@fleet-sdk/crypto";
import { GAME, JUDGE, PARTICIPATION } from "./types";

const ergo_tree = getReputationProofErgoTreeHex();
const ergo_tree_hash = getReputationProofTemplateHash();


function parseR6(r6RenderedValue: string): { isLocked: boolean; totalSupply: number } {
    try {
        const [lockedStr, supplyStr] = r6RenderedValue.replace(/[()\[\]]/g, '').split(',');
        return { isLocked: lockedStr.trim() === 'true', totalSupply: Number(supplyStr.trim()) };
    } catch (e) {
        console.warn("Could not parse R6 tuple, returning defaults:", r6RenderedValue, e);
        return { isLocked: true, totalSupply: 0 };
    }
}

export async function fetchTypeNfts(force: boolean = false): Promise<Map<string, TypeNFT>> {
    try {
        if (!force && (Date.now() - get(types).last_fetch < CACHE_DURATION_MS)) {
            console.log("Using cached Type NFTs (data is fresh).");
            return get(types).data;
        }

        const fetchedTypesArray: TypeNFT[] = [];

        const nftTypes = [GAME, PARTICIPATION, JUDGE];
        for (const currentTypeNftId of nftTypes) {
            
            try {
                const typeNftBoxResponse = await fetch(`${explorer_uri}/api/v1/boxes/byTokenId/${currentTypeNftId}`);
                
                if (!typeNftBoxResponse.ok) {
                    alert(`Could not fetch the Type NFT box for ${currentTypeNftId}. Status: ${typeNftBoxResponse.status}. Aborting transaction.`);
                    return new Map();
                }
                
                const responseData = await typeNftBoxResponse.json();
                
                // Check if items exist and has at least one item
                if (!responseData.items || responseData.items.length === 0) {
                    alert(`No NFT box found for type ${currentTypeNftId}. Aborting transaction.`);
                    return new Map();
                }
                
                const box = responseData.items[0];
                    fetchedTypesArray.push({
                    tokenId: box.assets[0].tokenId,
                    boxId: box.boxId,
                    typeName: hexToUtf8(box.additionalRegisters.R4?.renderedValue || '') ?? "",
                    description: hexToUtf8(box.additionalRegisters.R5?.renderedValue || '') ?? "",
                    schemaURI: hexToUtf8(box.additionalRegisters.R6?.renderedValue || '') ?? "",
                    isRepProof: box.additionalRegisters.R7?.renderedValue ?? false,
                    box: box
                });
                    
            } catch (error) {
                console.error(`Error fetching NFT box for type ${type}:`, error);
                alert(`Network error while fetching Type NFT box for ${type}. Aborting transaction.`);
                return new Map();
            }
        }
        
        const typesMap = new Map(fetchedTypesArray.map(type => [type.tokenId, type]));
        types.set({data: typesMap, last_fetch: Date.now()});
        console.log(`Successfully fetched and stored ${typesMap.size} Type NFTs.`);

        return get(types).data

    } catch (e: any) {
        console.error("Failed to fetch and store types:", e);
        types.set({data: new Map(), last_fetch: 0});
        return get(types).data;
    }
}

const ProofType = {
    game: GAME,
    participation: PARTICIPATION,
    judge: JUDGE
}

function createRPBoxFromApiBox(box: Box<Amount>, tokenId: string, availableTypes: Map<string, TypeNFT>): RPBox | null {
    if (box.ergoTree !== ergo_tree) return null;
    if (!box.assets?.length || !box.additionalRegisters.R4 || !box.additionalRegisters.R6 || !box.additionalRegisters.R7) return null;

    const type_nft_id_for_box = box.additionalRegisters.R4.renderedValue ?? "";
    let typeNftForBox = availableTypes.get(type_nft_id_for_box);
    if (!typeNftForBox) {
        typeNftForBox = { tokenId: type_nft_id_for_box, boxId: '', typeName: "Unknown Type", description: "Metadata not found", schemaURI: "", isRepProof: false, box: null };
    }
    
    let box_content: string|object|null = {};
    try {
        const rawValue = box.additionalRegisters.R9?.renderedValue;
        if (rawValue) {
            const potentialString = hexToUtf8(rawValue);
            try {
                box_content = JSON.parse(potentialString ?? "");
            } catch (jsonError) {
                box_content = potentialString;
            }
        }
    } catch (error) {
        box_content = {};
    }
    
    const object_pointer_for_box = box.additionalRegisters.R5?.renderedValue ?? "";

    return {
        box: box,
        box_id: box.boxId,
        type: typeNftForBox,
        token_id: tokenId,
        token_amount: Number(box.assets[0].amount),
        object_pointer: object_pointer_for_box,
        is_locked: parseR6(box.additionalRegisters.R6.renderedValue).isLocked,
        polarization: box.additionalRegisters.R8?.renderedValue === 'true',
        content: box_content,
    };
}

export async function fetchReputationProofs(
    ergo: any, 
    all: boolean, 
    type: "game" | "participation" | "judge",
    value: string | null
): Promise<Map<string, ReputationProof>> {

    const proofs = new Map<string, ReputationProof>();
    const tokenIdsToFetch = new Set<string>();
    
    // Build search criteria
    let registers: { [key: string]: any } = {};
    if (type || value) {
        const type_id = ProofType[type];
        registers["R4"] = type_id;
        if (value) {
           registers["R5"] = value;
        }
    }

    // If searching for user-specific proofs, add owner hash to search criteria
    if (!all) {
        const change_address = get(connected) && ergo ? await ergo.get_change_address() : null;
        if (change_address) {
            const userAddress = ErgoAddress.fromBase58(change_address);
            const propositionBytes = hexToBytes(userAddress.ergoTree);
            if (propositionBytes) {
                const hashedProposition = blake2b256(propositionBytes);
                registers["R7"] = uint8ArrayToHex(hashedProposition);
            }
        } else {
             // If no user address, cannot fetch user-specific proofs. Return empty.
            console.warn("Cannot fetch user proofs: no connected wallet address found.");
            return new Map();
        }
    }

    // --- Step 1: Find all unique token IDs that match the criteria ---
    try {
        let offset = 0, limit = 100, moreDataAvailable = true;
        
        while (moreDataAvailable) {
            const url = `${explorer_uri}/api/v1/boxes/unspent/search?offset=${offset}&limit=${limit}`;
            const final_body = { "ergoTreeTemplateHash": ergo_tree_hash, "registers": registers };
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(final_body) });

            if (!response.ok) {
                console.error(`Explorer search failed with status ${response.status}`);
                moreDataAvailable = false;
                continue;
            }

            const json_data = await response.json();
            if (!json_data.items || json_data.items.length === 0) {
                moreDataAvailable = false;
                continue;
            }

            for (const box of json_data.items as Box<Amount>[]) {
                // Basic validation to ensure it's a potential reputation proof box
                if (box.ergoTree === ergo_tree && box.assets?.length > 0) {
                    const rep_token_id = box.assets[0].tokenId;
                    tokenIdsToFetch.add(rep_token_id);
                }
            }
            offset += limit;
        }
        console.log(`Found ${tokenIdsToFetch.size} unique reputation proof token IDs matching criteria.`);
    } catch (error) {
        console.error('An error occurred during the token ID search phase:', error);
        return new Map(); // Return empty on error
    }
    
    // --- Step 2: Fetch full proof data for each unique token ID ---
    if (tokenIdsToFetch.size > 0) {

        console.log(`Fetching full details for ${tokenIdsToFetch.size} proofs...`);
        for (const tokenId of tokenIdsToFetch) {
            try {
                // Delegate the fetching and construction of the proof to the specialized function
                const proof = await fetchReputationProofByTokenId(tokenId, ergo);
                if (proof && proof.current_boxes.some(b => b.type.tokenId === JUDGE && b.object_pointer === proof.token_id)) {
                    proofs.set(tokenId, proof);
                }
                // `fetchReputationProofByTokenId` already handles validation and logging for invalid proofs (e.g., hash conflicts)
            } catch (e) {
                console.error(`Failed to fetch or process proof for token ID ${tokenId}:`, e);
            }
        }
    }

    console.log(`Successfully constructed ${proofs.size} complete reputation proofs.`);
    return proofs;
}


export async function fetchReputationProofByTokenId(
    tokenId: string,
    ergo: any,
    options: { ignoreOwnerHashConflict?: boolean } = {}
): Promise<ReputationProof | null> {
    const availableTypes = await fetchTypeNfts();

    try {
        const resp = await fetch(`${explorer_uri}/api/v1/boxes/unspent/byTokenId/${tokenId}`);
        if (!resp.ok) {
            console.warn(`Explorer returned ${resp.status} for token ${tokenId}`);
            return null;
        }
        const data = await resp.json();
        const items: Box<Amount>[] = data.items || [];
        if (items.length === 0) {
            console.warn(`No boxes returned for token ${tokenId}`);
            return null;
        }

        // Only keep boxes that match the reputation-proof ergo_tree
        const rpBoxes = items.filter(b => b.ergoTree === ergo_tree);
        if (rpBoxes.length === 0) {
            console.warn(`No reputation-proof boxes (ergoTree !== expected) found for token ${tokenId}`);
            return null;
        }

        // Collect unique owner hashes (serialized)
        const uniqueOwnerHashes = new Set(
            rpBoxes
                .filter(b => b.additionalRegisters.R7?.serializedValue)
                .map(b => b.additionalRegisters.R7!.serializedValue)
        );

        if (uniqueOwnerHashes.size > 1 && !options.ignoreOwnerHashConflict) {
            console.warn(`Reputation Proof ${tokenId} has conflicting owner hashes. Owner hashes:`, Array.from(uniqueOwnerHashes));
            // Mirror the behavior in fetchReputationProofs: skip/abort when owner hash conflicts found
            return null;
        }

        // Use the first matching rpBox as the primary box to read R6 / R7 values for summary fields
        const primaryBox = rpBoxes[0];

        const r6_parsed = parseR6(primaryBox.additionalRegisters.R6?.renderedValue ?? "");
        const owner_hash_serialized = primaryBox.additionalRegisters.R7?.serializedValue ?? "";

        // compute whether current user can spend (same method as fetchReputationProofs)
        let userR7SerializedHex: string | null = null;
        const change_address = get(connected) && ergo ? await ergo.get_change_address() : null;
        if (change_address) {
            try {
                const userAddress = ErgoAddress.fromBase58(change_address);
                const propositionBytes = hexToBytes(userAddress.ergoTree);
                if (propositionBytes) {
                    const hashedProposition = blake2b256(propositionBytes);
                    userR7SerializedHex = SColl(SByte, hashedProposition).toHex();
                }
            } catch (err) {
                console.warn("Could not compute user R7 serialized hash:", err);
            }
        }

        const proof: ReputationProof = {
            token_id: tokenId,
            type: { tokenId: "", boxId: '', typeName: "N/A", description: "...", schemaURI: "", isRepProof: false, box: null },
            total_amount: r6_parsed.totalSupply,
            blake_owner_script: serializedToRendered(owner_hash_serialized),
            owner_hash_serialized,
            can_be_spend: userR7SerializedHex ? owner_hash_serialized === userR7SerializedHex : false,
            current_boxes: [],
            number_of_boxes: 0,
            network: Network.ErgoMainnet,
            data: {}
        };

        // Build current_boxes from all returned items (not only rpBoxes) — createRPBoxFromApiBox will skip non-RP boxes.
        for (const box of items) {
            const rpBox = createRPBoxFromApiBox(box, tokenId, availableTypes);
            if (rpBox) {
                if (rpBox.object_pointer === proof.token_id) {
                    proof.type = rpBox.type;
                }
                proof.current_boxes.push(rpBox);
                proof.number_of_boxes += 1;
            }
        }

        // Skip proof if it has duplicate (R4,R5) pairs across boxes
        {
            const seen = new Set<string>();
            for (const b of proof.current_boxes) {
                const key = `${b.type?.tokenId ?? ""}|${b.object_pointer ?? ""}`;
                if (seen.has(key)) {
                    console.warn(`Reputation Proof ${tokenId} has multiple boxes with the same (R4,R5). Skipping.`);
                    return null;
                }
                seen.add(key);
            }
        }
        return proof;
    } catch (error) {
        console.error(`Error fetching reputation proof for token ${tokenId}:`, error);
        return null;
    }
}

export async function fetchJudges(force: boolean = false): Promise<Map<string, ReputationProof>> {
    try {
        if (!force && (Date.now() - get(judges).last_fetch < CACHE_DURATION_MS)) {
            console.log("Using cached Judges (data is fresh).");
            return get(judges).data;
        }
        const map = await fetchReputationProofs(ergo, true, "judge", null);
        judges.set({data: map, last_fetch: Date.now()});
        console.log(`Successfully fetched and stored ${map.size} Judges.`);
        return get(judges).data;
    } catch (e: any) {
        console.error("Failed to fetch and store judges:", e);
        judges.set({data: new Map(), last_fetch: 0});
        return get(judges).data;
    }
}