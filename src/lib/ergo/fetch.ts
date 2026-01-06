// src/lib/ergo/fetch.ts

import { type Box, type Amount } from "@fleet-sdk/core";
import { ErgoPlatform } from "./platform";
import {
    GameState,
    type GameActive,
    type GameResolution,
    type GameCancellation,
    type ParticipationBase,
    type GameFinalized,
    type AnyParticipation,
    type AnyGame,
    type GameContent,
    type ParticipationConsumedReason,
    type MalformedParticipationReason,
    resolve_participation_commitment
} from "../common/game";
import { CACHE_DURATION_MS, explorer_uri } from "./envs";
import {
    getGopGameActiveScriptHash,
    getGopGameResolutionTemplateHash,
    getGopParticipationTemplateHash,
    getGopGameCancellationTemplateHash,
    getGopGameActiveErgoTreeHex,
    getGopGameResolutionErgoTreeHex,
    getGopGameCancellationErgoTreeHex,
    getGopParticipationErgoTreeHex,
    getGopGameActiveTemplateHash,
    getGopParticipationBatchTemplateHash
} from "./contract"; // Assumes this file exports functions to get script hashes
import {
    hexToUtf8,
    parseCollByteToHex,
    parseLongColl,
    parseGameContent,
    getArrayFromValue
} from "./utils"; // Assumes this file contains parsing utilities
import { fetchReputationProofs } from "./reputation/fetch";
import { type RPBox } from "reputation-system";
import { calculate_reputation as calculate_reputation_proof } from "reputation-system";
import { get } from "svelte/store";
import { games, judges as judgesStore } from "../common/store";
import { DefaultGameConstants } from "$lib/common/constants";

export interface TokenEIP4 {
    name: string,
    description: string,
    decimals: number,
    emissionAmount: number | null
}

export async function fetch_token_details(id: string): Promise<TokenEIP4> {
    console.log("Fetching token details for ", id);
    const url = get(explorer_uri) + '/api/v1/tokens/' + id;
    const response = await fetch(url, {
        method: 'GET',
    });

    try {
        if (response.ok) {
            let json_data = await response.json();
            console.log("Token data: ", json_data);
            if (json_data['type'] == 'EIP-004') {
                return {
                    "name": json_data['name'],
                    "description": json_data['description'],
                    "decimals": json_data['decimals'],
                    "emissionAmount": json_data['emissionAmount']
                }
            }
            else if (json_data['type'] == null) {
                return {
                    "name": id.slice(0, 6),
                    "description": "",
                    "decimals": 0,
                    "emissionAmount": json_data['emissionAmount']
                }
            }
        }
    } catch { }
    return {
        'name': 'token',
        'description': "",
        'decimals': 0,
        'emissionAmount': null
    };
}

// =================================================================
// === REPUTATION PROOF UTILITIES
// =================================================================

function calculate_reputation(game: AnyGame): number {
    let reputation = 0
    reputation += game.judges.reduce((acc, token) => {
        const proof = get(judgesStore).data.get(token);
        return acc + (proof ? calculate_reputation_proof(proof) : 0);
    }, 0);
    return reputation;
}

/**
 * Fetches reputation opinions for a specific target (game or participation)
 * @param targetId The ID of the target (gameId or participationBoxId)
 * @param ergo Ergo wallet instance (optional)
 * @returns Array of reputation opinions
 */
async function fetchReputationOpinionsForTarget(
    type: "game" | "participation",
    targetId: string,
    ergo: any = null
): Promise<RPBox[]> {
    try {
        // Fetch all reputation proofs that reference this target
        const reputationProofs = await fetchReputationProofs(ergo, true, type, targetId);
        const opinions: RPBox[] = [];
        for (const [tokenId, proof] of reputationProofs) {
            // Find boxes that reference our target
            const relevantBoxes = proof.current_boxes.filter((box: RPBox) =>
                box.object_pointer === targetId
            );

            for (const box of relevantBoxes) {
                opinions.push(box);
            }
        }

        return opinions;
    } catch (error) {
        console.error(`Error fetching reputation opinions for target ${targetId}:`, error);
        return [];
    }
}

