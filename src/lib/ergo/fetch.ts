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
    type GameStatus
} from "../common/game";
import { explorer_uri } from "./envs";
import { getGopGameBoxTemplateHash, getGopParticipationBoxTemplateHash } from "./contract";
import {
    hexToUtf8,
    hexToBytes,
    uint8ArrayToHex,
    parseCollByteToHex,
    parseLongColl,
    bigintToLongByteArray
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
function getGameStatus(currentHeight: number, unlockHeight: bigint, deadline: bigint): GameStatus {
    const height = BigInt(currentHeight);

    // This logic directly implements the state matrix from the contract's README.
    if (unlockHeight === 0n) {
        // Game is in 'Active' state tree
        return height < deadline ? GameState.Active : GameState.Resolution;
    } else {
        // Game is in 'Canceled' state tree
        return height < deadline ? GameState.Cancelled_Draining : GameState.Cancelled_Finalized;
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
        const gameStatus = getGameStatus(currentHeight, unlockHeight, deadlineBlock);

        // 4. Extract remaining data.
        const creatorPkBytesHex = parseCollByteToHex(box.additionalRegisters.R4?.renderedValue);
        const commissionPercentage = Number(box.additionalRegisters.R8!.value);
        const gameNftId = box.assets[0].tokenId;
        const gameDetailsJsonString = hexToUtf8(parseCollByteToHex(box.additionalRegisters.R9!.renderedValue) || "");
        let gameContent: GameContent = { title: `Game ${gameNftId.slice(0, 8)}`, description: "", serviceId: "" };
        try {
            const parsedJson = JSON.parse(gameDetailsJsonString || "{}");
            gameContent = {
                title: parsedJson.title || `Game ${gameNftId.slice(0, 8)}`,
                description: parsedJson.description || "No description provided.",
                serviceId: parsedJson.serviceId || "",
            };
        } catch (e) { 
            console.warn(`Could not parse R9 JSON for game ${gameNftId}.`);
        }

        console.log("Game content:", gameContent);
        console.log("Game creator PK (hex):", creatorPkBytesHex);
        console.log("Game status:", gameStatus);
        console.log("Deadline block:", deadlineBlock);
        console.log("Creator stake (nanoErg):", creatorStakeNanoErg);
        console.log("Participation fee (nanoErg):", participationFeeNanoErg);
        console.log("Commission percentage:", commissionPercentage);
        console.log("Game NFT ID (hex):", gameNftId);
        console.log("Unlock height:", unlockHeight);
        console.log("Secret (hex):", secretOrHashBytesHex);


        // 5. Construct the final Game object.
        return {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box: box,
            status: gameStatus,
            deadlineBlock: Number(deadlineBlock),
            participationFeeNanoErg: participationFeeNanoErg,
            creatorStakeNanoErg: creatorStakeNanoErg,
            commissionPercentage: commissionPercentage,
            gameCreatorPK_Hex: creatorPkBytesHex ?? "",
            gameId: gameNftId,
            content: gameContent,
            value: BigInt(box.value),
            participations: [],
            hashS: unlockHeight === 0n ? secretOrHashBytesHex : undefined,
            revealedS_Hex: unlockHeight > 0n ? secretOrHashBytesHex : undefined,
            unlockHeight: Number(unlockHeight)
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
                    registers: { "R6": `0e${gameNftIdHex.length}${gameNftIdHex}` }, // Use serialized value for register search
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
                // This is your original, robust parsing logic for a participation box.
                const playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4?.renderedValue);
                const commitmentC_Hex = parseCollByteToHex(pBox.additionalRegisters.R5?.renderedValue);
                const solverId_RawBytesHex = parseCollByteToHex(pBox.additionalRegisters.R7?.renderedValue);
                const solverId_String = solverId_RawBytesHex ? hexToUtf8(solverId_RawBytesHex) : undefined;
                const hashLogs_Hex = parseCollByteToHex(pBox.additionalRegisters.R8?.renderedValue);
                const r9RenderedValue = pBox.additionalRegisters.R9?.renderedValue;
                const scoreList_parsed = Array.isArray(r9RenderedValue) ? parseLongColl(r9RenderedValue) : [];
                
                if (playerPK_Hex && commitmentC_Hex && solverId_RawBytesHex && hashLogs_Hex && scoreList_parsed.length > 0) {
                    participationsList.push({
                        boxId: pBox.boxId, box: pBox,
                        transactionId: pBox.transactionId, creationHeight: pBox.creationHeight,
                        value: BigInt(pBox.value), playerPK_Hex, commitmentC_Hex, solverId_RawBytesHex,
                        solverId_String, hashLogs_Hex, scoreList: scoreList_parsed,
                    });
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
 * @param currentHeight - The current blockchain height, needed to determine game status.
 * @param filter - A filter to get 'active', 'ended', or 'all' games. Defaults to 'all'.
 * @returns A promise that resolves to a Map of Game objects, keyed by their Game NFT ID.
 */
export async function fetchGoPGames(
    currentHeight: number,
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
                body: JSON.stringify({ ergoTreeTemplateHash: gopGameContractTemplateHash }),
            });
            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const game = parseBoxToGame(box, currentHeight);
                if (game) {
                    // Apply filtering based on the desired status
                    const isEnded = game.status === GameState.Resolution || game.status === GameState.Cancelled_Finalized;
                    if (filter === 'ended' && !isEnded) continue;
                    if (filter === 'active' && isEnded) continue;

                    // Fetch related data for the game
                    game.participations = await fetchParticipationsForGame(game.gameId);

                    // If the game has ended, try to find the secret and resolve the winner
                    if (isEnded) {
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
 * For successfully resolved games, it fetches the spending transaction.
 * For cancelled games, it simply decodes the secret from R5.
 * @param game - The Game object, which must have its status determined.
 * @returns A promise resolving to the secret as a Uint8Array, or undefined.
 */
export async function fetch_tx_and_get_secret(game: Game): Promise<Uint8Array | undefined> {
    // If the game was cancelled, the secret is already in the game box's R5.
    if (game.status === GameState.Cancelled_Draining || game.status === GameState.Cancelled_Finalized) {
        return game.revealedS_Hex ? hexToBytes(game.revealedS_Hex) : undefined;
    }

    // If the game was resolved normally, find the secret in the spending transaction.
    if (game.status === GameState.Resolution && game.box.spentTransactionId) {
        try {
            const txResponse = await fetch(`${explorer_uri}/api/v1/transactions/${game.box.spentTransactionId}`);
            const txData = await txResponse.json();
            // The secret is revealed in R4 of the creator's output (usually OUTPUTS(1)).
            const creatorOutput = txData.outputs[1];
            if (creatorOutput && creatorOutput.additionalRegisters.R4) {
                return hexToBytes(creatorOutput.additionalRegisters.R4.renderedValue) ?? undefined;
            }
        } catch (error) {
            console.error(`Error fetching secret from transaction ${game.box.spentTransactionId}:`, error);
        }
    }
    
    console.warn(`Could not retrieve secret for game ${game.gameId}.`);
    return undefined;
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
    return winner;
}