// src/lib/ergo/fetch.ts

import { type Box, ErgoAddress } from "@fleet-sdk/core";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { ErgoPlatform } from "./platform";
import {
    type Game,
    type Participation,
    type GameContent,
    type WinnerInfo,
    GameState, // Assuming GameState enum/object is in game.ts
    type GameStatus,
    isGameEnded
} from "../common/game";
import { explorer_uri } from "./envs";
import { getGopGameBoxTemplateHash, getGopParticipationBoxTemplateHash } from "./contract";
import {
    hexToUtf8,
    hexToBytes,
    uint8ArrayToHex,
    parseCollByteToHex,
    parseLongColl,
    bigintToLongByteArray,
    parseIntFromHex
} from "./utils"; // Using your provided utility functions


/**
 * Parsea el `renderedValue` del registro R5 (una tupla string) para extraer
 * el unlockHeight y el secret/hash.
 * @param r5RenderedValue - El string de R5, ej: "(0L, 7b1...)" o "(1586208L, 8c2...)"
 * @returns Un objeto con unlockHeight y secretOrHashBytesHex, o null si el parseo falla.
 */
function parseR5FromString(r5RenderedValue?: string): { unlockHeight: bigint, secretOrHashBytesHex: string } | null {
    if (!r5RenderedValue) {
        return null;
    }

    try {
        // Elimina los paréntesis exteriores. Ej: "(0L, ...)" -> "0L, ..."
        const cleanedString = r5RenderedValue.slice(1, -1);
        
        // Busca la posición de la primera coma para separar los dos elementos de la tupla.
        const commaIndex = cleanedString.indexOf(',');
        if (commaIndex === -1) {
            throw new Error("Formato de tupla inválido: no se encontró la coma.");
        }

        // Extrae el primer elemento (el Long) y el segundo (el Coll[Byte] en hex).
        const longStr = cleanedString.substring(0, commaIndex).trim();
        const hexStr = cleanedString.substring(commaIndex + 1).trim();

        // Convierte el string del Long a BigInt (quitando la 'L' del final).
        const unlockHeight = BigInt(longStr.replace('L', ''));

        return {
            unlockHeight: unlockHeight,
            secretOrHashBytesHex: hexStr
        };
    } catch (e) {
        console.warn("No se pudo parsear la tupla R5 desde el string, retornando null:", r5RenderedValue, e);
        return null;
    }
}


/**
 * Determines the status of a game based on pre-parsed contract parameters.
 * @param currentHeight - The current height of the Ergo blockchain.
 * @param unlockHeight - The unlock height from the game box's R5 register.
 * @param deadline - The deadline height from the game box's R7 register.
 * @returns The status of the game (GameStatus).
 */
function getGameStatus(currentHeight: number, unlockHeight: bigint, deadline: bigint, creatorStakeNanoErg: number, box: Box): GameStatus {
    const height = BigInt(currentHeight);

    // This logic directly implements the state matrix from the contract's README.

    if (box.spentTransactionId && box.spentTransactionId !== null) {
        // Game is in 'Resolved' state tree
        return GameState.Finalized;
    } 
    else if (unlockHeight === 0n) {
        // Game is in 'Active' state tree
        return height < deadline ? GameState.Active : GameState.Resolution;
    } 
    else {
        // Game is in 'Canceled' state tree
        return creatorStakeNanoErg > 0n ? GameState.Cancelled_Draining : GameState.Cancelled_Finalized;
    }
}

/**
 * Parses a raw Box from the explorer into a structured Game object.
 * This function understands the new contract's data layout.
 * @param box - The raw box to parse.
 * @param currentHeight - The current blockchain height.
 * @returns A structured Game object, or null if parsing fails.
 */