async function getTransactionInfo(transactionId: string): Promise<any> {
    const url = `${get(explorer_uri)}/api/v1/transactions/${transactionId}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`API response: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Error fetching transaction info for ${transactionId}:`, error);
        return null;
    }
}

// =================================================================
// === STATE: GAME ACTIVE
// =================================================================

/**
 * Parses a blockchain Box into a `GameActive` object.
 * This function is specifically designed for boxes following the `game_active.es` script.
 * @param box The raw box obtained from the explorer.
 * @returns A `GameActive` object or `null` if the box does not match the expected format.
 */
async function parseGameActiveBox(box: any): Promise<GameActive | null> {
    try {
        if (box.ergoTree !== getGopGameActiveErgoTreeHex()) {
            console.warn('parseGameActiveBox: invalid constants');
            return null;
        }

        if (!box.assets || box.assets.length === 0) {
            console.warn(`parseGameActiveBox: Box ${box.boxId} skipped as it has no assets (NFT).`);
            return null;
        }
        const gameId = box.assets[0].tokenId;

        // R4: Game state (0: Active)
        const gameState = parseInt(box.additionalRegisters.R4?.renderedValue, 10);
        if (gameState !== 0) throw new Error("R4 indicates incorrect game state (not 0).");

        // R5: seed (Seed, Ceremony deadline)
        const r5Value = JSON.parse(box.additionalRegisters.R5?.renderedValue.replace(/\[([a-f0-9]+)(,.*)/, '["$1"$2'));
        if (!Array.isArray(r5Value) || r5Value.length < 2) throw new Error("R5 is not a valid tuple (Seed, Ceremony deadline).");
        const seed = parseCollByteToHex(r5Value[0]);
        const ceremonyDeadline = Number(r5Value[1]); // R5[1] is Long
        if (!seed || isNaN(ceremonyDeadline)) throw new Error("Could not parse R5 (seed, ceremonyDeadline).");

        // R6: secretHash
        const secretHash = parseCollByteToHex(box.additionalRegisters.R6?.renderedValue);
        if (!secretHash) throw new Error("R6 (secretHash) is invalid or does not exist.");

        // R7: judges
        const judges: string[] = box.additionalRegisters.R7?.renderedValue
            .replace(/[\[\]\s]/g, "")
            .split(",").filter((e: string) => e.length === 64);

        // R8: numericalParameters
        const r8RenderedValue = box.additionalRegisters.R8?.renderedValue;
        let parsedR8Array: any[] | null = null;
        if (typeof r8RenderedValue === 'string') {
            try { parsedR8Array = JSON.parse(r8RenderedValue); }
            catch (e) { console.warn(`Could not JSON.parse R8 for ${box.boxId}: ${r8RenderedValue}`); }
        } else if (Array.isArray(r8RenderedValue)) { parsedR8Array = r8RenderedValue; }
        const numericalParams = parseLongColl(parsedR8Array);
        // structure: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage]
        if (!numericalParams || numericalParams.length < 5) throw new Error("R8 does not contain the 5 expected numerical parameters.");
        const [deadlineBlock, creatorStakeAmount, participationFeeAmount, perJudgeComissionPercentage, creatorComissionPercentage] = numericalParams;

        // R9: Coll[Coll[Byte]] -> [gameDetailsJSON, participationTokenId]
        const r9Value = getArrayFromValue(box.additionalRegisters.R9?.renderedValue);
        if (!Array.isArray(r9Value) || r9Value.length < 2) {
            throw new Error("R9 is not a valid array with at least 2 elements (gameDetailsJSON, participationTokenId).");
        }
        const gameDetailsHex = parseCollByteToHex(r9Value[0]);
        const participationTokenId = parseCollByteToHex(r9Value[1]);
        const gameDetailsJson = hexToUtf8(gameDetailsHex || "");
        const content = parseGameContent(gameDetailsJson, box.boxId, box.assets[0]);

        const gameActive: GameActive = {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box: box,
            status: GameState.Active,
            gameId,
            commissionPercentage: Number(creatorComissionPercentage), // From R8
            secretHash, // From R6
            judges, // From R7
            deadlineBlock: Number(deadlineBlock), // From R8
            creatorStakeAmount, // From R8
            participationFeeAmount, // From R8
            participationTokenId: participationTokenId || "", // From R9
            content, // From R9
            value: BigInt((participationTokenId && box.assets.find((a: any) => a.tokenId === participationTokenId)?.amount) || box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            perJudgeComissionPercentage: perJudgeComissionPercentage, // From R8
            reputation: 0,
            constants: DefaultGameConstants,
            seed: seed,
            ceremonyDeadline: ceremonyDeadline,
        };

        gameActive.reputation = calculate_reputation(gameActive);

        return gameActive;

    } catch (e) {
        console.error(`Error parsing active game box ${box.boxId}:`, e);
        return null;
    }
}


/**
 * Searches for and retrieves all games currently in the "Active" state.
 * @returns A `Promise` that resolves to a `Map` of active games, using the game ID as the key.
 */
export async function fetchActiveGames(): Promise<Map<string, GameActive>> {
    const games = new Map<string, GameActive>();
    const scriptHash = getGopGameActiveScriptHash();

    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    while (moreAvailable) {
        const url = `${get(explorer_uri)}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: scriptHash }),
            });
            if (!response.ok) throw new Error(`API response: ${response.status}`);

            const data = await response.json();
            const items: Box[] = data.items || [];
            for (const box of items) {
                const game = await parseGameActiveBox(box);
                if (game) games.set(game.gameId, game);
            }

            offset += items.length;
            moreAvailable = items.length === limit;
        } catch (error) {
            console.error("Exception while fetching active games:", error);
            moreAvailable = false;
        }
    }
    return games;
}

// =================================================================
// === STATE: GAME RESOLUTION
// =================================================================

/**
 * Parses a blockchain Box into a `GameResolution` object.
 * This function is designed to be robust, handling `renderedValue` as an array,
 * a valid JSON string, or a string formatted as an array without quotes.
 * @param box The raw box obtained from the explorer.
 * @returns A `GameResolution` object or `null` if the box does not match the expected format.
 */
