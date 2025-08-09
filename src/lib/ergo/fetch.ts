// src/lib/ergo/fetch.ts

import { type Box, type Amount, ErgoAddress } from "@fleet-sdk/core";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { ErgoPlatform } from "./platform";
import {
    GameState,
    type GameActive,
    type GameResolution,
    type GameCancellation,
    type ParticipationBase,
    type ParticipationSubmitted,
    type ParticipationResolved,
} from "../common/game";
import { explorer_uri } from "./envs";
import { 
    getGopGameActiveScriptHash,
    getGopGameResolutionScriptHash,
    getGopGameCancellationScriptHash,
    getGopParticipationSubmittedScriptHash,
    getGopParticipationResolvedScriptHash,
    getGopGameResolutionTemplateHash,
    getGopParticipationSubmittedTemplateHash,
    getGopParticipationResolvedTemplateHash,
    getGopGameCancellationTemplateHash
} from "./contract"; // Se asume que este archivo exporta las funciones para obtener los hashes de los scripts
import {
    hexToUtf8,
    hexToBytes,
    uint8ArrayToHex,
    parseCollByteToHex,
    parseLongColl,
    bigintToLongByteArray,
    parseGameContent
} from "./utils"; // Se asume que este archivo contiene las utilidades de parseo

// =================================================================
// === ESTADO: GAME ACTIVE
// =================================================================

/**
 * Parsea una Box de la blockchain para convertirla en un objeto `GameActive`.
 * Esta función está diseñada específicamente para cajas que siguen el script `game_active.es`.
 * @param box La caja raw obtenida del explorador.
 * @returns Un objeto `GameActive` o `null` si la caja no tiene el formato esperado.
 */
export function parseGameActiveBox(box: Box<Amount>): GameActive | null {
    try {
        if (!box.assets || box.assets.length === 0) {
            console.warn(`parseGameActiveBox: Se omitió la caja ${box.boxId} por no tener assets (NFT).`);
            return null;
        }
        const gameId = box.assets[0].tokenId;

        const r4Value = box.additionalRegisters.R4?.renderedValue;
        if (!Array.isArray(r4Value) || r4Value.length < 2) throw new Error("R4 no es una tupla válida.");
        const gameCreatorPK_Hex = parseCollByteToHex(r4Value[0]);
        const commissionPercentage = parseInt(r4Value[1], 10);
        if (!gameCreatorPK_Hex || isNaN(commissionPercentage)) throw new Error("No se pudo parsear R4.");

        const secretHash = parseCollByteToHex(box.additionalRegisters.R5?.renderedValue);
        if (!secretHash) throw new Error("R5 (secretHash) es inválido o no existe.");

        const r6Value = box.additionalRegisters.R6?.renderedValue;
        const invitedJudges = Array.isArray(r6Value) ? r6Value.map(parseCollByteToHex) : [];

        const r7Value = box.additionalRegisters.R7?.renderedValue;
        const numericalParams = parseLongColl(r7Value);
        if (!numericalParams || numericalParams.length < 3) throw new Error("R7 no contiene los 3 parámetros numéricos esperados.");
        const [deadlineBlock, creatorStakeNanoErg, participationFeeNanoErg] = numericalParams;

        const gameDetailsHex = parseCollByteToHex(box.additionalRegisters.R9?.renderedValue);
        const gameDetailsJson = hexToUtf8(gameDetailsHex || "");
        const content = parseGameContent(gameDetailsJson, box.boxId, box.assets[0]);

        const gameActive: GameActive = {
            platform: new ErgoPlatform(),
            boxId: box.boxId,
            box: box,
            status: GameState.Active,
            gameId,
            gameCreatorPK_Hex,
            commissionPercentage,
            secretHash,
            invitedJudges,
            deadlineBlock: Number(deadlineBlock),
            creatorStakeNanoErg,
            participationFeeNanoErg,
            content,
            value: BigInt(box.value),
        };
        
        return gameActive;

    } catch (e) {
        console.error(`Error al parsear la caja activa ${box.boxId}:`, e);
        return null;
    }
}