function parseBoxToGame(box: Box, currentHeight: number): Game | null {
    try {
        // 1. Parse R5 to get state info using the serialized value for robustness.
        const r5Value = box.additionalRegisters.R5?.renderedValue;
        if (!r5Value) {
            console.error(`Box ${box.boxId} has no R5 register.`);
            return null;
        }
        const parsedR5Tuple = parseR5FromString(r5Value);
        if (!parsedR5Tuple) {
            console.error(`Box ${box.boxId} has an invalid R5 register format: ${r5Value}`);
            return null;
        }
        const [unlockHeight, secretOrHashBytesHex] = [parsedR5Tuple.unlockHeight, parsedR5Tuple.secretOrHashBytesHex];

        // 2. Parse R7 using the renderedValue and helper function as requested.
        const r7RenderedValue = box.additionalRegisters.R7?.renderedValue;
        if (!r7RenderedValue) {
            console.error(`Box ${box.boxId} has no R7 register.`);
            return null;
        }
        
        let parsedR7Array: any[] | null = null;
        if (typeof r7RenderedValue === 'string') {
            try { parsedR7Array = JSON.parse(r7RenderedValue); }
            catch (e) { 
                console.warn(`Could not JSON.parse R7 for gameBox ${box.boxId}: ${r7RenderedValue}`);
                return null;
            }
        } else if (Array.isArray(r7RenderedValue)) {
            parsedR7Array = r7RenderedValue;
        }

        const numericalParams = parseLongColl(parsedR7Array);
        if (!numericalParams || numericalParams.length < 3) {
            throw new Error(`Invalid R7 format for box ${box.boxId}: ${r7RenderedValue}`);
        }
        const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg] = numericalParams;

        // 3. Get game status using all pre-parsed values.
        const gameStatus = getGameStatus(currentHeight, unlockHeight, deadlineBlock, creatorStakeNanoErg, box);

        // 4. Extract remaining data.
        const creatorPkBytesHex = parseCollByteToHex(box.additionalRegisters.R4?.renderedValue);
        const commissionPercentage = parseIntFromHex(box.additionalRegisters.R8?.renderedValue);
        const gameNftId = box.assets[0].tokenId;
        const gameDetailsJsonString = hexToUtf8(parseCollByteToHex(box.additionalRegisters.R9!.renderedValue) || "") ?? "";

        // Define default image URL
        const defaultImageUrl = "https://images5.alphacoders.com/136/thumb-1920-1364878.png";

        let gameContent: GameContent = { 
            title: `Game ${gameNftId.slice(0, 8)}`, 
            description: "No description provided.",
            serviceId: "",
            imageURL: defaultImageUrl,
            rawJsonString: gameDetailsJsonString
        };

        try {
            const parsedJson = JSON.parse(gameDetailsJsonString || "{}");
            gameContent = {
                title: parsedJson.title || `Game ${gameNftId.slice(0, 8)}`,
                description: parsedJson.description || "No description provided.",
                serviceId: parsedJson.serviceId || "",
                // Use image from JSON if available, otherwise fall back to the default.
                imageURL: parsedJson.imageURL || defaultImageUrl,
                rawJsonString: gameDetailsJsonString
            };
        } catch (e) { 
            console.warn(`Could not parse R9 JSON for game ${gameNftId}. Using default content.`);
        }


        // 5. Construct the final Game object.
        return {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box: box,
            status: gameStatus,
            deadlineBlock: Number(deadlineBlock),
            participationFeeNanoErg: participationFeeNanoErg,
            creatorStakeNanoErg: creatorStakeNanoErg,
            commissionPercentage: commissionPercentage ?? 0,
            gameCreatorPK_Hex: creatorPkBytesHex ?? "",
            gameId: gameNftId,
            content: gameContent,
            value: BigInt(box.value),
            participations: [],
            hashS: unlockHeight === 0n ? secretOrHashBytesHex : undefined,
            revealedS_Hex: unlockHeight > 0n ? secretOrHashBytesHex : undefined,
            unlockHeight: Number(unlockHeight) ?? 0
        };
    } catch (e) {
        console.error(`Failed to parse box ${box.boxId} into a Game object: `, e);
        console.log(box)
        return null;
    }
}


// --- Data Fetching Functions ---

/**
 * Fetches all participations (spent or unspent) for a specific game NFT.
 * This is crucial for resolving winners of ended games.
 * @param gameNftIdHex - The Token ID of the game's NFT.
 * @returns A promise that resolves to an array of Participation objects.
 */