export async function parseGameResolutionBox(box: any): Promise<GameResolution | null> {
    try {
        if (box.ergoTree !== getGopGameResolutionErgoTreeHex()) {
            console.warn('parseGameResolutionBox: invalid constants');
            return null;
        }

        if (!box.assets || box.assets.length === 0) {
            console.warn(`parseGameResolutionBox: Box ${box.boxId} skipped as it has no assets (NFT).`);
            return null;
        }
        const gameId = box.assets[0].tokenId;

        // R4 is game state.
        const gameState = parseInt(box.additionalRegisters.R4?.renderedValue, 10);
        if (gameState !== 1) throw new Error("R4 indicates incorrect game state.");

        // R5: Coll[Byte] -> Seed
        const seed = parseCollByteToHex(box.additionalRegisters.R5?.renderedValue);
        if (!seed) throw new Error("Could not parse R5 (Seed).");

        // R6: (Coll[Byte], Coll[Byte]) -> revealedS_Hex, winnerCandidateCommitment
        const r6Value = getArrayFromValue(box.additionalRegisters.R6?.renderedValue);
        if (!r6Value || r6Value.length < 2) throw new Error("R6 is not a valid tuple.");
        const revealedS_Hex = parseCollByteToHex(r6Value[0]);
        const winnerCandidateCommitment = parseCollByteToHex(r6Value[1]);
        if (!revealedS_Hex) throw new Error("Could not parse R6.");

        // R7: Coll[Coll[Byte]] -> judges
        const judges = (getArrayFromValue(box.additionalRegisters.R7?.renderedValue) || [])
            .map(parseCollByteToHex)
            .filter((judge): judge is string => judge !== null && judge !== undefined);

        // R8: Coll[Long] -> [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline]
        const r8Array = getArrayFromValue(box.additionalRegisters.R8?.renderedValue);
        const numericalParams = parseLongColl(r8Array);
        if (!numericalParams || numericalParams.length < 6) throw new Error("R8 does not contain the 6 expected numerical parameters.");
        const [deadlineBlock, creatorStakeAmount, participationFeeAmount, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline] = numericalParams;

        // R9: (Coll[Byte], Coll[Byte], Coll[Byte]) -> gameDetailsHex, participationTokenId, resolverScript_Hex
        const r9Value = getArrayFromValue(box.additionalRegisters.R9?.renderedValue);
        if (!r9Value || r9Value.length !== 3) throw new Error("R9 is not a valid tuple (expected 3 items).");

        const gameDetailsHex = r9Value[0];
        const participationTokenId = parseCollByteToHex(r9Value[1]);
        const resolverScript_Hex = parseCollByteToHex(r9Value[2]);

        if (!gameDetailsHex || !resolverScript_Hex) throw new Error("Could not parse R9.");

        const content = parseGameContent(hexToUtf8(gameDetailsHex), box.boxId, box.assets[0]);

        const resolverPK_Hex = resolverScript_Hex.slice(0, 6) == "0008cd" ? resolverScript_Hex.slice(6, resolverScript_Hex.length) : null

        const gameResolution: GameResolution = {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box,
            status: GameState.Resolution,
            gameId,
            resolutionDeadline: Number(resolutionDeadline),
            revealedS_Hex,
            winnerCandidateCommitment: winnerCandidateCommitment || null,
            judges,
            deadlineBlock: Number(deadlineBlock),
            creatorStakeAmount,
            participationFeeAmount,
            participationTokenId: participationTokenId ?? "",
            resolverPK_Hex,
            resolverScript_Hex,
            content,
            value: BigInt((participationTokenId && box.assets.find((a: any) => a.tokenId === participationTokenId)?.amount) || box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            perJudgeComissionPercentage: perJudgeComissionPercentage,
            resolverCommission: Number(creatorComissionPercentage), // Added from R8
            constants: DefaultGameConstants,
            seed: seed, // Added from R5
            reputation: 0
        };

        gameResolution.reputation = calculate_reputation(gameResolution);

        return gameResolution;

    } catch (e) {
        console.error(`Error parsing resolution game box ${box.boxId}:`, e);
        return null;
    }
}


/**
 * Searches for and retrieves all games currently in the "Resolution" state.
 * @returns A `Promise` that resolves to a `Map` of games in resolution, using the game ID as the key.
 */
export async function fetchResolutionGames(): Promise<Map<string, GameResolution>> {
    const games = new Map<string, GameResolution>();
    const scriptHash = getGopGameResolutionTemplateHash();

    let offset = 0;
    const limit = 100;
    let moreAvailable = true;


    while (moreAvailable) {
        const url = `${get(explorer_uri)}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: scriptHash }),
            });

            if (!response.ok) {
                throw new Error(`API response was not OK: ${response.status}`);
            }

            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const game = await parseGameResolutionBox(box);
                if (game) games.set(game.gameId, game);
            }

            offset += items.length;
            moreAvailable = items.length === limit;

        } catch (error) {
            console.error("An exception occurred while fetching resolution games:", error);
            moreAvailable = false;
        }
    }

    return games;
}

// =================================================================
// === STATE: GAME CANCELLATION
// =================================================================

/**
 * Parses a Box into a `GameCancellation` object, adapted for the new register structure.
 * @param box The raw box from the explorer.
 * @returns A `GameCancellation` object or `null`.
 */
export async function parseGameCancellationBox(box: any): Promise<GameCancellation | null> {
    try {
        if (box.ergoTree !== getGopGameCancellationErgoTreeHex()) {
            console.warn('parseGameCancellationBox: invalid constants (ErgoTree mismatch)');
            return null;
        }

        if (!box.assets || box.assets.length === 0) {
            console.warn(`parseGameCancellationBox: Box ${box.boxId} skipped as it has no assets (NFT).`);
            return null;
        }
        const gameId = box.assets[0].tokenId;

        // R4: Game state (Integer). Must be 2 for 'Cancelled'.
        const gameState = parseInt(box.additionalRegisters.R4?.renderedValue, 10);
        if (isNaN(gameState) || gameState !== 2) {
            console.warn(`parseGameCancellationBox: Box ${box.boxId} has incorrect game state in R4. Expected '2', got '${box.additionalRegisters.R4?.renderedValue}'.`);
            return null;
        }

        // R5: unlockHeight (Long). Converted directly to number.
        const unlockHeight = parseInt(box.additionalRegisters.R5?.renderedValue, 10);

        // R6: revealedSecret (Coll[Byte]). The revealed secret 'S'.
        const revealedS_Hex = parseCollByteToHex(box.additionalRegisters.R6?.renderedValue);

        // R7: creatorStake (Long). The creator's current stake.
        const currentStakeAmount = BigInt(parseInt(box.additionalRegisters.R7?.renderedValue, 10))

        // R8: Original deadline (Long).
        const originalDeadline = box.additionalRegisters.R8?.renderedValue ?? 0;

        // R9: Coll[Coll[Byte]] -> [gameDetailsJSON, participationTokenId]
        const r9Value = getArrayFromValue(box.additionalRegisters.R9?.renderedValue);
        if (!Array.isArray(r9Value) || r9Value.length < 2) {
            throw new Error("R9 is not a valid array with at least 2 elements (gameDetailsJSON, participationTokenId).");
        }
        const gameDetailsHex = parseCollByteToHex(r9Value[0]);
        const participationTokenId = parseCollByteToHex(r9Value[1]);
        const gameDetailsJson = hexToUtf8(gameDetailsHex || "");
        const content = parseGameContent(gameDetailsJson, box.boxId, box.assets[0]);

        // Validate that essential registers were parsed correctly
        if (isNaN(unlockHeight) || !revealedS_Hex || currentStakeAmount === undefined) {
            throw new Error("Invalid or missing registers R5, R6, or R7.");
        }

        const participationFeeAmount = BigInt(0); // Assuming 0 in cancellation

        const gameCancelled: GameCancellation = {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box,
            status: GameState.Cancelled_Draining,
            gameId,
            unlockHeight,
            revealedS_Hex,
            currentStakeAmount,
            content,
            participationFeeAmount,
            participationTokenId: participationTokenId ?? "",
            value: BigInt((participationTokenId && box.assets.find((a: any) => a.tokenId === participationTokenId)?.amount) || box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            judges: [],
            deadlineBlock: originalDeadline,
            constants: DefaultGameConstants,
            reputation: 0
        };

        gameCancelled.reputation = calculate_reputation(gameCancelled);

        return gameCancelled;

    } catch (e) {
        console.error(`Error parsing cancellation box ${box.boxId}:`, e);
        return null;
    }
}



/**
 * Searches for and retrieves all games currently in the "Cancellation" state.
 * @returns A `Promise` that resolves to a `Map` of games in cancellation, using the game ID as the key.
 */
export async function fetchCancellationGames(): Promise<Map<string, GameCancellation>> {
    const games = new Map<string, GameCancellation>();
    const scriptHash = getGopGameCancellationTemplateHash();

    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    while (moreAvailable) {
        const url = `${get(explorer_uri)}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: scriptHash }),
            });

            if (!response.ok) {
                throw new Error(`API response was not OK: ${response.status}`);
            }

            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const game = await parseGameCancellationBox(box);
                if (game) games.set(game.gameId, game);
            }

            offset += items.length;
            moreAvailable = items.length === limit;

        } catch (error) {
            console.error("An exception occurred while fetching cancellation games:", error);
            moreAvailable = false;
        }
    }

    return games;
}