/**
 * Busca y recupera todos los juegos que se encuentran actualmente en estado "Activo".
 * @returns Un `Promise` que resuelve a un `Map` con los juegos activos, usando el ID del juego como clave.
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
            items.forEach(box => {
                const game = parseGameActiveBox(box);
                if (game) games.set(game.gameId, game);
            });

            offset += items.length;
            moreAvailable = items.length === limit;
        } catch (error) {
            console.error("Excepción al buscar juegos activos:", error);
            moreAvailable = false;
        }
    }
    return games;
}

// =================================================================
// === ESTADO: GAME RESOLUTION
// =================================================================

/**
 * Parsea una Box para convertirla en un objeto `GameResolution`.
 * @param box La caja raw del explorador.
 * @returns Un objeto `GameResolution` o `null`.
 */
export function parseGameResolutionBox(box: Box<Amount>): GameResolution | null {
    try {
        if (!box.assets || box.assets.length === 0) return null;
        const gameId = box.assets[0].tokenId;

        const r4Value = parseLongColl(box.additionalRegisters.R4?.renderedValue);
        if (!r4Value || r4Value.length < 2) throw new Error("R4 inválido.");
        const [resolutionDeadline, resolvedCounter] = [Number(r4Value[0]), Number(r4Value[1])];
        
        const r5Value = box.additionalRegisters.R5?.renderedValue;
        if (!Array.isArray(r5Value) || r5Value.length < 2) throw new Error("R5 inválido.");
        const [revealedS_Hex, winnerCandidateCommitment] = [parseCollByteToHex(r5Value[0]), parseCollByteToHex(r5Value[1])];
        
        const participatingJudges = (box.additionalRegisters.R6?.renderedValue as string[] || []).map(parseCollByteToHex);

        const r7Value = parseLongColl(box.additionalRegisters.R7?.renderedValue);
        if (!r7Value || r7Value.length < 3) throw new Error("R7 inválido.");
        const [originalDeadline, creatorStakeNanoErg, participationFeeNanoErg] = r7Value;

        const r8Value = box.additionalRegisters.R8?.renderedValue;
        if (!Array.isArray(r8Value) || r8Value.length < 2) throw new Error("R8 inválido.");
        const resolverPK_Hex = parseCollByteToHex(r8Value[0]);
        const resolverCommission = parseInt(r8Value[1], 10);

        const r9Value = box.additionalRegisters.R9?.renderedValue;
        if (!Array.isArray(r9Value) || r9Value.length < 2) throw new Error("R9 inválido.");
        const originalCreatorPK_Hex = parseCollByteToHex(r9Value[0]);
        const gameDetailsHex = parseCollByteToHex(r9Value[1]);
        const content = parseGameContent(hexToUtf8(gameDetailsHex || ""), box.boxId, box.assets[0]);

        return {
            platform: new ErgoPlatform(), boxId: box.boxId, box, status: GameState.Resolution, gameId,
            resolutionDeadline, resolvedCounter, revealedS_Hex, winnerCandidateCommitment, participatingJudges,
            originalDeadline: Number(originalDeadline), creatorStakeNanoErg, participationFeeNanoErg,
            resolverPK_Hex, resolverCommission, originalCreatorPK_Hex, content, value: BigInt(box.value)
        };
    } catch (e) {
        console.error(`Error al parsear la caja en resolución ${box.boxId}:`, e);
        return null;
    }
}

/**
 * Busca y recupera todos los juegos que se encuentran actualmente en estado "Resolución".
 * @returns Un `Promise` que resuelve a un `Map` con los juegos en resolución, usando el ID del juego como clave.
 */
