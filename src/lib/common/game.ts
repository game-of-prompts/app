// src/lib/common/game.ts

import type { ErgoPlatform } from "$lib/ergo/platform";
import type { Amount, Box, TokenEIP4 } from "@fleet-sdk/core";

/**
 * Defines the possible states a game can be in, according to the new contract logic.
 */
export const GameState = {
    Unknown: 'Unknown',
    Active: 'Active',                   // Corresponde a game_active.es
    Resolution: 'Resolution',           // Corresponde a game_resolution.es
    Cancelled_Draining: 'Cancelled_Draining', // Corresponde a game_cancellation.es
    
    // Estados derivados (no representan un script, sino el final del ciclo de vida)
    Finalized: 'Finalized',             // Juego terminado y pagado
    Cancelled_Finalized: 'Cancelled_Finalized' // Juego cancelado y stake completamente drenado
} as const;

/**
 * A type representing the possible string values for a game's status.
 */
export type GameStatus = typeof GameState[keyof typeof GameState];

export interface WinnerInfo {
    playerAddress: string;
    playerPK_Hex?: string;
    score: bigint | number;
    participationBoxId?: string;
}

/**
 * Describes the detailed content of a GoP game, typically parsed from a JSON in a register.
 */
export interface GameContent {
    rawJsonString: string;
    title: string;
    description: string;
    serviceId: string;
    imageURL?: string;
    webLink?: string;
    mirrorUrls?: string[];
}

// =================================================================
// === NUEVAS INTERFACES POR ESTADO DE JUEGO
// =================================================================

/**
 * Representa la estructura de datos de una caja de juego en estado "Activo".
 * Corresponde al script `game_active.es`.
 */
export interface GameActive {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Active'; // El estado está fijado a 'Active'.

    // --- Datos extraídos de los registros del contrato ---
    gameId: string; // ID del NFT del juego (de tokens[0])
    gameCreatorPK_Hex: string; // R4._1
    commissionPercentage: number; // R4._2
    secretHash: string; // R5
    invitedJudges: string[]; // R6: Array de Token IDs
    deadlineBlock: number; // R7[0]
    creatorStakeNanoErg: bigint; // R7[1]
    participationFeeNanoErg: bigint; // R7[2]
    
    // --- Contenido y valor ---
    content: GameContent; // R9
    value: bigint; // Valor en Ergs de la caja (el stake actual)
}

/**
 * Representa la estructura de datos de una caja de juego en estado "Resolución".
 * Corresponde al script `game_resolution.es`.
 */
export interface GameResolution {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Resolution'; // El estado está fijado a 'Resolution'.

    // --- Datos extraídos de los registros del contrato ---
    gameId: string; // ID del NFT del juego (de tokens[0])
    
    // R4
    resolutionDeadline: number;
    resolvedCounter: number;

    // R5
    revealedS_Hex: string;
    winnerCandidateCommitment: string;

    // R6
    participatingJudges: string[]; // Array de Token IDs

    // R7 - Parámetros originales del juego
    originalDeadline: number;
    creatorStakeNanoErg: bigint;
    participationFeeNanoErg: bigint;

    // R8 - Información del "Resolvedor" (quien inició la resolución)
    resolverPK_Hex: string;
    resolverCommission: number;

    // R9 - Procedencia del juego
    originalCreatorPK_Hex: string;
    
    // --- Contenido y valor ---
    content: GameContent; // Re-parseado desde R9
    value: bigint; // Valor en Ergs de la caja (pozo de premios + stake)
}

/**
 * Representa la estructura de datos de una caja de juego en estado "Cancelación".
 * Corresponde al script `game_cancellation.es`.
 * Este estado significa que el stake del creador está siendo drenado.
 */
export interface GameCancellation {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Cancelled_Draining'; // La caja existe, por lo tanto, está en proceso de drenaje.

    // --- Datos extraídos de los registros del contrato ---
    gameId: string; // ID del NFT del juego (de tokens[0])
    
