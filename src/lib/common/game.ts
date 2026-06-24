import { ErgoPlatform } from "$lib/ergo/platform";
import { SAFE_MIN_BOX_VALUE, type Amount, type Box } from "@fleet-sdk/core";
import { type GameConstants } from "./constants";
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { bigintToLongByteArray, hexToBytes, parseCollByteToHex, parseLongColl, uint8ArrayToHex } from "$lib/ergo/utils";
import { findMatchingScoreForCommitment } from "$lib/common/commitment";
import { fetch_token_details } from "$lib/ergo/fetch";
import { type RPBox } from "reputation-system";
import { DEV_SCRIPT, DEV_COMMISSION_PERCENTAGE } from "$lib/ergo/envs";

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
    Resolution: 'Resolution',           // Corresponde a game_resolution.es y end_game.es
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

export interface GameContent {
    rawJsonString: string;
    title: string;
    description: string;
    serviceId: string;
    image?: string;
    imageURL: string;
    creatorTokenId?: string;
    paper?: string; // Blake2b256 hash of the detailed game description markdown file
    soundtrack?: string; // Blake2b256 hash of the soundtrack file
    soundtrackURL: string; // Default soundtrack URL
    indetermismIndex?: number; // How many times a game needs to be executed to reproduce a logs (using the same seed).
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
    resolverCommission: number;
    secretHash: string;
    seed: string;
    ceremonyDeadline: number;
    judges: string[];
    deadlineBlock: number;
    resolverStakeAmount: bigint;
    participationFeeAmount: bigint;
    participationTokenId: string;
    perJudgeCommission: bigint;
    timeWeight: bigint;
    content: GameContent;
    value: bigint;
    reputationOpinions: RPBox[];
    reputation: number;
    constants: GameConstants;

    createdAt: number;
    devScript: string;
    devCommission: number;
    creatorSlashRatio: number;
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
    resolverStakeAmount: bigint;
    participationFeeAmount: bigint;
    participationTokenId: string;
    perJudgeCommission: bigint;
    timeWeight: bigint;
    resolverPK_Hex: string | null;
    resolverScript_Hex: string
    resolverCommission: number;
    devScript: string;
    devCommission: number;
    creatorSlashRatio: number;
    content: GameContent;
    value: bigint;
    reputationOpinions: RPBox[];
    reputation: number;
    constants: GameConstants;
    isEndGame: boolean;
    createdAt: number;
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
    portionToClaim: bigint;
    resolverStakeAmount?: bigint;
    content: GameContent;
    participationFeeAmount: bigint;
    participationTokenId: string;
    value: bigint;
    deadlineBlock: number;
    reputationOpinions: RPBox[];
    judges: string[];
    reputation: number;
    constants: GameConstants;
    createdAt?: number;
    timeWeight?: bigint;
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
    createdAt: number;
    seed: string;
    revealedS_Hex: string;
    winnerCandidateCommitment: string | null;
    resolverStakeAmount: bigint;
    perJudgeCommission: bigint;
    timeWeight: bigint;
    resolverPK_Hex: string | null;
    resolverScript_Hex: string;
    resolverCommission: number;
    devCommission: number;
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
    solverIdBox: Box<Amount> | null;
}

/**
 * Representa una participación en estado "Enviada".
 * Extiende la base y añade su estado único.
 */
export interface ValidParticipation extends ParticipationBase {
    status: 'Submitted';
    spent: false;
}

export type MalformedParticipationReason = "expired" | "wrongcommitment" | "maxscores" | "invalidsolver" | "unknown";
export interface MalformedParticipation extends ParticipationBase {
    status: 'Malformed';
    spent: boolean;
    reason: MalformedParticipationReason;
}

export type ParticipationConsumedReason = "cancelled" | "invalidated" | "unavailable" | "bywinner" | "byparticipant" | "abandoned" | "batched" | "unknown";
export interface ParticipationConsumed extends ParticipationBase {
    status: 'Consumed';
    spent: true;
    reason: ParticipationConsumedReason;
    malformedReason?: MalformedParticipationReason;
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
    const currentHeight = await game.platform.get_current_height();
    return game.status !== GameState.Active || game.deadlineBlock <= currentHeight;
}