export async function fetchResolutionGames(): Promise<Map<string, GameResolution>> {
    const games = new Map<string, GameResolution>();
    // Usamos el TemplateHash para buscar en el explorador de la API.
    const scriptHash = getGopGameResolutionTemplateHash(); 
    
    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    console.log("Buscando juegos en resolución con el hash de plantilla:", scriptHash);

    while (moreAvailable) {
        // Buscamos cajas no gastadas ('unspent') que coincidan con el script.
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: scriptHash }),
            });

            if (!response.ok) {
                throw new Error(`La respuesta de la API no fue exitosa: ${response.status}`);
            }
            
            const data = await response.json();
            const items: Box[] = data.items || [];

            // Parseamos cada caja encontrada y la añadimos al mapa.
            items.forEach(box => {
                const game = parseGameResolutionBox(box);
                if (game) {
                    games.set(game.gameId, game);
                }
            });

            offset += items.length;
            moreAvailable = items.length === limit; // Si obtenemos menos del límite, es la última página.

        } catch (error) {
            console.error("Ocurrió una excepción al buscar juegos en resolución:", error);
            moreAvailable = false; // Detenemos el bucle en caso de error.
        }
    }

    console.log(`Se encontraron ${games.size} juegos en resolución.`);
    return games;
}

// =================================================================
// === ESTADO: GAME CANCELLATION
// =================================================================

/**
 * Parsea una Box para convertirla en un objeto `GameCancellation`.
 * @param box La caja raw del explorador.
 * @returns Un objeto `GameCancellation` o `null`.
 */
export function parseGameCancellationBox(box: Box<Amount>): GameCancellation | null {
    try {
        if (!box.assets || box.assets.length === 0) return null;
        const gameId = box.assets[0].tokenId;

        const unlockHeight = Number(parseLongColl(box.additionalRegisters.R4?.renderedValue)[0]);
        const revealedS_Hex = parseCollByteToHex(box.additionalRegisters.R5?.renderedValue);
        const currentStakeNanoErg = parseLongColl(box.additionalRegisters.R6?.renderedValue)[0];
        const content = parseGameContent(hexToUtf8(parseCollByteToHex(box.additionalRegisters.R7?.renderedValue) || ""), box.boxId, box.assets[0]);

        if (unlockHeight === undefined || !revealedS_Hex || currentStakeNanoErg === undefined) throw new Error("Registros inválidos.");

        return {
            platform: new ErgoPlatform(), boxId: box.boxId, box, status: GameState.Cancelled_Draining,
            gameId, unlockHeight, revealedS_Hex, currentStakeNanoErg, content, value: BigInt(box.value)
        };
    } catch (e) {
        console.error(`Error al parsear la caja de cancelación ${box.boxId}:`, e);
        return null;
    }
}

/**
 * Busca y recupera todos los juegos que se encuentran actualmente en estado "Cancelación".
 * @returns Un `Promise` que resuelve a un `Map` con los juegos en cancelación, usando el ID del juego como clave.
 */
export async function fetchCancellationGames(): Promise<Map<string, GameCancellation>> {
    const games = new Map<string, GameCancellation>();
    // Usamos el TemplateHash para buscar en el explorador de la API.
    const scriptHash = getGopGameCancellationTemplateHash();
    
    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    console.log("Buscando juegos en cancelación con el hash de plantilla:", scriptHash);

    while (moreAvailable) {
        // Buscamos cajas no gastadas ('unspent') que coincidan con el script.
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ergoTreeTemplateHash: scriptHash }),
            });

            if (!response.ok) {
                throw new Error(`La respuesta de la API no fue exitosa: ${response.status}`);
            }
            
            const data = await response.json();
            const items: Box[] = data.items || [];

            // Parseamos cada caja encontrada y la añadimos al mapa.
            items.forEach(box => {
                const game = parseGameCancellationBox(box);
                if (game) {
                    games.set(game.gameId, game);
                }
            });

            offset += items.length;
            moreAvailable = items.length === limit; // Si obtenemos menos del límite, es la última página.

        } catch (error) {
            console.error("Ocurrió una excepción al buscar juegos en cancelación:", error);
            moreAvailable = false; // Detenemos el bucle en caso de error.
        }
    }

    console.log(`Se encontraron ${games.size} juegos en cancelación.`);
    return games;
}

// =================================================================
// === ESTADO: PARTICIPATION SUBMITTED & RESOLVED
// =================================================================