// =================================================================
// === STATE: GAME FINALIZED
// =================================================================

export async function fetchFinalizedGames(): Promise<Map<string, GameFinalized>> {
    const games = new Map<string, GameFinalized>();

    const templateHashes = [
        getGopGameActiveTemplateHash(),
        getGopGameResolutionTemplateHash(),
        getGopGameCancellationTemplateHash()
    ];

    const allGameIds = new Set<string>();
    const historicalContractBoxes = new Map<string, AnyGame[]>();

    for (const templateHash of templateHashes) {
        let offset = 0;
        const limit = 100;
        let more = true;

        while (more) {
            const url = `${get(explorer_uri)}/api/v1/boxes/search?offset=${offset}&limit=${limit}`;
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ergoTreeTemplateHash: templateHash }),
                });
                if (!response.ok) throw new Error(`API response: ${response.status}`);

                const data = await response.json();
                const items: Box[] = data.items || [];

                for (const box of items) {
                    let game: AnyGame | null = null;
                    if (templateHash === getGopGameActiveTemplateHash()) {
                        game = await parseGameActiveBox(box);
                    } else if (templateHash === getGopGameResolutionTemplateHash()) {
                        game = await parseGameResolutionBox(box);
                    } else if (templateHash === getGopGameCancellationTemplateHash()) {
                        game = await parseGameCancellationBox(box);
                    }
                    if (game) {
                        allGameIds.add(game.gameId);
                        if (!historicalContractBoxes.has(game.gameId)) {
                            historicalContractBoxes.set(game.gameId, []);
                        }
                        historicalContractBoxes.get(game.gameId)!.push(game);
                    }
                }

                offset += items.length;
                more = items.length === limit;
            } catch (error) {
                console.error("Exception while fetching historical boxes for template " + templateHash + ":", error);
                more = false;
            }
        }
    }

    // Fetch current unspent boxes to filter out active/resolution/cancellation games
    const activeGames = await fetchActiveGames();
    const resolutionGames = await fetchResolutionGames();
    const cancellationGames = await fetchCancellationGames();

    for (const gameId of allGameIds) {
        // If the game is in a current unspent state, it's not finalized.
        if (activeGames.has(gameId) || resolutionGames.has(gameId) || cancellationGames.has(gameId)) {
            continue;
        }

        // Find the current box holding the game NFT
        let currentBox: Box<Amount> | null = null;
        try {
            const url = `${get(explorer_uri)}/api/v1/boxes/unspent/byTokenId/${gameId}`;
            const response = await fetch(`${url}?limit=1`);
            if (!response.ok) throw new Error(`API response: ${response.status}`);
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                currentBox = data.items[0];
            }
        } catch (e) {
            console.error(`Error fetching current box for game ${gameId}:`, e);
            continue;
        }

        if (!currentBox) continue; // Should not happen if historical boxes exist, but good to check

        // Check if the current unspent box is *still* a contract box (e.g., missed by first fetch)
        const contractTrees = [
            getGopGameActiveErgoTreeHex(),
            getGopGameResolutionErgoTreeHex(),
            getGopGameCancellationErgoTreeHex()
        ];
        if (contractTrees.includes(currentBox.ergoTree)) continue; // It's still in a contract state, skip.

        // At this point, the game NFT is in a non-contract box (e.g., winner's wallet)
        // We use historical data to build the Finalized object.
        const histBoxes = historicalContractBoxes.get(gameId) || [];
        let content: GameContent = {
            rawJsonString: "{}",
            title: "Unknown",
            description: "Unknown",
            serviceId: ""
        };
        let judges: string[] = [];

        let lastBox: AnyGame | null = null;
        if (histBoxes.length > 0) {
            // Sort by creation height descending to get the *last* contract box
            histBoxes.sort((a, b) => b.box.creationHeight - a.box.creationHeight);
            lastBox = histBoxes[0];
            content = lastBox.content;
            judges = lastBox.judges || [];
        } else {
            // This case should be rare (NFT found but no history?)
            continue;  // Skip if no historical data to extract content
        }

        // Find the last resolution box to get finalization deadlines
        const resolutionBoxes = histBoxes.filter((b) => b.status === "Resolution").sort((a, b) => b.box.creationHeight - a.box.creationHeight);
        const lastResolutionBox = resolutionBoxes.length > 0 ? resolutionBoxes[0] as GameResolution : null;
        const judgeFinalizationBlock = lastResolutionBox?.resolutionDeadline || 0;
        const winnerFinalizationGracePeriod = 64800; // 90 Days TODO take from script constants

        const finalized: GameFinalized = {
            boxId: lastResolutionBox?.boxId || currentBox.boxId, // Use resolution box ID if available
            box: lastResolutionBox?.box || currentBox, // Use resolution box if available
            platform: new ErgoPlatform(),
            status: GameState.Finalized,
            deadlineBlock: lastBox.deadlineBlock,
            gameId,
            content: lastBox.content,
            value: lastBox.value,
            participationTokenId: lastBox.participationTokenId,
            participationFeeAmount: BigInt(lastBox.participationFeeAmount || 0),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            judges: lastBox.judges || [],
            judgeFinalizationBlock: judgeFinalizationBlock,
            winnerFinalizationDeadline: judgeFinalizationBlock + winnerFinalizationGracePeriod,
            constants: DefaultGameConstants,
            reputation: 0,
            seed: lastResolutionBox?.seed || "",
            revealedS_Hex: lastResolutionBox?.revealedS_Hex || "",
            winnerCandidateCommitment: lastResolutionBox?.winnerCandidateCommitment || null,
            creatorStakeAmount: lastResolutionBox?.creatorStakeAmount || BigInt(0),
            perJudgeComissionPercentage: lastResolutionBox?.perJudgeComissionPercentage || BigInt(0),
            resolverPK_Hex: lastResolutionBox?.resolverPK_Hex || null,
            resolverScript_Hex: lastResolutionBox?.resolverScript_Hex || "",
            resolverCommission: lastResolutionBox?.resolverCommission || 0
        };

        finalized.reputation = calculate_reputation(finalized);

        games.set(gameId, finalized);
    }

    return games;
}


