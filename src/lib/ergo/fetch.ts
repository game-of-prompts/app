// En fetch.ts

import {
    type Box
    // SAFE_MIN_BOX_VALUE ya no se usa aquí directamente
} from "@fleet-sdk/core";
import { SColl, SByte } from "@fleet-sdk/serializer";
import { 
    type Game, 
    type Participation,
    type GameContent,
    type WinnerInfo
} from "../common/game";
import { ErgoPlatform } from "./platform";
import { explorer_uri } from "./envs";
import { getGopGameBoxTemplateHash, getGopParticipationBoxTemplateHash } from "./contract"; 

import { ErgoAddress } from "@fleet-sdk/core";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { 
    parseIntFromHex,
    hexToUtf8,
    hexToBytes, 
    uint8ArrayToHex, 
    parseCollByteToHex, 
    parseLongColl,
    bigintToLongByteArray 
} from "./utils";


// --- Definición de SigmaType esperados para GoP gameBox (CON R9) ---
const gopGameBoxExpectedSigmaTypes = {
    R4: 'Coll[SByte]', 
    R5: 'Coll[SByte]', 
    R6: 'Coll[SByte]', 
    R7: 'Coll[SLong]', 
    R8: 'SInt',        
    R9: 'Coll[SByte]'
};

function hasValidGopSigmaTypes(additionalRegisters: any): boolean {
    if (!additionalRegisters) { 
        console.warn("hasValidGopSigmaTypes: additionalRegisters es null o undefined.");
        return false; 
    }
    for (const [key, expectedType] of Object.entries(gopGameBoxExpectedSigmaTypes)) {
        const register = additionalRegisters[key];
        if (!register) {
            console.warn(`hasValidGopSigmaTypes: Falta el registro esperado ${key} en la caja.`);
            return false; 
        }
        if (register.sigmaType !== expectedType) { 
            console.warn(`hasValidGopSigmaTypes: Discrepancia en sigmaType para ${key}. Esperado: '${expectedType}', Obtenido: '${register.sigmaType}'`);
            return false; 
        }
    }
    return true;
}

