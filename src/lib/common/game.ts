import { ErgoPlatform } from "$lib/ergo/platform";
import { SAFE_MIN_BOX_VALUE, type Amount, type Box } from "@fleet-sdk/core";
import { type GameConstants } from "./constants";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { bigintToLongByteArray, hexToBytes, parseCollByteToHex, parseLongColl, uint8ArrayToHex } from "$lib/ergo/utils";
import { fetch_token_details } from "$lib/ergo/fetch";
import { type RPBox } from "reputation-system";

export interface TokenEIP4 {
    name: string,
    description: string,
    decimals: number,
    emissionAmount: number | null
}

/**
 * Defines the possible states a game can be in, according to the new contract logic.
 */
export const GameState = {
    Unknown: 'Unknown',
    Active: 'Active',                   // Corresponde a game_active.es
    Resolution: 'Resolution',           // Corresponde a game_resolution.es
    Cancelled_Draining: 'Cancelled_Draining', // Corresponde a game_cancellation.es

    // Estados derivados (no representan un script, sino el final del ciclo de vida)
    Finalized: 'Finalized',             // Juego terminado y pagado (obtenido mediante token NFT)
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
    image?: string;
    imageURL?: string;
    webLink?: string;
    paper?: string; // Blake2b256 hash of the detailed game description markdown file
    indetermismIndex?: number; // How many times a game needs to be executed to reproduce a logs (using the same seed).
    creatorReputationProof?: string;
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
    commissionPercentage: number;
    secretHash: string;
    seed: string;
    ceremonyDeadline: number;
    judges: string[];
    deadlineBlock: number;
    creatorStakeAmount: bigint;
    participationFeeAmount: bigint;
    participationTokenId: string;
    perJudgeComissionPercentage: bigint;
    content: GameContent;
    value: bigint;
    reputationOpinions: RPBox[];
    reputation: number;
    constants: GameConstants;
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
    revealedS_Hex: string;
    seed: string;
    winnerCandidateCommitment: string | null;
    judges: string[];
    deadlineBlock: number;
    creatorStakeAmount: bigint;
    participationFeeAmount: bigint;
    participationTokenId: string;
    perJudgeComissionPercentage: bigint;
    resolverPK_Hex: string | null;
    resolverScript_Hex: string
    resolverCommission: number;
    content: GameContent;
    value: bigint;
    reputationOpinions: RPBox[];
    reputation: number;
    constants: GameConstants;
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
    currentStakeAmount: bigint;
    content: GameContent;
    participationFeeAmount: bigint;
    participationTokenId: string;
    value: bigint;
    deadlineBlock: number;
    reputationOpinions: RPBox[];
    judges: string[];
    reputation: number;
    constants: GameConstants;
}

/**
 * Representa la estructura de datos de una caja de juego en estado "Finalizado".
 * Este estado no tiene un script asociado, ya que representa el final del ciclo de vida del juego.
 */
export interface GameFinalized {
    boxId: string;
    box: Box<Amount>;
    platform: ErgoPlatform;
    status: 'Finalized';
    gameId: string;
    content: GameContent;
    value: bigint;
    participationFeeAmount: bigint;
    participationTokenId: string;
    reputationOpinions: RPBox[];
    judges: string[];
    deadlineBlock: number;
    judgeFinalizationBlock: number;
    winnerFinalizationDeadline: number;
    reputation: number;
    constants: GameConstants;
    seed: string;
    revealedS_Hex: string;
    winnerCandidateCommitment: string | null;
    creatorStakeAmount: bigint;
    perJudgeComissionPercentage: bigint;
    resolverPK_Hex: string | null;
    resolverScript_Hex: string;
    resolverCommission: number;
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
    playerPK_Hex: string | null;
    playerScript_Hex: string,
    commitmentC_Hex: string;
    solverId_RawBytesHex: string;
    solverId_String?: string;
    hashLogs_Hex: string;
    scoreList: bigint[];
    reputationOpinions: RPBox[];
}

/**
 * Representa una participación en estado "Enviada".
 * Extiende la base y añade su estado único.
 */
export interface ValidParticipation extends ParticipationBase {
    status: 'Submitted';
    spent: false;
}

export type MalformedParticipationReason = "expired" | "wrongcommitment" | "maxscores" | "unknown";
export interface MalformedParticipation extends ParticipationBase {
    status: 'Malformed';
    spent: false;
    reason: MalformedParticipationReason;
}

export type ParticipationConsumedReason = "cancelled" | "invalidated" | "bywinner" | "byparticipant" | "abandoned" | "unknown";
export interface ParticipationConsumed extends ParticipationBase {
    status: 'Consumed';
    spent: true;
    reason: ParticipationConsumedReason
}

// =================================================================
// === TIPOS DE UNIÓN Y FUNCIONES DE UTILIDAD
// =================================================================