// =================================================================
// === STATE: PARTICIPATION SUBMITTED & RESOLVED
// =================================================================


async function _parseParticipationBox(box: any, participationTokenId: string): Promise<ParticipationBase | null> {
    try {
        const playerScript_Hex = box.additionalRegisters.R4?.renderedValue;
        const commitmentC_Hex = box.additionalRegisters.R5?.renderedValue;
        const gameNftId = box.additionalRegisters.R6?.renderedValue;
        const solverId_RawBytesHex = box.additionalRegisters.R7?.renderedValue;
        const hashLogs_Hex = box.additionalRegisters.R8?.renderedValue;
        const scoreList = JSON.parse(box.additionalRegisters.R9?.renderedValue) ?? [];

        if (!playerScript_Hex || !commitmentC_Hex || !gameNftId || !solverId_RawBytesHex || !hashLogs_Hex) {
            throw new Error("Invalid participation registers.");
        }

        const playerPK_Hex = playerScript_Hex.slice(0, 6) == "0008cd" ? playerScript_Hex.slice(6, playerScript_Hex.length) : null

        const participation_value =
            participationTokenId === ""
                ? BigInt(box.value)
                : BigInt(
                    box.assets.find((a: any) => a.tokenId === participationTokenId)?.amount ?? 0
                );

        const participationBase: ParticipationBase = {
            boxId: box.boxId,
            box,
            transactionId: box.transactionId,
            creationHeight: box.creationHeight,
            value: participation_value,
            gameNftId,
            playerPK_Hex,
            playerScript_Hex,
            commitmentC_Hex,
            solverId_RawBytesHex,
            solverId_String: solverId_RawBytesHex,
            hashLogs_Hex,
            scoreList,
            reputationOpinions: await fetchReputationOpinionsForTarget("participation", box.boxId)
        };
        return participationBase;

    } catch (e) {
        console.error(`Error parsing participation box ${box.boxId}:`, e);
        return null;
    }
}