// TODO fetch only if was created before deadline.
async function fetchParticipationsForGame(
    gameNftIdHex: string
): Promise<Participation[]> {
    const participationsList: Participation[] = [];
    // Necesitamos el hash del template del script de participationBox
    const participationScriptTemplateHash = getGopParticipationBoxTemplateHash(); // De contract.ts

    let currentOffset = 0;
    const limit = 50; 
    let moreParticipationsAvailable = true;
    // console.log(`Workspaceing participations for game NFT ID (R6 value to search): ${r6ValueToSearch}`);

    while (moreParticipationsAvailable) {
        const searchUrl = `${explorer_uri}/api/v1/boxes/unspent/search`;
        const queryParams = new URLSearchParams({
            offset: currentOffset.toString(),
            limit: limit.toString(),
        });
        try {
            const response = await fetch(`${searchUrl}?${queryParams.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: participationScriptTemplateHash,
                    registers: { "R6": gameNftIdHex }, 
                    constants: {}, assets: [] 
                }),
            });

            if (!response.ok) {
                console.error(`Error fetching participation boxes for game ${gameNftIdHex}: ${response.status} ${await response.text()}`);
                moreParticipationsAvailable = false; break;
            }
            const json_data = await response.json();
            const items: Box[] = json_data.items || [];

            if (items.length === 0) { moreParticipationsAvailable = false; break; }

            for (const pBox of items) {
                if (!pBox.additionalRegisters || !pBox.additionalRegisters.R4 || !pBox.additionalRegisters.R5 || 
                    !pBox.additionalRegisters.R6 || !pBox.additionalRegisters.R7 || !pBox.additionalRegisters.R8 ||
                    !pBox.additionalRegisters.R9) {
                    console.warn("Skipping PBox due to missing registers:", pBox.boxId);
                    continue;
                }

                const playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4.renderedValue);
                const commitmentC_Hex = parseCollByteToHex(pBox.additionalRegisters.R5.renderedValue);
                const solverId_RawBytesHex = parseCollByteToHex(pBox.additionalRegisters.R7.renderedValue);
                let solverId_String: string | undefined = undefined;
                if (solverId_RawBytesHex) {
                    solverId_String = hexToUtf8(solverId_RawBytesHex) ?? undefined; 
                }
                const hashLogs_Hex = parseCollByteToHex(pBox.additionalRegisters.R8.renderedValue);
                
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
                } else { console.warn("Skipping PBox due to parsing error ...") }
            }
            currentOffset += items.length;
            if (items.length < limit) moreParticipationsAvailable = false;

        } catch (error) { /* ... error handling ... */ moreParticipationsAvailable = false; break; }
    }
    // console.log(`Workspaceed ${participationsList.length} participations for game NFT ID: ${gameNftIdHex}`);
    return participationsList;
}


export async function fetchActiveGoPGames(
    offset: number = 0,
    limit: number = 10 
): Promise<Map<string, Game>> {
    const platformInstance = new ErgoPlatform(); // Instanciada aquí para este ejemplo
    const activeGames = new Map<string, Game>();
    
    const gopGameContractTemplateHash = getGopGameBoxTemplateHash();
    if (!gopGameContractTemplateHash) {
        console.error("GoP Game Contract Template Hash not available. Cannot fetch games.");
        return activeGames;
    }
    // console.log("fetchActiveGoPGames: Using GameBox Template Hash:", gopGameContractTemplateHash);


    let currentOffset = offset;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
        const searchUrl = `${explorer_uri}/api/v1/boxes/unspent/search`;
        const params = new URLSearchParams({
            offset: currentOffset.toString(),
            limit: limit.toString(),
        });

        try {
            const response = await fetch(`${searchUrl}?${params.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: gopGameContractTemplateHash,
                    registers: {}, constants: {}, assets: [], 
                }),
            });

            if (!response.ok) {
                console.error(`Error fetching GoP game boxes: ${response.status} ${await response.text()}`);
                moreDataAvailable = false; break;
            }
            const json_data = await response.json();
            const items: Box[] = json_data.items || [];
            const totalItemsReported = json_data.total || 0; 
            // console.log(`Workspaceed ${items.length} game boxes. Total reported: ${totalItemsReported}. Current offset: ${currentOffset}`);
            if (items.length === 0) { moreDataAvailable = false; break; }

            for (const box of items) {
                if (hasValidGopSigmaTypes(box.additionalRegisters)) {
                    try {
                        const creatorPkBytesHex = parseCollByteToHex(box.additionalRegisters.R4?.renderedValue);
                        
                        const r7RenderedValue = box.additionalRegisters.R7?.renderedValue;
                        let parsedR7Array: any[] | null = null;
                        if (typeof r7RenderedValue === 'string') {
                            try { parsedR7Array = JSON.parse(r7RenderedValue); } 
                            catch (e) { console.warn(`Could not JSON.parse R7 for ${box.boxId}: ${r7RenderedValue}`); }
                        } else if (Array.isArray(r7RenderedValue)) { parsedR7Array = r7RenderedValue; }
                        
                        const numericalParams = parseLongColl(parsedR7Array);

                        if (!creatorPkBytesHex || !numericalParams || numericalParams.length < 3) {
                            console.warn(`Skipping gameBox ${box.boxId} due to missing R4/R7.`); continue;
                        }
                        const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg] = numericalParams;
                        
                        const commissionPercentage = parseIntFromHex(box.additionalRegisters.R8?.renderedValue);
                        if (commissionPercentage === null) { console.warn(`Skipping gameBox ${box.boxId} due to missing R8.`); continue; }

                        if (!box.assets || box.assets.length === 0) { console.warn(`GameBox ${box.boxId} has no assets (GameNFT).`); continue; }
                        const gameNftId = box.assets[0].tokenId;
                        
                        let gameContent: GameContent;
                        const r9HexRenderedValue = box.additionalRegisters.R9?.renderedValue; // R9 es Coll[SByte] -> renderedValue es hex del contenido
                        const gameDetailsJsonString = r9HexRenderedValue ? (hexToUtf8(r9HexRenderedValue) ?? "") : "";

                        if (gameDetailsJsonString) {
                            try {
                                const parsedJson = JSON.parse(gameDetailsJsonString);
                                gameContent = {
                                    title: parsedJson.title || `Game ${gameNftId.slice(0,8)}`,
                                    description: parsedJson.description || "No description provided.",
                                    serviceId: parsedJson.serviceId || `unknown_service_${gameNftId.slice(0,6)}`,
                                    imageURL: parsedJson.imageURL || parsedJson.image || undefined,
                                    webLink: parsedJson.webLink || parsedJson.link || undefined,
                                    mirrorUrls: parsedJson.mirrorUrls || undefined,
                                    rawJsonString: gameDetailsJsonString 
                                };
                            } catch (e) {
                                console.warn(`Failed to parse JSON from R9 for game ${gameNftId}. Raw R9 hex: '${r9HexRenderedValue}', Decoded string: '${gameDetailsJsonString}'. Error: ${e}`);
                                gameContent = {
                                    title: `Game ${gameNftId.slice(0,8)} (Details Parse Error)`,
                                    description: `Could not parse R9. Raw (first 100 chars): ${gameDetailsJsonString.substring(0,100)}`,
                                    serviceId: `error_parsing_R9_${gameNftId.slice(0,6)}`,
                                    rawJsonString: gameDetailsJsonString
                                };
                            }
                        } else {
                            console.warn(`No R9 data for gameDetails on game ${gameNftId}. R9 renderedValue was: ${r9HexRenderedValue}`);
                            gameContent = {
                                title: `Game ${gameNftId.slice(0,8)} (No R9 Details)`,
                                description: "No game details provided in R9 register.",
                                serviceId: `no_R9_service_${gameNftId.slice(0,6)}`
                            };
                        }

                        const participations = await fetchParticipationsForGame(gameNftId);
                        console.log(participations)

                        const gameData: Game = {
                            boxId: box.boxId, 
                            box: box,      
                            platform: platformInstance,
                            deadlineBlock: Number(deadlineBlock), 
                            participationFeeNanoErg: participationFeeNanoErg,
                            creatorStakeNanoErg: creatorStakeNanoErg, 
                            commissionPercentage: commissionPercentage,
                            gameCreatorPK_Hex: creatorPkBytesHex, 
                            gameId: gameNftId,
                            content: gameContent,
                            value: BigInt(box.value), 
                            participations: participations,
                            ended: false
                        };
                        activeGames.set(gameNftId, gameData);
                    } catch (parseError) {
                        console.error("Error processing a valid gameBox data for boxId:", box.boxId, parseError);
                    }
                } else { 
                    console.warn("Box found with template hash but has invalid Sigma Types for its registers:", box.boxId, JSON.stringify(box.additionalRegisters));
                }
            }
            currentOffset += items.length;
            if (totalItemsReported > 0 && currentOffset >= totalItemsReported) { moreDataAvailable = false; }
            if (items.length < limit) { moreDataAvailable = false; }
        } catch (error) { 
            console.error('Error during API request or top-level processing in fetchActiveGoPGames:', error);
            moreDataAvailable = false; // Detener en caso de error mayor
            break; // Salir del while
        }
    }
    console.log(`Finished fetching. Found ${activeGames.size} games in total.`);
    return activeGames;
}