    // R4
    unlockHeight: number; // Altura a la que se puede realizar el siguiente drenaje.

    // R5
    revealedS_Hex: string; // El secreto 'S' que fue revelado.

    // R6
    currentStakeNanoErg: bigint; // El stake restante del creador.
    
    // --- Contenido y valor ---
    content: GameContent; // R7: Información inmutable del juego, parseada.
    value: bigint; // Valor en Ergs de la caja (debe coincidir con currentStakeNanoErg).
}


// =================================================================
// === NUEVAS INTERFACES POR ESTADO DE PARTICIPACIÓN
// =================================================================

/**
 * Representa la estructura de datos de una caja de participación en estado "Enviada".
 * Corresponde al script `participation_submited.es`.
 */
export interface ParticipationSubmitted {
    boxId: string;
    box: Box<Amount>;
    status: 'Submitted';

    // --- Datos de la transacción ---
    transactionId: string;
    creationHeight: number;
    value: bigint; // La tarifa de participación pagada.

    // --- Datos extraídos de los registros del contrato ---
    gameNftId: string;          // R6: ID del juego al que pertenece.
    playerPK_Hex: string;       // R4: Clave pública del jugador.
    commitmentC_Hex: string;    // R5: Commitment criptográfico.
    solverId_RawBytesHex: string; // R7: ID del solver (en bytes).
    solverId_String?: string;   // R7: ID del solver (interpretado como texto).
    hashLogs_Hex: string;       // R8: Hash de los logs del juego.
    scoreList: bigint[];        // R9: Lista de puntuaciones.
}

/**
 * Representa la estructura de datos de una caja de participación en estado "Resuelta".
 * Corresponde al script `participation_resolved.es`. La estructura de registros
 * es idéntica a la de `ParticipationSubmitted`.
 */
export interface ParticipationResolved {
    boxId: string;
    box: Box<Amount>;
    status: 'Resolved';
    spent: boolean; // Indica si la caja ya fue gastada (ej. en la tx de pago al ganador).

    // --- Datos de la transacción ---
    transactionId: string;
    creationHeight: number;
    value: bigint;

    // --- Datos extraídos de los registros del contrato (idénticos a Submitted) ---
    gameNftId: string;
    playerPK_Hex: string;
    commitmentC_Hex: string;
    solverId_RawBytesHex: string;
    solverId_String?: string;
    hashLogs_Hex: string;
    scoreList: bigint[];
}

// =================================================================
// === FUNCIONES DE UTILIDAD (EJEMPLO)
// =================================================================

/**
 * Parses the content details for a game.
 * @param rawJsonDetails Optional JSON string with game details.
 * @param gameBoxId The box ID, used as a fallback identifier.
 * @param nft Optional EIP-4 token data from the Game NFT.
 * @returns Parsed GameContent.
 */
export function parseGameContent(
    rawJsonDetails: string | undefined | null,
    gameBoxId: string, 
    nft?: TokenEIP4
): GameContent {
    const defaultTitle = nft?.name || `Game ${gameBoxId.slice(0, 8)}`;
    const defaultDescription = nft?.description || "No description provided.";
    let content: GameContent = {
        rawJsonString: rawJsonDetails || "{}",
        title: defaultTitle,
        description: defaultDescription,
        serviceId: ""
    };

    if (rawJsonDetails) {
        try {
            const parsed = JSON.parse(rawJsonDetails);
            content = {
                ...content,
                title: parsed.title || defaultTitle,
                description: parsed.description || defaultDescription,
                serviceId: parsed.serviceId || "",
                imageURL: parsed.imageURL || parsed.image || undefined,
                webLink: parsed.webLink || parsed.link || undefined,
                mirrorUrls: parsed.mirrorUrls || undefined,
            };
        } catch (error) {
            console.warn(`Error parsing rawJsonDetails for game ${gameBoxId}. Using fallbacks. Error: ${error}`);
        }
    }
    
    return content;
}