/**
 * Searches for "Submitted" or "Malformed" participations for a specific game.
 * @param gameNftId The NFT ID of the game.
 * @param gameDeadline The deadline block height of the game.
 * @returns A `Promise` with an array of `Participation`.
 */
export async function fetchParticipations(game: AnyGame): Promise<AnyParticipation[]> {
    const gameNftId = game.gameId;
    const gameDeadline = game.deadlineBlock;

    const participations: AnyParticipation[] = [];
    const scriptHash = getGopParticipationTemplateHash();

    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    while (moreAvailable) {
        const url = `${get(explorer_uri)}/api/v1/boxes/search?offset=${offset}&limit=${limit}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: scriptHash,
                    registers: {
                        "R6": gameNftId
                    }
                }),
            });

            if (!response.ok) {
                throw new Error(`API response was not OK: ${response.status}`);
            }

            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                if (box.ergoTree !== getGopParticipationErgoTreeHex()) {
                    console.warn('parseParticipationBox: invalid constants');
                    continue;
                }
                const p_base = await _parseParticipationBox(box, game.participationTokenId);
                if (p_base) {
                    const spent = !!(box as any).spentTransactionId;
                    const expired = box.creationHeight >= gameDeadline;
                    const max_scores_exceeded = p_base.scoreList.length > 10;

                    const wrong_commitment = (game.status == GameState.Resolution || game.status == GameState.Finalized) && resolve_participation_commitment(p_base as AnyParticipation, (game as GameResolution).revealedS_Hex, (game as GameResolution).seed) === null;
                    if (wrong_commitment) {
                        console.log("Wrong commitment");
                        console.log("Participation ", p_base);
                        console.log("Game ", game);
                        console.log("Revealed S ", (game as GameResolution).revealedS_Hex);
                        console.log("Seed ", (game as GameResolution).seed);
                    }

                    const malformed = expired || wrong_commitment || max_scores_exceeded;
                    if (malformed && !spent) {
                        const reason = await (async (): Promise<MalformedParticipationReason> => {
                            if (expired) return "expired";
                            if (wrong_commitment) return "wrongcommitment";
                            if (max_scores_exceeded) return "maxscores";
                            return "unknown";
                        })();
                        participations.push({
                            ...p_base,
                            status: 'Malformed',
                            spent,
                            reason
                        });
                    } else {
                        if (spent) {
                            const reason = await (async (): Promise<ParticipationConsumedReason> => {

                                if (game.status === GameState.Active) return "byparticipant";

                                if (game.status === GameState.Resolution) {
                                    // Check if a majority of nominated judges have invalidated this participation
                                    const nominatedJudges = (game as GameResolution).judges;
                                    const invalidationVotes = p_base.reputationOpinions.filter(
                                        (opinion) => nominatedJudges.includes(opinion.token_id) && opinion.polarization === false
                                    );
                                    const invalidated = nominatedJudges.length > 0 && invalidationVotes.length > nominatedJudges.length / 2;
                                    if (invalidated) {
                                        return "invalidated";
                                    }
                                    else {
                                        return "batched";
                                    }
                                }

                                if (game.status === GameState.Cancelled_Draining) return "cancelled";

                                if (game.status === GameState.Finalized) {
                                    const spentTx = await getTransactionInfo((box as any).spentTransactionId!);
                                    if (!spentTx) return "unknown";

                                    if (spentTx.inclusionHeight < (game as GameFinalized).judgeFinalizationBlock) return "invalidated";
                                    if (spentTx.inclusionHeight < (game as GameFinalized).winnerFinalizationDeadline) return "bywinner";
                                    return "abandoned";  // In case the winner doesn't take it.
                                }

                                return "unknown";
                            })();
                            participations.push({
                                ...p_base,
                                status: 'Consumed',
                                spent,
                                reason
                            });
                        } else {
                            participations.push({
                                ...p_base,
                                status: 'Submitted',
                                spent
                            });
                        }
                    }
                }
            }

            offset += items.length;
            moreAvailable = items.length === limit;

        } catch (error) {
            console.error(`An exception occurred while fetching historical participations for ${gameNftId}:`, error);
            moreAvailable = false;
        }
    }

    return participations;
}

/**
 * Searches for participation batches for a specific game.
 * @param game The game object.
 * @returns A `Promise` with an array of batch boxes.
 */
export async function fetchParticipationBatches(game: AnyGame): Promise<Box<Amount>[]> {
    const gameNftId = game.gameId;
    const batches: Box<Amount>[] = [];
    const scriptHash = getGopParticipationBatchTemplateHash();

    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    while (moreAvailable) {
        const url = `${get(explorer_uri)}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: scriptHash,
                    registers: {
                        R6: gameNftId
                    }
                }),
            });

            if (!response.ok) throw new Error(`API response: ${response.status}`);

            const data = await response.json();
            const items: Box<Amount>[] = data.items || [];

            // Filter by R6 just in case the API search didn't filter perfectly (though it should)
            for (const box of items) {
                if ((box as any).additionalRegisters?.R6?.renderedValue === gameNftId) {
                    batches.push(box);
                }
            }

            offset += items.length;
            moreAvailable = items.length === limit;
        } catch (error) {
            console.error("Exception while fetching participation batches:", error);
            moreAvailable = false;
        }
    }
    return batches;
}


// =================================================================
// === ALL GAMES
// =================================================================
let inFlightFetch: Promise<Map<string, AnyGame>> | null = null;