/** Un tipo de unión que puede representar un juego en cualquier estado de contrato. */
export type AnyGame = GameActive | GameResolution | GameCancellation | GameFinalized;

/** Un tipo de unión que puede representar una participación en cualquier estado. */
export type AnyParticipation = ValidParticipation | MalformedParticipation | ParticipationConsumed;

/**
 * Determina si el período de participación de un juego ha terminado.
 * Esto ocurre cuando el juego ya no está en estado 'Active'.
 */
export async function isGameParticipationEnded(game: AnyGame): Promise<boolean> {
    return game.status !== GameState.Active || game.deadlineBlock <= await game.platform.get_current_height();
}

export async function isOpenCeremony(game: AnyGame): Promise<boolean> {
    const currentHeight = await (new ErgoPlatform).get_current_height();
    return game.status === "Active" && currentHeight < game.ceremonyDeadline
}

/**
 * Determina si un juego ha llegado a su estado final definitivo.
 */
export function isGameEnded(game: AnyGame): boolean {
    return game.status === "Finalized";
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
    const unlocked = currentHeight >= game.unlockHeight;

    const stakeToDrain = BigInt(game.currentStakeAmount);
    const stakePortionToClaim = stakeToDrain / BigInt(game.constants.STAKE_DENOMINATOR);
    const remainingStake = game.participationTokenId !== "" || (stakeToDrain - stakePortionToClaim) >= SAFE_MIN_BOX_VALUE;

    return unlocked && remainingStake;
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
                paper: parsed.paper || undefined,
            };
        } catch (error) {
            console.warn(`Error al parsear rawJsonDetails para el juego ${gameBoxId}. Usando valores por defecto. Error: ${error}`);
        }
    }

    return content;
}

export function resolve_participation_commitment(p: AnyParticipation, secretHex: string, seed: string): bigint | null {
    // Early validation
    if (!p.box?.additionalRegisters || !secretHex || !seed) {
        console.log("Missing additional registers, secret, or seed");
        console.log(`Box ID: ${p.boxId}`);
        console.log("Secret hex: ", secretHex);
        console.log("Seed: ", seed);
        return null;
    }
    const R = p.box.additionalRegisters;

    // Parse registers safely
    const ergoTree = hexToBytes(R.R4.renderedValue || "");
    const commitmentHex = parseCollByteToHex(R.R5.renderedValue);
    const solverIdHex = parseCollByteToHex(R.R7.renderedValue);
    const hashLogsHex = parseCollByteToHex(R.R8.renderedValue);
    const scoreListRaw = R.R9.renderedValue;
    const seedBytes = hexToBytes(seed)!;

    console.log(`Participation Box ID: ${p.boxId}`);

    // Check for required fields
    if (!commitmentHex || !solverIdHex || !hashLogsHex || !ergoTree) {
        console.log("Missing required register values");
        return null;
    }

    // Try parsing the score list (R9)
    let scoreList: bigint[] | null = null;
    if (typeof scoreListRaw === "string") {
        try {
            scoreList = parseLongColl(JSON.parse(scoreListRaw));
        } catch {
            console.log("Error parsing score list from R9");
            return null;
        }
    } else if (Array.isArray(scoreListRaw)) {
        scoreList = parseLongColl(scoreListRaw);
    }
    if (!scoreList?.length) return null;

    // Convert hex values to bytes
    const solverIdBytes = hexToBytes(solverIdHex);
    const hashLogsBytes = hexToBytes(hashLogsHex);
    const secretBytes = hexToBytes(secretHex);

    if (!solverIdBytes || !hashLogsBytes || !secretBytes) {
        console.log("Error converting hex values to bytes");
        return null;
    }

    // Look for the matching commitment
    for (const score of scoreList) {
        const scoreBytes = bigintToLongByteArray(score);
        const dataToHash = new Uint8Array([
            ...solverIdBytes,
            ...seedBytes,
            ...scoreBytes,
            ...hashLogsBytes,
            ...ergoTree,
            ...secretBytes,
        ]);
        const computedCommitment = uint8ArrayToHex(fleetBlake2b256(dataToHash));

        if (computedCommitment === commitmentHex) {
            return score;
        }
    }

    console.log("No matching commitment found");
    return null;
}

export async function getGameTokenSymbol(game: AnyGame): Promise<string> {
    if (game.participationTokenId) {
        const eip4 = await fetch_token_details(game.participationTokenId);
        return eip4.name;
    }
    else {
        return "ERG";
    }
}

/**
 * Calculates the effective score based on the raw score and the submission height.
 * Formula: score = game_score * (DEADLINE - HEIGHT)
 */
export function calculateEffectiveScore(
    rawScore: bigint,
    deadlineHeight: number,
    submissionHeight: number
): bigint {
    const heightDiff = BigInt(deadlineHeight - submissionHeight);
    if (heightDiff <= 0n) {
        return 0n; // Should not happen if validated correctly, but safe fallback
    }
    return rawScore * heightDiff;
}