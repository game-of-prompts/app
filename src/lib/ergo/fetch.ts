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
import { explorer_uri } from "./envs";
import { 
    getGopGameActiveScriptHash,
    getGopGameResolutionTemplateHash,
    getGopParticipationTemplateHash,
    getGopGameCancellationTemplateHash,
    getGopGameActiveErgoTreeHex,
    getGopGameResolutionErgoTreeHex,
    getGopGameCancellationErgoTreeHex,
    getGopParticipationErgoTreeHex,
    getGopGameActiveTemplateHash
} from "./contract"; // Assumes this file exports functions to get script hashes
import {
    hexToUtf8,
    parseCollByteToHex,
    parseLongColl,
    parseGameContent
} from "./utils"; // Assumes this file contains parsing utilities
import { fetchReputationProofs } from "./reputation/fetch";
import { type ReputationOpinion, type RPBox } from "./reputation/objects";
import { get } from "svelte/store";
import { judges as judgesStore } from "../common/store";
import { DefaultGameConstants } from "$lib/common/constants";

// =================================================================
// === REPUTATION PROOF UTILITIES
// =================================================================

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
): Promise<ReputationOpinion[]> {
    try {
        // Fetch all reputation proofs that reference this target
        const reputationProofs = await fetchReputationProofs(ergo, true, type, targetId);
        const opinions: ReputationOpinion[] = [];

        for (const [tokenId, proof] of reputationProofs) {
            // Find boxes that reference our target
            const relevantBoxes = proof.current_boxes.filter((box: RPBox) => 
                box.object_pointer === targetId
            );

            for (const box of relevantBoxes) {
                opinions.push({
                    tokenId,
                    boxId: box.box_id,
                    type: {
                        tokenId: box.type.tokenId,
                        typeName: box.type.typeName,
                        description: box.type.description
                    },
                    isPositive: !box.polarization, // Assuming false = positive, true = negative
                    content: box.content,
                    ownerAddress: proof.owner_ergotree
                });
            }
        }

        return opinions;
    } catch (error) {
        console.error(`Error fetching reputation opinions for target ${targetId}:`, error);
        return [];
    }
}