export async function fetchGoPGames(force: boolean = false, avoidFullLoad: boolean = false): Promise<Map<string, AnyGame>> {
    if (force && avoidFullLoad) {
        alert("Incorrect use of fetchGoPGames function. Check code.");
        return new Map();
    }

    const current = get(games);

    // Return cached data if valid
    if (!force && (Date.now() - current.last_fetch < CACHE_DURATION_MS)) {
        return current.data;
    }

    if (avoidFullLoad) {
        return new Map();
    }

    // If a fetch is already in progress, return its promise
    if (inFlightFetch) {
        return inFlightFetch;
    }

    // Start the fetch operation
    inFlightFetch = (async () => {
        try {
            // 1. If forced, clear the store. Otherwise, just update the timestamp.
            if (force) {
                games.set({ data: new Map(), last_fetch: Date.now() });
            } else {
                games.update(current => ({ ...current, last_fetch: Date.now() }));
            }

            // 2. Helper function to merge results into the store
            const mergeIntoStore = (newGames: Map<string, AnyGame>) => {
                if (newGames.size > 0) {
                    games.update(current => {
                        const updatedData = new Map(current.data);
                        newGames.forEach((value, key) => updatedData.set(key, value));
                        // Return the new complete state
                        return { last_fetch: current.last_fetch, data: updatedData };
                    });
                    console.log(`[fetchGoPGames] Store updated with ${newGames.size} games.`);
                }
            };

            // 3. Define the promises. Each will update the store upon completion.
            //    Add .catch() to each individually so one failure doesn't stop others.
            const fetchPromises = [
                fetchActiveGames()
                    .then(mergeIntoStore)
                    .catch(e => console.error("Error fetching active games:", e)),

                fetchResolutionGames()
                    .then(mergeIntoStore)
                    .catch(e => console.error("Error fetching resolution games:", e)),

                fetchCancellationGames()
                    .then(mergeIntoStore)
                    .catch(e => console.error("Error fetching cancellation games:", e)),

                fetchFinalizedGames()
                    .then(mergeIntoStore)
                    .catch(e => console.error("Error fetching finalized games:", e))
            ];

            // 4. Wait for all promises (and their .then() updates) to complete.
            await Promise.all(fetchPromises);

            // 5. The fetch is complete.
            const finalState = get(games);
            console.log(`Fetch complete. Total games found: ${finalState.data.size}`);

            // Return the final Map from the store, as the original function did.
            return finalState.data;

        } finally {
            // 6. Release the lock for the next fetch
            inFlightFetch = null;
        }
    })();

    return inFlightFetch;
}


/**
 * Fetch a single game by its NFT id (token id). Will return the game regardless of its state:
 * - Active / Resolution / Cancelled  => parsed from the current unspent box
 * - Finalized (no longer using contract trees) => reconstructed from historical contract boxes
 * Returns null if the game cannot be found or parsed.
 */