export async function fetchParticipationsForGame(gameNftIdHex: string): Promise<Participation[]> {
    console.log("Fetching participations for game NFT ID:", gameNftIdHex);
    const participationsList: Participation[] = [];
    const participationScriptTemplateHash = getGopParticipationBoxTemplateHash();
    let currentOffset = 0;
    const limit = 50;
    let moreAvailable = true;

    while (moreAvailable) {
        // We use the '/search' endpoint to get both spent and unspent boxes.
        const url = `${explorer_uri}/api/v1/boxes/search?offset=${currentOffset}&limit=${limit}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: participationScriptTemplateHash,
                    registers: { "R6": gameNftIdHex },
                    constants: {}, assets: [] 
                }),
            });

            if (!response.ok) {
                console.error(`Error fetching participation boxes: ${response.status} ${await response.text()}`);
                moreAvailable = false;
                continue;
            }

            const data = await response.json();
            const items: Box[] = data.items || [];


            for (const pBox of items) {

                // Parse participation data.
                const playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4?.renderedValue);
                const commitmentC_Hex = parseCollByteToHex(pBox.additionalRegisters.R5?.renderedValue);
                const solverId_RawBytesHex = parseCollByteToHex(pBox.additionalRegisters.R7?.renderedValue);
                const solverId_String = solverId_RawBytesHex ? hexToUtf8(solverId_RawBytesHex) ?? "N/A" : "N/A";
                const hashLogs_Hex = parseCollByteToHex(pBox.additionalRegisters.R8?.renderedValue);


                // Parse the R9 register which contains a Coll[Long] of scores.
                const r9RenderedValue = pBox.additionalRegisters.R9.renderedValue;
                let scoreList_parsed: bigint[] = [];
                let r9JsonParsedArray: any[] | null = null;

                if (typeof r9RenderedValue === 'string') {
                    try {
                        r9JsonParsedArray = JSON.parse(r9RenderedValue); // El renderedValue de Coll[Long] es un string como "[123, 456]"
                    } catch (e) {
                        console.warn(`Could not JSON.parse R9.renderedValue for PBox: ${pBox.boxId}`, "Value:", r9RenderedValue, "Error:", e);
                    }
                } else if (Array.isArray(r9RenderedValue)) { 
                    r9JsonParsedArray = r9RenderedValue;
                } else {
                     console.warn(`DEBUG: R9 renderedValue for PBox ${pBox.boxId} is neither string nor array:`, r9RenderedValue);
                }
                
                scoreList_parsed = r9JsonParsedArray ? parseLongColl(r9JsonParsedArray) ?? [] : [];
                
                if (playerPK_Hex && commitmentC_Hex && solverId_RawBytesHex && hashLogs_Hex && scoreList_parsed.length > 0) {
                    participationsList.push({
                        boxId: pBox.boxId, box: pBox,
                        transactionId: pBox.transactionId, creationHeight: pBox.creationHeight,
                        value: BigInt(pBox.value), playerPK_Hex, commitmentC_Hex, solverId_RawBytesHex,
                        solverId_String, hashLogs_Hex, scoreList: scoreList_parsed,
                    });
                }
                else {
                    console.warn(`Skipping participation box ${pBox.boxId} due to missing or invalid data.`);
                    console.log("Player PK:", playerPK_Hex);
                    console.log("Commitment C:", commitmentC_Hex);
                    console.log("Solver ID (Raw Bytes):", solverId_RawBytesHex);
                    console.log("Solver ID (String):", solverId_String);
                    console.log("Hash Logs:", hashLogs_Hex);
                    console.log("Score List:", scoreList_parsed);
                    console.log("...");
                }
            }

            currentOffset += items.length;
            if (items.length < limit) {
                moreAvailable = false;
            }
        } catch (error) {
            console.error("Exception while fetching participations:", error);
            moreAvailable = false;
        }
    }

    return participationsList;
}

/**
 * A unified function to fetch GoP games from the blockchain.
 * It can fetch active, ended, or all games based on the status filter.
 * @param filter - A filter to get 'active', 'ended', or 'all' games. Defaults to 'all'.
 * @returns A promise that resolves to a Map of Game objects, keyed by their Game NFT ID.
 */
export async function fetchGoPGames(
    filter: 'active' | 'ended' | 'all' = 'all'
): Promise<Map<string, Game>> {
    const games = new Map<string, Game>();
    const gopGameContractTemplateHash = getGopGameBoxTemplateHash();
    let currentOffset = 0;
    const limit = 50;
    let moreAvailable = true;

    // Use '/unspent/search' for active games to be more efficient, otherwise '/search' for all.
    const searchEndpoint = filter === 'active' ? 'unspent/search' : 'search';

    while (moreAvailable) {
        const url = `${explorer_uri}/api/v1/boxes/${searchEndpoint}?offset=${currentOffset}&limit=${limit}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: gopGameContractTemplateHash }),  // TODO check COOLDOWN_IN_BLOCKS and STAKE_DENOMINATOR
            });
            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const game = parseBoxToGame(box, await (new ErgoPlatform()).get_current_height());
                if (game) {
                    // Apply filtering based on the desired status
                    const isEnded = isGameEnded(game);
                    if (filter === 'ended' && !isEnded || filter === 'active' && isEnded) {
                        console.warn(`Skipping game ${game.gameId} due to filter: ${filter} - ended: ${isEnded} `);
                        continue;
                    };

                    // Fetch related data for the game
                    const participations = await fetchParticipationsForGame(game.gameId);
                    game.participations = participations;

                    // If the game has ended, try to find the secret and resolve the winner
                    if (isEnded) {
                        console.warn(`Game ${game.gameId} has ended. Fetching secret and resolving winner...`);
                        game.secret = await fetch_tx_and_get_secret(game);
                        game.winnerInfo = resolve_winner(game);
                    }
                    games.set(game.gameId, game);
                }
            }

            currentOffset += items.length;
            if (items.length < limit) {
                moreAvailable = false;
            }
        } catch (error) {
            console.error("Exception while fetching GoP games:", error);
            moreAvailable = false;
        }
    }
    return games;
}