export async function isResolutionAllowed(game: AnyGame): Promise<boolean> {
    const currentHeight = await game.platform.get_current_height();
    return game.status === GameState.Active && game.deadlineBlock <= currentHeight && currentHeight < game.deadlineBlock + game.constants.PARTICIPATION_GRACE_PERIOD;
}

/**
 * Checks if a game is in a "suspended" state.
 * A game is suspended when:
 * 1. The game is still in "Active" state
 * 2. The participation period has ended (deadlineBlock passed)
 * 3. The resolution grace period has also ended (currentHeight >= deadlineBlock + PARTICIPATION_GRACE_PERIOD)
 * 
 * In this state:
 * - Participants can recover their participation fee
 * - The creator CANNOT recover their stake (penalty for not resolving in time)
 */
export async function isGameSuspended(game: AnyGame): Promise<boolean> {
    const currentHeight = await game.platform.get_current_height();
    return game.status === GameState.Active &&
        game.deadlineBlock <= currentHeight &&
        currentHeight >= game.deadlineBlock + game.constants.PARTICIPATION_GRACE_PERIOD;
}

export async function isOpenCeremony(game: AnyGame): Promise<boolean> {
    const currentHeight = await game.platform.get_current_height();
    return game.status === "Active" && currentHeight < game.ceremonyDeadline
}

export async function isOpenSolverSubmit(game: AnyGame): Promise<boolean> {
    const currentHeight = await game.platform.get_current_height();
    return game.status === "Active" && currentHeight < game.ceremonyDeadline - game.constants.SEED_MARGIN;
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
    const currentHeight = await game.platform.get_current_height();
    const unlocked = currentHeight >= game.unlockHeight;

    const portionToClaim = game.portionToClaim;
    const value = BigInt(game.box.value);

    let remainingValue: bigint;
    if (game.participationTokenId === "") {
        remainingValue = value - portionToClaim;
    } else {
        const token = game.box.assets.find(t => t.tokenId === game.participationTokenId);
        const currentTokenAmount = BigInt(token ? token.amount : 0);
        remainingValue = currentTokenAmount - portionToClaim;
    }

    // In cancellation, we can drain until the box is empty of the target asset.
    // However, if it's ERG, we must stay above SAFE_MIN_BOX_VALUE to recreate the box.
    const canRecreate = game.participationTokenId !== "" || remainingValue >= SAFE_MIN_BOX_VALUE;

    return unlocked && canRecreate;
}

/**
 * Checks if a game is "dev friendly" by verifying that:
 * 1. The devScript matches the expected DEV_SCRIPT from envs.ts
 * 2. The devCommissionPercentage is >= the expected DEV_COMMISSION_PERCENTAGE from envs.ts
 * 
 * This helps identify games that respect the platform developers.
 */