export async function fetchGame(id: string): Promise<AnyGame | null> {
    // 1) try store first
    try {
        const current = get(games);
        if (current && current.data && current.data.has(id)) {
            return current.data.get(id)!;
        }
    } catch (e) {
        console.warn("fetchGame: could not read store:", e);
    }

    // helper constants
    const activeTemplate = getGopGameActiveTemplateHash();
    const resolutionTemplate = getGopGameResolutionTemplateHash();
    const cancellationTemplate = getGopGameCancellationTemplateHash();

    // 2) try to fetch current unspent box for the token (if any)
    let currentBox: Box<Amount> | null = null;
    try {
        const url = `${get(explorer_uri)}/api/v1/boxes/unspent/byTokenId/${id}`;
        const resp = await fetch(`${url}?limit=1`);
        if (resp.ok) {
            const data = await resp.json();
            if (data.items && data.items.length > 0) {
                currentBox = data.items[0];
            }
        } else {
            console.warn(`fetchGame: unspent/byTokenId response not ok: ${resp.status}`);
        }
    } catch (e) {
        console.error(`fetchGame: error fetching unspent box for ${id}:`, e);
    }

    // 3) If there is a current box and it matches a contract ErgoTree -> parse and return
    try {
        if (currentBox) {
            if (currentBox.ergoTree === getGopGameActiveErgoTreeHex()) {
                const parsed = await parseGameActiveBox(currentBox);
                if (parsed) return parsed;
            } else if (currentBox.ergoTree === getGopGameResolutionErgoTreeHex()) {
                const parsed = await parseGameResolutionBox(currentBox);
                if (parsed) return parsed;
            } else if (currentBox.ergoTree === getGopGameCancellationErgoTreeHex()) {
                const parsed = await parseGameCancellationBox(currentBox);
                if (parsed) return parsed;
            }
            // else: currentBox exists but not a contract tree -> likely a finalized token holder box
        }
    } catch (e) {
        console.error(`fetchGame: error parsing current box for ${id}:`, e);
    }

    // 4) If we reached here we need to collect historical contract boxes for this token id
    const templateHashes = [activeTemplate, resolutionTemplate, cancellationTemplate];
    const histBoxes: AnyGame[] = [];

    const limit = 100;
    for (const templateHash of templateHashes) {
        let offset = 0;
        let more = true;
        while (more) {
            try {
                const url = `${get(explorer_uri)}/api/v1/boxes/search?offset=${offset}&limit=${limit}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ergoTreeTemplateHash: templateHash }),
                });
                if (!resp.ok) {
                    console.warn(`fetchGame: /boxes/search returned ${resp.status} for template ${templateHash}`);
                    break;
                }
                const data = await resp.json();
                const items: Box[] = data.items || [];

                for (const box of items) {
                    try {
                        if (!box.assets || box.assets.length === 0) continue;
                        if (box.assets[0].tokenId !== id) continue;

                        let parsed: AnyGame | null = null;
                        if (templateHash === activeTemplate) {
                            parsed = await parseGameActiveBox(box);
                        } else if (templateHash === resolutionTemplate) {
                            parsed = await parseGameResolutionBox(box);
                        } else if (templateHash === cancellationTemplate) {
                            parsed = await parseGameCancellationBox(box);
                        }
                        if (parsed) histBoxes.push(parsed);
                    } catch (inner) {
                        console.error(`fetchGame: error parsing historical box ${box.boxId} for ${id}:`, inner);
                    }
                }

                offset += items.length;
                more = items.length === limit;
            } catch (e) {
                console.error(`fetchGame: exception while searching template ${templateHash} for ${id}:`, e);
                break;
            }
        }
    }

    // 5) If we found historical contract boxes, try to reconstruct Finalized (or use the best historical box)
    if (histBoxes.length > 0) {
        // pick last box by creationHeight (descending)
        histBoxes.sort((a, b) => b.box.creationHeight - a.box.creationHeight);
        const lastBox = histBoxes[0];

        // gather judges from lastBox if present
        const judges = lastBox.judges || [];

        // find last resolution box (to get resolutionDeadline / judgeFinalizationBlock)
        const resolutionBoxes = histBoxes.filter(b => b.status === GameState.Resolution)
            .sort((a, b) => b.box.creationHeight - a.box.creationHeight);
        const lastResolutionBox = resolutionBoxes.length > 0 ? (resolutionBoxes[0] as GameResolution) : null;
        const judgeFinalizationBlock = lastResolutionBox?.resolutionDeadline || 0;
        const winnerFinalizationGracePeriod = 64800; // 90 days (as in fetchFinalizedGames) - TODO: take from contract constants if available

        // build finalized object
        try {
            const finalized: GameFinalized = {
                boxId: currentBox ? currentBox.boxId : lastBox.box.boxId,
                box: currentBox ? currentBox : lastBox.box,
                platform: new ErgoPlatform(),
                status: GameState.Finalized,
                deadlineBlock: lastBox.deadlineBlock,
                gameId: id,
                content: lastBox.content,
                value: BigInt(lastBox.box.value),
                participationFeeAmount: BigInt(lastBox.participationFeeAmount || 0),
                participationTokenId: lastBox.participationTokenId,
                reputationOpinions: await fetchReputationOpinionsForTarget("game", id),
                judges,
                judgeFinalizationBlock: judgeFinalizationBlock,
                winnerFinalizationDeadline: judgeFinalizationBlock + winnerFinalizationGracePeriod,
                constants: DefaultGameConstants,
                reputation: 0,
                // New fields populated from lastResolutionBox
                seed: lastResolutionBox?.seed || "",
                revealedS_Hex: lastResolutionBox?.revealedS_Hex || "",
                winnerCandidateCommitment: lastResolutionBox?.winnerCandidateCommitment || null,
                creatorStakeAmount: lastResolutionBox?.creatorStakeAmount || BigInt(0),
                perJudgeComissionPercentage: lastResolutionBox?.perJudgeComissionPercentage || BigInt(0),
                resolverPK_Hex: lastResolutionBox?.resolverPK_Hex || null,
                resolverScript_Hex: lastResolutionBox?.resolverScript_Hex || "",
                resolverCommission: lastResolutionBox?.resolverCommission || 0
            };

            finalized.reputation = calculate_reputation(finalized);

            return finalized;
        } catch (e) {
            console.error(`fetchGame: error constructing finalized object for ${id}:`, e);
            return null;
        }
    }

    // 6) If no historical boxes and no current contract box, but currentBox exists (non-contract),
    // we may still want to return a minimal "Finalized" style object using available data.
    if (currentBox) {
        try {
            // Try to extract some minimal content from currentBox (if it contains the NFT metadata)
            let content: GameContent = {
                rawJsonString: "{}",
                title: "Unknown",
                description: "Unknown",
                serviceId: ""
            };
            try {
                if (currentBox.additionalRegisters && currentBox.additionalRegisters.R9) {
                    const hex = parseCollByteToHex((currentBox.additionalRegisters.R9 as any)?.renderedValue);
                    const json = hexToUtf8(hex || "");
                    content = parseGameContent(json, currentBox.boxId, currentBox.assets?.[0]);
                }
            } catch (e) {
                // ignore content parse failures
            }

            const minimal: GameFinalized = {
                boxId: currentBox.boxId,
                box: currentBox,
                platform: new ErgoPlatform(),
                status: GameState.Finalized,
                deadlineBlock: 0,
                gameId: id,
                content,
                value: BigInt(currentBox.value),
                participationTokenId: "",
                participationFeeAmount: BigInt(0),
                reputationOpinions: await fetchReputationOpinionsForTarget("game", id),
                judges: [],
                judgeFinalizationBlock: 0,
                winnerFinalizationDeadline: 0,
                constants: DefaultGameConstants,
                reputation: 0,
                // New fields with default values (no historical data)
                seed: "",
                revealedS_Hex: "",
                winnerCandidateCommitment: null,
                creatorStakeAmount: BigInt(0),
                perJudgeComissionPercentage: BigInt(0),
                resolverPK_Hex: null,
                resolverScript_Hex: "",
                resolverCommission: 0
            };
            minimal.reputation = calculate_reputation(minimal);
            return minimal;
        } catch (e) {
            console.error(`fetchGame: error constructing minimal object from current box for ${id}:`, e);
            return null;
        }
    }

    // 7) Not found anywhere
    console.warn(`fetchGame: game ${id} not found (store, unspent current box, nor historical contract boxes).`);
    return null;
}