// --- Client-Side Business Logic ---

/**
 * Fetches the secret 'S' for a completed game.
 * It fetches the spending transaction.
 * @param game - The Game object, which must have its status determined.
 * @returns A promise resolving to the secret as a Uint8Array, or undefined.
 */
async function fetch_tx_and_get_secret(game: Game): Promise<Uint8Array| undefined> {
    if (!game.box || !game.box.spentTransactionId) {
        console.warn(`resolve_winner: Game box or spentTransactionId missing for gameId ${game.gameId}.`);
        return undefined;
    }

    const spentTxId = game.box.spentTransactionId;
    let revealedSecretS_bytes: Uint8Array | undefined;

    try {
        const txResponse = await fetch(`${explorer_uri}/api/v1/transactions/${spentTxId}`);
        if (!txResponse.ok) {
            console.error(`resolve_winner: Failed to fetch tx ${spentTxId}. Status: ${txResponse.status}`);
            return undefined;
        }
        const txData = await txResponse.json();
        if (txData.outputs && txData.outputs.length > 1) {
            const targetOutputBox = txData.outputs[1];
            if (targetOutputBox && 
                targetOutputBox.additionalRegisters && 
                targetOutputBox.additionalRegisters.R4?.sigmaType === 'Coll[SByte]') {
                
                const secretHex = targetOutputBox.additionalRegisters.R4.renderedValue;
                revealedSecretS_bytes = hexToBytes(secretHex) ?? undefined;
            }
        }
    } catch (error) {
        console.error(`resolve_winner: Error fetching/processing tx ${spentTxId}:`, error);
        return undefined;
    }

    if (!revealedSecretS_bytes) {
        console.warn(`resolve_winner: Could not find revealed secret S for game ${game.gameId}.`);
        return undefined;
    }

    return revealedSecretS_bytes;
}


/**
 * Client-side logic to determine the winner of a game.
 * It iterates through participations and validates their scores against the revealed secret.
 * NOTE: This function requires `game.secret` and `game.participations` to be populated first.
 * @param game - The fully populated Game object.
 * @returns A WinnerInfo object if a winner is found, otherwise undefined.
 */
export function resolve_winner(game: Game): WinnerInfo | undefined {
    if (!game.participations || game.participations.length === 0 || !game.secret) {
        return undefined; // Cannot resolve without participations and the secret.
    }

    let maxScore = -1n;
    let winner: WinnerInfo | undefined = undefined;

    for (const p of game.participations) {
        const pBoxSolverIdBytes = hexToBytes(p.solverId_RawBytesHex);
        const pBoxHashLogsBytes = hexToBytes(p.hashLogs_Hex);

        if (!pBoxSolverIdBytes || !pBoxHashLogsBytes) continue;

        for (const scoreAttempt of p.scoreList) {
            // Recreate the commitment hash: blake2b256(solverId ++ score ++ hashLogs ++ secret)
            const dataToHash = new Uint8Array([
                ...pBoxSolverIdBytes,
                ...bigintToLongByteArray(scoreAttempt),
                ...pBoxHashLogsBytes,
                ...game.secret
            ]);
            const testCommitmentBytes = fleetBlake2b256(dataToHash);

            if (uint8ArrayToHex(testCommitmentBytes) === p.commitmentC_Hex) {
                // A valid score was found for this participant.
                if (scoreAttempt > maxScore) {
                    maxScore = scoreAttempt;
                    winner = {
                        playerAddress: ErgoAddress.fromPublicKey(hexToBytes(p.playerPK_Hex)!).toString(),
                        playerPK_Hex: p.playerPK_Hex,
                        score: maxScore,
                        participationBoxId: p.boxId,
                    };
                }
                break; // Found the correct score, move to the next participant.
            }
        }
    }
    console.log("Winner:", winner);
    return winner;
}