async function getTransactionInfo(transactionId: string): Promise<any> {
    const url = `${explorer_uri}/api/v1/transactions/${transactionId}`;
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
async function parseGameActiveBox(box: Box<Amount>, reputationOptions: ReputationOpinion[] = []): Promise<GameActive | null> {
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
        // New structure: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage]
        if (!numericalParams || numericalParams.length < 5) throw new Error("R8 does not contain the 5 expected numerical parameters.");
        const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg, perJudgeComissionPercentage, creatorComissionPercentage] = numericalParams;
        
        // R9: gameDetailsJsonHex
        const gameDetailsHex = parseCollByteToHex(box.additionalRegisters.R9?.renderedValue);
        const gameDetailsJson = hexToUtf8(gameDetailsHex || "");
        const content = parseGameContent(gameDetailsJson, box.boxId, box.assets[0]);

        // --- Calculate Reputation ---
        const reputation = judges.reduce((acc, token) => acc + Number(get(judgesStore).data.get(token)?.reputation || 0), 0);

        const gameActive: GameActive = {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box: box,
            status: GameState.Active,
            gameId,
            commissionPercentage: creatorComissionPercentage, // From R8
            secretHash, // From R6
            judges, // From R7
            deadlineBlock: Number(deadlineBlock), // From R8
            creatorStakeNanoErg, // From R8
            participationFeeNanoErg, // From R8
            content, // From R9
            value: BigInt(box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            perJudgeComissionPercentage: perJudgeComissionPercentage, // From R8
            reputation: reputation,
            constants: DefaultGameConstants,
            seed: seed,
            ceremonyDeadline: ceremonyDeadline,
        };
        
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
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
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
export async function parseGameResolutionBox(box: Box<Amount>): Promise<GameResolution | null> {
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


        const getArrayFromValue = (value: any): any[] | null => {
            if (Array.isArray(value)) return value;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed.startsWith("[") && trimmed.endsWith("]") && !trimmed.includes('"')) {
                    const inner = trimmed.substring(1, trimmed.length - 1);
                    return inner === '' ? [] : inner.split(',');
                }
                try {
                    return JSON.parse(trimmed);
                } catch (e) {
                    console.warn(`Could not parse JSON string for box ${box.boxId}: ${value}`);
                    return null;
                }
            }
            return null;
        };

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
        if (!revealedS_Hex ) throw new Error("Could not parse R6.");
        
        // R7: Coll[Coll[Byte]] -> judges
        const judges = (getArrayFromValue(box.additionalRegisters.R7?.renderedValue) || [])
            .map(parseCollByteToHex)
            .filter((judge): judge is string => judge !== null && judge !== undefined);

        // R8: Coll[Long] -> [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline]
        const r8Array = getArrayFromValue(box.additionalRegisters.R8?.renderedValue);
        const numericalParams = parseLongColl(r8Array);
        if (!numericalParams || numericalParams.length < 6) throw new Error("R8 does not contain the 6 expected numerical parameters.");
        console.log(`R8 numericalParams for box ${box.boxId}:`, numericalParams);
        const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline] = numericalParams;

        // R9: (Coll[Byte], Coll[Byte], Coll[Byte]) -> gameDetailsHex, originalCreatorScript_Hex, resolverScript_Hex
        const r9Value = getArrayFromValue(box.additionalRegisters.R9?.renderedValue);
        if (!r9Value || r9Value.length !== 2) throw new Error("R9 is not a valid tuple (expected 2 items).");
        
        const gameDetailsHex = r9Value[0];
        const resolverScript_Hex = parseCollByteToHex(r9Value[1]);

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
            creatorStakeNanoErg, 
            participationFeeNanoErg,
            resolverPK_Hex, 
            resolverScript_Hex,
            content, 
            value: BigInt(box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            perJudgeComissionPercentage: perJudgeComissionPercentage,
            resolverCommission: creatorComissionPercentage, // Se añade desde R8
            constants: DefaultGameConstants,
            seed: seed, // Se añade desde R5
            reputation: 0
        };

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

    console.log("Searching for resolution games with template hash:", scriptHash);

    while (moreAvailable) {
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
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

    console.log(`Found ${games.size} games in resolution.`);
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
export async function parseGameCancellationBox(box: Box<Amount>): Promise<GameCancellation | null> {
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

        // R4: Game state (Integer). Debe ser 2 para 'Cancelled'.
        const gameState = parseInt(box.additionalRegisters.R4?.renderedValue, 10);
        if (isNaN(gameState) || gameState !== 2) {
            console.warn(`parseGameCancellationBox: Box ${box.boxId} has incorrect game state in R4. Expected '2', got '${box.additionalRegisters.R4?.renderedValue}'.`);
            return null;
        }

        // R5: unlockHeight (Long). Se convierte directamente a número.
        const unlockHeight = parseInt(box.additionalRegisters.R5?.renderedValue, 10);
        
        // R6: revealedSecret (Coll[Byte]). El secreto 'S' revelado.
        const revealedS_Hex = parseCollByteToHex(box.additionalRegisters.R6?.renderedValue);
        
        // R7: creatorStake (Long). El stake actual del creador.
        const currentStakeNanoErg = BigInt(parseInt(box.additionalRegisters.R7?.renderedValue, 10))
        
        // R8: Original deadline (Long).
        const originalDeadline = box.additionalRegisters.R8?.renderedValue ?? 0;

        // R9: ReadOnlyInfo (Coll[Byte]). JSON con datos inmutables.
        const content = parseGameContent(hexToUtf8(parseCollByteToHex(box.additionalRegisters.R9?.renderedValue) || ""), box.boxId, box.assets[0]);

        // Valida que los registros esenciales se hayan parseado correctamente
        if (isNaN(unlockHeight) || !revealedS_Hex || currentStakeNanoErg === undefined) {
            throw new Error("Invalid or missing registers R5, R6, or R7.");
        }

        const participationFeeNanoErg = BigInt(0); // Asumiendo 0 en cancelación

        return {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box,
            status: GameState.Cancelled_Draining,
            gameId,
            unlockHeight,
            revealedS_Hex,
            currentStakeNanoErg,
            content,
            participationFeeNanoErg,
            value: BigInt(box.value),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            judges: [],
            deadlineBlock: originalDeadline,
            constants: DefaultGameConstants,
            reputation: 0
        };
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

    console.log("Searching for cancellation games with template hash:", scriptHash);

    while (moreAvailable) {
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
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

    console.log(`Found ${games.size} games in cancellation.`);
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
            const url = `${explorer_uri}/api/v1/boxes/search?offset=${offset}&limit=${limit}`;
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

    const activeGames = await fetchActiveGames();
    const resolutionGames = await fetchResolutionGames();
    const cancellationGames = await fetchCancellationGames();

    for (const gameId of allGameIds) {
        if (activeGames.has(gameId) || resolutionGames.has(gameId) || cancellationGames.has(gameId)) {
            continue;
        }

        let currentBox: Box<Amount> | null = null;
        try {
            const url = `${explorer_uri}/api/v1/boxes/unspent/byTokenId/${gameId}`;
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

        if (!currentBox) continue;

        const contractTrees = [
            getGopGameActiveErgoTreeHex(),
            getGopGameResolutionErgoTreeHex(),
            getGopGameCancellationErgoTreeHex()
        ];
        if (contractTrees.includes(currentBox.ergoTree)) continue;

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
            histBoxes.sort((a, b) => b.box.creationHeight - a.box.creationHeight);
            lastBox = histBoxes[0];
            content = lastBox.content;
            judges = lastBox.judges || [];
        } else {
            continue;  // Skip if no historical data to extract content
        }

        const resolutionBoxes = histBoxes.filter((b) => b.status === "Resolution").sort((a, b) => b.box.creationHeight - a.box.creationHeight);
        const lastResolutionBox = resolutionBoxes.length > 0 ? resolutionBoxes[0] : null;
        const judgeFinalizationBlock = lastResolutionBox?.resolutionDeadline || 0;
        const winnerFinalizationGracePeriod = 64800; // 90 Días    TODO take from script constants

        const finalized: GameFinalized = {
            boxId: currentBox.boxId,
            box: currentBox,
            platform: new ErgoPlatform(),
            status: GameState.Finalized,
            deadlineBlock: lastBox.deadlineBlock,
            gameId,
            content,
            value: BigInt(lastBox.box.value),
            participationFeeNanoErg: BigInt(lastBox.participationFeeNanoErg || 0),
            reputationOpinions: await fetchReputationOpinionsForTarget("game", gameId),
            judges,
            judgeFinalizationBlock: judgeFinalizationBlock,
            winnerFinalizationDeadline: judgeFinalizationBlock + winnerFinalizationGracePeriod,
            constants: DefaultGameConstants,
        };

        console.log("Finalized game found. Body: ", finalized);

        games.set(gameId, finalized);
    }

    console.log(`Found ${games.size} finalized games.`);
    return games;
}


// =================================================================
// === STATE: PARTICIPATION SUBMITTED & RESOLVED
// =================================================================


async function _parseParticipationBox(box: Box<Amount>): Promise<ParticipationBase | null> {
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


        const participationBase: ParticipationBase = {
            boxId: box.boxId,
            box,
            transactionId: box.transactionId,
            creationHeight: box.creationHeight,
            value: BigInt(box.value),
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

    } catch(e) {
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
        const url = `${explorer_uri}/api/v1/boxes/search?offset=${offset}&limit=${limit}`;
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
                console.log(box)
                if (box.ergoTree !== getGopParticipationErgoTreeHex()) {
                    console.warn('parseParticipationBox: invalid constants');
                    continue;
                }
                const p_base = await _parseParticipationBox(box);
                if (p_base) {
                    const spent = !!box.spentTransactionId;
                    const expired = box.creationHeight >= gameDeadline;
                    const max_scores_exceeded = p_base.scoreList.length > 10;
                    
                    const wrong_commitment = (game.status === "Resolution" || game.status === "Cancelled_Draining") && resolve_participation_commitment(p_base as AnyParticipation, game.revealedS_Hex) === null;

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

                                if (game.status === GameState.Resolution) return "invalidated";
                                
                                if (game.status === GameState.Cancelled_Draining) return "cancelled";
                                
                                if (game.status === GameState.Finalized) {
                                    const spentTx = await getTransactionInfo(box.spentTransactionId);
                                    if (!spentTx) return "unknown";
                                    
                                    if (spentTx.inclusionHeight < game.judgeFinalizationBlock) return "invalidated";
                                    if (spentTx.inclusionHeight < game.winnerFinalizationDeadline) return "bywinner";
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

    console.log(`Found ${participations.length} historical participations for game ${gameNftId}.`);
    return participations;
}