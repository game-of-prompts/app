// src/lib/common/game.ts

import { ErgoPlatform } from "$lib/ergo/platform";
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
    status: 'Active';
    gameId: string;
    gameCreatorPK_Hex: string;
    commissionPercentage: number;
    secretHash: string;
    invitedJudges: string[];
    deadlineBlock: number;
    creatorStakeNanoErg: bigint;
    participationFeeNanoErg: bigint;
    content: GameContent;
    value: bigint;
}

/**
 * Representa la estructura de datos de una caja de juego en estado "Resolución".
 * Corresponde al script `game_resolution.es`.
 */
export interface GameResolution {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Resolution';
    gameId: string;
    resolutionDeadline: number;
    resolvedCounter: number;
    revealedS_Hex: string;
    winnerCandidateCommitment: string;
    participatingJudges: string[];
    originalDeadline: number;
    creatorStakeNanoErg: bigint;
    participationFeeNanoErg: bigint;
    resolverPK_Hex: string;
    resolverCommission: number;
    originalCreatorPK_Hex: string;
    content: GameContent;
    value: bigint;
}

/**
 * Representa la estructura de datos de una caja de juego en estado "Cancelación".
 * Corresponde al script `game_cancellation.es`.
 */
export interface GameCancellation {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Cancelled_Draining';
    gameId: string;
    unlockHeight: number;
    revealedS_Hex: string;
    currentStakeNanoErg: bigint;
    content: GameContent;
    value: bigint;
}

/**
 * Contiene todas las propiedades comunes compartidas entre los diferentes
 * estados de una caja de participación.
 */
export interface ParticipationBase {
    boxId: string;
    box: Box<Amount>;
    transactionId: string;
    creationHeight: number;
    value: bigint;
    gameNftId: string;
    playerPK_Hex: string;
    commitmentC_Hex: string;
    solverId_RawBytesHex: string;
    solverId_String?: string;
    hashLogs_Hex: string;
    scoreList: bigint[];
}

/**
 * Representa una participación en estado "Enviada".
 * Extiende la base y añade su estado único.
 */
export interface ParticipationSubmitted extends ParticipationBase {
    status: 'Submitted';
}

/**
 * Representa una participación en estado "Resuelta".
 * Extiende la base y añade sus propiedades únicas.
 */
export interface ParticipationResolved extends ParticipationBase {
    status: 'Resolved';
    spent: boolean; // Indica si la caja ya fue gastada.
}

// =================================================================
// === TIPOS DE UNIÓN Y FUNCIONES DE UTILIDAD
// =================================================================

/** Un tipo de unión que puede representar un juego en cualquier estado de contrato. */
export type AnyGame = GameActive | GameResolution | GameCancellation;

/** Un tipo de unión que puede representar una participación en cualquier estado. */
export type AnyParticipation = ParticipationSubmitted | ParticipationResolved;

/**
 * Determina si el período de participación de un juego ha terminado.
 * Esto ocurre cuando el juego ya no está en estado 'Active'.
 */
export function isGameParticipationEnded(game: AnyGame): boolean {
    return game.status !== GameState.Active;
}

/**
 * Determina si un juego ha llegado a su estado final definitivo.
 */
export function isGameEnded(game: AnyGame): boolean {
    return game.status === GameState.Finalized || game.status === GameState.Cancelled_Finalized;
}

/**
 * Verifica si un juego está en el estado de drenaje de stake y actúa como un "type guard" de TypeScript.
 */
export function iGameDrainingStaking(game: AnyGame): game is GameCancellation {
    return game.status === GameState.Cancelled_Draining;
}

/**
 * Verifica si la acción de drenar el stake está permitida (si ha pasado el cooldown).
 */
export async function isGameDrainingAllowed(game: AnyGame): Promise<boolean> {
    if (!iGameDrainingStaking(game)) {
        return false;
    }
    const platform = new ErgoPlatform();
    const currentHeight = await platform.get_current_height();
    return currentHeight >= game.unlockHeight;
}

/**
 * Parsea los detalles del contenido de un juego a partir de un string JSON.
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
            console.warn(`Error al parsear rawJsonDetails para el juego ${gameBoxId}. Usando valores por defecto. Error: ${error}`);
        }
    }
    
    return content;
}