function _parseParticipationBox(box: Box<Amount>): ParticipationBase | null {
    try {
        const playerPK_Hex = parseCollByteToHex(box.additionalRegisters.R4?.renderedValue);
        const commitmentC_Hex = parseCollByteToHex(box.additionalRegisters.R5?.renderedValue);
        const gameNftId = parseCollByteToHex(box.additionalRegisters.R6?.renderedValue);
        const solverId_RawBytesHex = parseCollByteToHex(box.additionalRegisters.R7?.renderedValue);
        const hashLogs_Hex = parseCollByteToHex(box.additionalRegisters.R8?.renderedValue);
        const scoreList = parseLongColl(box.additionalRegisters.R9?.renderedValue) ?? [];

        if (!playerPK_Hex || !commitmentC_Hex || !gameNftId || !solverId_RawBytesHex || !hashLogs_Hex) {
            throw new Error("Registros de participación inválidos.");
        }

        // Ahora esta función devuelve el tipo base, que es más simple y claro.
        const participationBase: ParticipationBase = {
            boxId: box.boxId,
            box,
            transactionId: box.transactionId,
            creationHeight: box.creationHeight,
            value: BigInt(box.value),
            gameNftId,
            playerPK_Hex,
            commitmentC_Hex,
            solverId_RawBytesHex,
            solverId_String: hexToUtf8(solverId_RawBytesHex) || undefined, 
            hashLogs_Hex,
            scoreList
        };
        return participationBase;

    } catch(e) {
        console.error(`Error al parsear caja de participación ${box.boxId}:`, e);
        return null;
    }
}

/**
 * Busca participaciones en estado "Submitted" para un juego.
 * @param gameNftId ID del NFT del juego.
 * @returns Un `Promise` con un array de `ParticipationSubmitted`.
 */
export async function fetchSubmittedParticipations(gameNftId: string): Promise<ParticipationSubmitted[]> {
    const participations: ParticipationSubmitted[] = [];
    const scriptHash = getGopParticipationSubmittedTemplateHash();
    
    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    console.log(`Buscando participaciones enviadas para el juego ${gameNftId}`);

    while (moreAvailable) {
        // Buscamos cajas no gastadas ('unspent') que coincidan con el script y el R6.
        const url = `${explorer_uri}/api/v1/boxes/unspent/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
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
                throw new Error(`La respuesta de la API no fue exitosa: ${response.status}`);
            }

            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const p_base = _parseParticipationBox(box);
                if (p_base) {
                    participations.push({
                        ...p_base,
                        status: 'Submitted'
                    });
                }
            }

            offset += items.length;
            moreAvailable = items.length === limit;

        } catch (error) {
            console.error(`Ocurrió una excepción al buscar participaciones enviadas para ${gameNftId}:`, error);
            moreAvailable = false;
        }
    }

    console.log(`Se encontraron ${participations.length} participaciones enviadas para el juego ${gameNftId}.`);
    return participations;
}

/**
 * Busca participaciones en estado "Resolved" para un juego (gastadas y no gastadas).
 */
export async function fetchResolvedParticipations(gameNftId: string): Promise<ParticipationResolved[]> {
    const participations: ParticipationResolved[] = [];
    const scriptHash = getGopParticipationResolvedTemplateHash();
    
    let offset = 0;
    const limit = 100;
    let moreAvailable = true;

    console.log(`Buscando participaciones resueltas para el juego ${gameNftId}`);

    while (moreAvailable) {
        // Usamos el endpoint de búsqueda general para incluir cajas ya gastadas.
        const url = `${explorer_uri}/api/v1/boxes/search`;
        try {
            const response = await fetch(`${url}?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ergoTreeTemplateHash: scriptHash,
                    registers: { "R6": gameNftId }
                }),
            });

            if (!response.ok) throw new Error(`API response: ${response.status}`);

            const data = await response.json();
            const items: Box[] = data.items || [];

            for (const box of items) {
                const p_base = _parseParticipationBox(box);
                if (p_base) {
                    participations.push({
                        ...p_base,
                        status: 'Resolved',
                        spent: box.spentTransactionId !== null
                    });
                }
            }

            offset += items.length;
            moreAvailable = items.length === limit;

        } catch (error) {
            console.error(`Ocurrió una excepción al buscar participaciones resueltas para ${gameNftId}:`, error);
            moreAvailable = false;
        }
    }

    console.log(`Se encontraron ${participations.length} participaciones resueltas para el juego ${gameNftId}.`);
    return participations;
}