export function isDevFriendly(game: AnyGame): boolean {
    // GameCancellation and GameFinalized might not have these fields
    if (!('devScript' in game) || !('devCommissionPercentage' in game)) {
        return true; // Don't penalize games that don't have these fields
    }

    const hasCorrectScript = game.devScript === DEV_SCRIPT;
    const hasCorrectCommission = game.devCommission >= DEV_COMMISSION_PERCENTAGE;

    return hasCorrectScript && hasCorrectCommission;
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

    const R = p.box.additionalRegisters as any;

    // Extract register values
    const ergoTreeHex = parseCollByteToHex(R.R4?.renderedValue);
    const commitmentHex = parseCollByteToHex(R.R5?.renderedValue);
    const solverIdHex = parseCollByteToHex(R.R7?.renderedValue);
    const hashLogsHex = parseCollByteToHex(R.R8?.renderedValue);
    const scoreListRaw = R.R9?.renderedValue;

    // Parse score list
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

    const result = findMatchingScoreForCommitment({
        declaredCommitmentHex: commitmentHex,
        solverIdHex,
        seedHex: seed,
        scoreList,
        hashLogsHex,
        ergoTreeHex,
        secretHex,
    });

    if (result.isValid) {
        return result.matchedScore;
    }

    console.log("No matching commitment found", result.reason);
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
 * Formula: S_efficient = S_raw * (1 + (omega * (B_deadline - max(B_box, B_start + M))))
 * 
 * If submissionHeight is 0, then returns 0.
 */
export function calculateEffectiveScore(
    game: AnyGame,
    rawScore: bigint,
    submissionHeight: number,
): bigint {
    if (game.createdAt === undefined || game.timeWeight === undefined) {
        // Cover GameCancell case, where dosn't have createdAt (could be fetch previous active boxes)
        console.error("Game creation height is undefined.");
        return 0n;
    }
    if (submissionHeight === 0) {
        console.error("Submission height is zero.");
        return 0n;
    }
    try {
        // Calculate the effective start block: max(B_box, B_start + M)
        const effectiveStartBlock = Math.max(
            submissionHeight,
            game.createdAt + game.constants.MIN_TIME_WEIGHT_MARGIN
        );

        // Calculate remaining duration: (B_deadline - effectiveStartBlock)
        const remainingDuration = BigInt(Math.max(0, game.deadlineBlock - effectiveStartBlock));

        // Final Score: S_raw * (1 + (omega * remainingDuration))
        const timeFactor = 1n + (BigInt(game.timeWeight) * remainingDuration);

        return rawScore * timeFactor;
    }
    catch (error) {
        console.error("Error calculating effective score:", error);
        return 0n;
    }
}

/**
 * Calculates the current prize pool for a given game.
 * 
 * Logic:
 * 1. Contract Balance: The current balance of the game box.
 * 2. Unbatched Participations: Sum of values from "Submitted" participations that haven't been batched yet.
 * 3. Base Prize Pool: (Contract Balance + Unbatched Participations) - Resolver Stake.
 * 4. Commissions: Deduct commissions for judges, resolver, and developer from the Base Prize Pool.
 * 5. Final Prize: The remaining amount after deductions.
 * 
 * @param game The game object (AnyGame).
 * @param participations Array of participations (AnyParticipation[]).
 * @returns The calculated prize pool as a bigint.
 */
export function getPrizePool(game: AnyGame | null, participations: AnyParticipation[] | null): bigint {
    console.log("Calculating prize pool for game:", game?.gameId);
    console.log("Participations count:", participations?.length ?? 0);
    if (!game) return 0n;

    // A. Contract Balance (donations, invalidated participations and stake)
    const contractBalance = BigInt(game.value ?? 0n);

    // B. Unbatched Participations
    const totalParticipationsValue = (participations || [])
        .filter((p) => p && p.spent === false || game.status === GameState.Finalized) // Only consider spent participations if the game is finalized
        .reduce((acc, p) => {
            return acc + BigInt(p.value ?? 0n);
        }, 0n);

    // C. Base Prize Pool
    const resolverStake = BigInt(game.resolverStakeAmount ?? 0n);
    const prizePoolBase = totalParticipationsValue + contractBalance - resolverStake;

    // D. Commissions (Ya no calculamos el "Pct" por separado)
    const denominator = BigInt(game.constants.COMMISSION_DENOMINATOR);
    const perJudgeCommValue = BigInt((game as any).perJudgeCommission ?? 0n);
    const judgeCount = BigInt(game.judges?.length ?? 0);
    const resolverCommValue = BigInt((game as any).resolverCommission ?? 0n);
    const devCommValue = BigInt((game as any).devCommission ?? 0n);

    const totalJudgeCommission = (prizePoolBase * perJudgeCommValue * judgeCount) / denominator;
    const resolverCommission = (prizePoolBase * resolverCommValue) / denominator;
    const devCommission = (prizePoolBase * devCommValue) / denominator;

    const finalPrize =
        prizePoolBase -
        totalJudgeCommission -
        resolverCommission -
        devCommission;

    // Winner Protection Policy:
    const participationFee = BigInt(game.participationFeeAmount ?? 0n);
    if (finalPrize < participationFee) {
        console.warn("Winner protection policy")
        console.log("All data")
        console.log("Particpations ", participations)
        console.log("Total participations ", totalParticipationsValue)
        console.log("Contract balance ", contractBalance)
        console.log("Stake ", resolverStake)
        console.log("Prize pool ", prizePoolBase)
        console.log("Total judge com ", totalJudgeCommission)
        console.log("Resolver com ", resolverCommission)
        console.log("Dev com ", devCommission)
        return prizePoolBase > 0n ? prizePoolBase : 0n;
    }

    return finalPrize > 0n ? finalPrize : 0n;
}