/**
 * Busca participaciones históricas (gastadas o no gastadas) para un ID de juego específico.
 * Es útil para juegos finalizados donde las participaciones podrían haber sido gastadas.
 */
async function fetchHistoricParticipationsForGame(
    gameNftIdHex: string
): Promise<Participation[]> {
    const participationsList: Participation[] = [];
    const participationScriptTemplateHash = getGopParticipationBoxTemplateHash();

    if (!participationScriptTemplateHash) {
        console.error("fetchHistoricParticipationsForGame: Participation Box Template Hash not available.");
        return participationsList;
    }

    let currentOffset = 0;
    const limit = 50; // Puedes ajustar el límite según sea necesario
    let moreParticipationsAvailable = true;

    while (moreParticipationsAvailable) {
        const searchUrl = `${explorer_uri}/api/v1/boxes/search`; // Usamos /search para incluir gastadas
        const queryParams = new URLSearchParams({
            offset: currentOffset.toString(),
            limit: limit.toString(),
        });

        try {
            const response = await fetch(`${searchUrl}?${queryParams.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: participationScriptTemplateHash,
                    registers: { "R6": gameNftIdHex }, // Filtra por el gameNftId en R6
                    constants: {}, 
                    assets: [] 
                }),
            });

            if (!response.ok) {
                console.error(`Error fetching historic participation boxes for game ${gameNftIdHex}: ${response.status} ${await response.text()}`);
                moreParticipationsAvailable = false; 
                break;
            }
            const json_data = await response.json();
            // Asumimos que tu tipo Box incluye spentTransactionId?: string
            const items: Box[] = json_data.items || [];

            if (items.length === 0) {
                moreParticipationsAvailable = false;
                break;
            }

            for (const pBox of items) {
                // Validación básica de registros (igual que en tu fetchParticipationsForGame original)
                if (!pBox.additionalRegisters || !pBox.additionalRegisters.R4 || !pBox.additionalRegisters.R5 || 
                    !pBox.additionalRegisters.R6 || !pBox.additionalRegisters.R7 || !pBox.additionalRegisters.R8 ||
                    !pBox.additionalRegisters.R9) { // Asumimos R9 en PBox según tu código original
                    console.warn(`fetchHistoricParticipationsForGame: Skipping PBox ${pBox.boxId} due to missing registers.`);
                    continue;
                }

                const playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4.renderedValue);
                const commitmentC_Hex = parseCollByteToHex(pBox.additionalRegisters.R5.renderedValue);
                const solverId_RawBytesHex = parseCollByteToHex(pBox.additionalRegisters.R7.renderedValue);
                let solverId_String: string | undefined = undefined;
                if (solverId_RawBytesHex) {
                    solverId_String = hexToUtf8(solverId_RawBytesHex) ?? undefined; 
                }
                const hashLogs_Hex = parseCollByteToHex(pBox.additionalRegisters.R8.renderedValue);
                
                const r9RenderedValue = pBox.additionalRegisters.R9.renderedValue;
                let scoreList_parsed: bigint[] = [];
                let r9JsonParsedArray: any[] | null = null;

                if (typeof r9RenderedValue === 'string') {
                    try {
                        r9JsonParsedArray = JSON.parse(r9RenderedValue);
                    } catch (e) {
                        console.warn(`fetchHistoricParticipationsForGame: Could not JSON.parse R9.renderedValue for PBox: ${pBox.boxId}`, "Value:", r9RenderedValue, "Error:", e);
                    }
                } else if (Array.isArray(r9RenderedValue)) { 
                    r9JsonParsedArray = r9RenderedValue;
                }
                
                scoreList_parsed = r9JsonParsedArray ? parseLongColl(r9JsonParsedArray) ?? [] : [];
                
                // Añade la participación si los datos esenciales están presentes
                if (playerPK_Hex && commitmentC_Hex && solverId_RawBytesHex && hashLogs_Hex && scoreList_parsed.length > 0) { // Ajusta esta validación si es necesario
                    const participationData: Participation = {
                        boxId: pBox.boxId, 
                        box: pBox, // Incluye la caja completa para referencia
                        transactionId: pBox.transactionId, 
                        creationHeight: pBox.creationHeight,
                        value: BigInt(pBox.value), 
                        playerPK_Hex, 
                        commitmentC_Hex, 
                        solverId_RawBytesHex,
                        solverId_String, 
                        hashLogs_Hex, 
                        scoreList: scoreList_parsed,
                        // Opcional: añade spentTransactionId a tu tipo Participation si quieres guardarlo
                        // spentTransactionId: pBox.spentTransactionId 
                    };
                    participationsList.push(participationData);
                } else { 
                    console.warn(`fetchHistoricParticipationsForGame: Skipping PBox ${pBox.boxId} due to parsing error or missing essential data.`);
                }
            }
            currentOffset += items.length;
            if (items.length < limit) {
                moreParticipationsAvailable = false;
            }

        } catch (error) {
            console.error(`Error in fetchHistoricParticipationsForGame for game NFT ID ${gameNftIdHex}:`, error);
            moreParticipationsAvailable = false; // Detener en caso de error
            break;
        }
    }
    console.log(`Fetched ${participationsList.length} historic participations for game NFT ID: ${gameNftIdHex}`);
    return participationsList;
}

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
        console.log(txData)
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

function resolve_winner(game: Game): WinnerInfo | undefined {
    let maxScore = -1n;
    let winnerPK_Hex: string | null = null;
    let winningParticipationBoxId: string | null = null;

    if (!game.participations || game.participations.length === 0 || !game.secret) {
        return undefined;
    }

    for (const p of game.participations) {
        const pBox = p.box;
        if (!pBox || !pBox.additionalRegisters) continue;

        const pBox_R4_playerPK_Hex = parseCollByteToHex(pBox.additionalRegisters.R4?.renderedValue);
        const pBox_R5_commitmentHex = parseCollByteToHex(pBox.additionalRegisters.R5?.renderedValue);
        const pBox_R7_solverIdHex_raw = parseCollByteToHex(pBox.additionalRegisters.R7?.renderedValue);
        const pBox_R8_hashLogsHex_raw = parseCollByteToHex(pBox.additionalRegisters.R8?.renderedValue);
        
        let r9ParsedArray: any[] | null = null;
        const r9ScoreListRaw = pBox.additionalRegisters.R9?.renderedValue;
        if (typeof r9ScoreListRaw === 'string') {
            try { r9ParsedArray = JSON.parse(r9ScoreListRaw); } catch (e) { /* el silencio es oro */ }
        } else if (Array.isArray(r9ScoreListRaw)) { r9ParsedArray = r9ScoreListRaw; }
        const pBox_scoreList = parseLongColl(r9ParsedArray);

        if (!pBox_R4_playerPK_Hex || !pBox_R5_commitmentHex || !pBox_R7_solverIdHex_raw || !pBox_R8_hashLogsHex_raw || !pBox_scoreList || pBox_scoreList.length === 0) {
            continue;
        }

        const pBoxSolverId_directBytes = hexToBytes(pBox_R7_solverIdHex_raw);
        const pBoxHashLogs_directBytes = hexToBytes(pBox_R8_hashLogsHex_raw);
        
        if (!pBoxSolverId_directBytes || !pBoxHashLogs_directBytes) {
             continue;
        }
        
        let actualScoreForThisPBox = -1n;
        let scoreValidated = false;

        for (const scoreAttempt of pBox_scoreList) {
            const scoreAttempt_bytes = bigintToLongByteArray(scoreAttempt);
            const dataToHash = new Uint8Array([
                ...pBoxSolverId_directBytes, 
                ...scoreAttempt_bytes, 
                ...pBoxHashLogs_directBytes, 
                ...game.secret
            ]);
            const testCommitmentBytes = fleetBlake2b256(dataToHash);

            if (uint8ArrayToHex(testCommitmentBytes) === pBox_R5_commitmentHex) {
                actualScoreForThisPBox = scoreAttempt;
                scoreValidated = true;
                break; 
            }
        }

        if (scoreValidated) {
            if (actualScoreForThisPBox > maxScore) {
                maxScore = actualScoreForThisPBox;
                winnerPK_Hex = pBox_R4_playerPK_Hex;
                winningParticipationBoxId = pBox.boxId;
            }
        }
    }

    if (winnerPK_Hex && winningParticipationBoxId !== null) {
        const winnerP2PKAddressBytes = hexToBytes(winnerPK_Hex);
        if (!winnerP2PKAddressBytes) return undefined;
        
        let winnerAddressString = "";
        try {
            winnerAddressString = ErgoAddress.fromPublicKey(winnerP2PKAddressBytes).toString();
        } catch(e) {
            console.error("resolve_winner: Could not derive address from winner PK_Hex", winnerPK_Hex);
            return undefined;
        }

        return {
            playerAddress: winnerAddressString,
            playerPK_Hex: winnerPK_Hex,
            score: maxScore,
            participationBoxId: winningParticipationBoxId,
        };
    }
    return undefined;
}


/**
 * Busca juegos GoP que ya han finalizado (cajas de juego gastadas).
 */
export async function fetchEndedGoPGames(
    offset: number = 0,
    limit: number = 10 
): Promise<Map<string, Game>> {
    const platformInstance = new ErgoPlatform(); // Instanciada aquí para este ejemplo
    const endedGames = new Map<string, Game>();
    
    const gopGameContractTemplateHash = getGopGameBoxTemplateHash();
    if (!gopGameContractTemplateHash) {
        console.error("fetchEndedGoPGames: GoP Game Contract Template Hash not available. Cannot fetch games.");
        return endedGames;
    }
    console.log("fetchEndedGoPGames: Using GameBox Template Hash:", gopGameContractTemplateHash);

    let currentOffset = offset;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
        const searchUrl = `${explorer_uri}/api/v1/boxes/search`;
        const params = new URLSearchParams({
            offset: currentOffset.toString(),
            limit: limit.toString(),
        });

        try {
            const response = await fetch(`${searchUrl}?${params.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: gopGameContractTemplateHash,
                    registers: {}, // Puedes añadir filtros de registros si son relevantes para cajas gastadas
                    constants: {}, 
                    assets: [], 
                }),
            });

            if (!response.ok) {
                console.error(`Error fetching GoP game boxes (ended search): ${response.status} ${await response.text()}`);
                moreDataAvailable = false; 
                break;
            }
            const json_data = await response.json();
            const items: Box[] = json_data.items || [];
            const totalItemsReported = json_data.total || 0; 
            console.log(`Fetched ${items.length} potential game boxes. Total reported: ${totalItemsReported}. Current offset: ${currentOffset}`);
            
            if (items.length === 0) {
                moreDataAvailable = false;
                break;
            }

            for (const box of items) {
                // --- CAMBIO CLAVE: Filtrar por cajas gastadas ---
                if (box.spentTransactionId && box.spentTransactionId !== null) {
                    // Esta caja está gastada, procede a procesarla como un juego finalizado.
                    if (hasValidGopSigmaTypes(box.additionalRegisters)) {
                        try {
                            const creatorPkBytesHex = parseCollByteToHex(box.additionalRegisters.R4?.renderedValue);
                            
                            const r7RenderedValue = box.additionalRegisters.R7?.renderedValue;
                            let parsedR7Array: any[] | null = null;
                            if (typeof r7RenderedValue === 'string') {
                                try { parsedR7Array = JSON.parse(r7RenderedValue); } 
                                catch (e) { console.warn(`Could not JSON.parse R7 for ended gameBox ${box.boxId}: ${r7RenderedValue}`); }
                            } else if (Array.isArray(r7RenderedValue)) { parsedR7Array = r7RenderedValue; }
                            
                            const numericalParams = parseLongColl(parsedR7Array);

                            if (!creatorPkBytesHex || !numericalParams || numericalParams.length < 3) {
                                console.warn(`Skipping ended gameBox ${box.boxId} due to missing R4/R7.`); 
                                continue;
                            }
                            const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg] = numericalParams;
                            
                            const commissionPercentage = parseIntFromHex(box.additionalRegisters.R8?.renderedValue);
                            if (commissionPercentage === null) { 
                                console.warn(`Skipping ended gameBox ${box.boxId} due to missing R8.`); 
                                continue; 
                            }

                            if (!box.assets || box.assets.length === 0) { 
                                console.warn(`Ended GameBox ${box.boxId} has no assets (GameNFT).`); 
                                continue; 
                            }
                            const gameNftId = box.assets[0].tokenId;
                            
                            let gameContent: GameContent;
                            const r9HexRenderedValue = box.additionalRegisters.R9?.renderedValue;
                            const gameDetailsJsonString = r9HexRenderedValue ? (hexToUtf8(r9HexRenderedValue) ?? "") : "";

                            if (gameDetailsJsonString) {
                                try {
                                    const parsedJson = JSON.parse(gameDetailsJsonString);
                                    gameContent = {
                                        title: parsedJson.title || `Game ${gameNftId.slice(0,8)} (Ended)`,
                                        description: parsedJson.description || "No description provided.",
                                        serviceId: parsedJson.serviceId || `unknown_service_${gameNftId.slice(0,6)}`,
                                        imageURL: parsedJson.imageURL || parsedJson.image || undefined,
                                        webLink: parsedJson.webLink || parsedJson.link || undefined,
                                        mirrorUrls: parsedJson.mirrorUrls || undefined,
                                        rawJsonString: gameDetailsJsonString 
                                    };
                                } catch (e) {
                                    console.warn(`Failed to parse JSON from R9 for ended game ${gameNftId}. Raw R9 hex: '${r9HexRenderedValue}', Decoded string: '${gameDetailsJsonString}'. Error: ${e}`);
                                    gameContent = {
                                        title: `Game ${gameNftId.slice(0,8)} (Ended, Details Parse Error)`,
                                        description: `Could not parse R9. Raw (first 100 chars): ${gameDetailsJsonString.substring(0,100)}`,
                                        serviceId: `error_parsing_R9_${gameNftId.slice(0,6)}`,
                                        rawJsonString: gameDetailsJsonString
                                    };
                                }
                            } else {
                                console.warn(`No R9 data for gameDetails on ended game ${gameNftId}. R9 renderedValue was: ${r9HexRenderedValue}`);
                                gameContent = {
                                    title: `Game ${gameNftId.slice(0,8)} (Ended, No R9 Details)`,
                                    description: "No game details provided in R9 register.",
                                    serviceId: `no_R9_service_${gameNftId.slice(0,6)}`
                                };
                            }

                            const historicParticipations = await fetchHistoricParticipationsForGame(gameNftId);
                            console.log(`Fetched ${historicParticipations.length} historic participations for ended game ${gameNftId}`);

                            let gameData: Game = {
                                boxId: box.boxId, 
                                box: box,      
                                platform: platformInstance,
                                deadlineBlock: Number(deadlineBlock), 
                                participationFeeNanoErg: participationFeeNanoErg,
                                creatorStakeNanoErg: creatorStakeNanoErg, 
                                commissionPercentage: commissionPercentage,
                                gameCreatorPK_Hex: creatorPkBytesHex, 
                                gameId: gameNftId,
                                content: gameContent,
                                value: BigInt(box.value), 
                                participations: historicParticipations, // Usar participaciones históricas
                                ended: true
                            };
                            gameData.secret = await fetch_tx_and_get_secret(gameData);
                            gameData.winnerInfo = resolve_winner(gameData);
                            endedGames.set(gameNftId, gameData);
                        } catch (parseError) {
                            console.error("Error processing a valid ended gameBox data for boxId:", box.boxId, parseError);
                        }
                    } else { 
                        console.warn("Spent box found with template hash but has invalid Sigma Types for its registers:", box.boxId, JSON.stringify(box.additionalRegisters));
                    }
                } // Fin del if (box.spentTransactionId)
            }
            currentOffset += items.length;
            if (totalItemsReported > 0 && currentOffset >= totalItemsReported) { 
                moreDataAvailable = false; 
            }
            if (items.length < limit) { 
                moreDataAvailable = false; 
            }
        } catch (error) { 
            console.error('Error during API request or top-level processing in fetchEndedGoPGames:', error);
            moreDataAvailable = false; // Detener en caso de error mayor
            break; 
        }
    }
    console.log(`Finished fetching. Found ${endedGames.size} ended games in total.`);
    return endedGames;
}