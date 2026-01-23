/**
 * Utilities for calculating and validating Ergo box sizes for Game of Prompts
 */

import { SInt, SLong, SColl, SPair, SByte, serializeBox } from '@fleet-sdk/serializer';
import { getGopGameActiveErgoTreeHex, getGopGameResolutionErgoTreeHex, getGopGameCancellationErgoTreeHex } from '../contract';

/**
 * Calculate the UTF-8 byte length of a string
 */
export function utf8ByteLength(str: string): number {
    return new TextEncoder().encode(str).length;
}

/**
 * Calculate the hex byte length from a hex string
 */
export function hexByteLength(hexStr: string): number {
    if (!hexStr) return 0;
    const stripped = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
    return Math.ceil(stripped.length / 2);
}

/**
 * Game details structure stored in R9
 */
export interface GameDetails {
    title: string;
    description: string;
    image: string;
    creatorTokenId: string;
    serviceId: string;
    paper: string;
    soundtrack: string;
    indetermismIndex: number;
}

/**
 * Input parameters for accurate box size calculation
 * Uses the real data the user has chosen instead of dummy values
 */
export interface GameBoxInputs {
    /** Seed bytes (8 bytes) */
    seedBytes: Uint8Array;
    /** Ceremony deadline block height */
    ceremonyDeadlineBlock: number;
    /** Hashed secret bytes (32 bytes) */
    hashedSecretBytes: Uint8Array;
    /** Array of judge token IDs as byte arrays */
    judgesColl: number[][];
    /** Game deadline block */
    deadlineBlock: number;
    /** Creator stake amount */
    creatorStakeAmount: bigint;
    /** Participation fee amount */
    participationFeeAmount: bigint;
    /** Per judge commission percentage */
    perJudgeCommissionPercentage: number;
    /** Commission percentage for creator */
    commissionPercentage: number;
    /** Game details JSON bytes */
    gameDetailsBytes: Uint8Array;
    /** Participation token ID bytes (empty if ERG mode) */
    participationTokenIdBytes: Uint8Array;
}

/**
 * Calculate the size in bytes of the game details JSON (R9 register)
 */
export function calculateGameDetailsBytes(details: GameDetails): number {
    const jsonString = JSON.stringify(details);
    return utf8ByteLength(jsonString);
}

/**
 * Maximum box size in Ergo blockchain
 */
export const MAX_BOX_SIZE = 4096;

/**
 * Estimate total box size using real game inputs.
 * Calculates the maximum size across all three game states:
 * - GameActive: Initial state when game is created
 * - GameResolution: State when game is being resolved (adds resolverErgoTree ~100 bytes + winnerCandidate 32 bytes)
 * - GameCancelled: State when game is cancelled (different register structure)
 * 
 * @returns Object with individual sizes and max size, or null if serialization fails
 */
export function estimateTotalBoxSizeFromInputs(
    inputs: GameBoxInputs
): { activeSize: number; resolutionSize: number; cancelledSize: number; maxSize: number } | null {
    const {
        seedBytes,
        ceremonyDeadlineBlock,
        hashedSecretBytes,
        judgesColl,
        deadlineBlock,
        creatorStakeAmount,
        participationFeeAmount,
        perJudgeCommissionPercentage,
        commissionPercentage,
        gameDetailsBytes,
        participationTokenIdBytes
    } = inputs;

    // Whether this is a token game or ERG game
    const isTokenGame = participationTokenIdBytes.length > 0;

    // Build registers for Active state
    const r4Hex = SInt(0).toHex();
    const r5Hex = SPair(
        SColl(SByte, seedBytes),
        SLong(BigInt(ceremonyDeadlineBlock))
    ).toHex();
    const r6Hex = SColl(SByte, hashedSecretBytes).toHex();
    const r7Hex = SColl(SColl(SByte), judgesColl).toHex();
    const r8Hex = SColl(SLong, [
        BigInt(deadlineBlock),
        creatorStakeAmount,
        participationFeeAmount,
        BigInt(perJudgeCommissionPercentage),
        BigInt(commissionPercentage)
    ]).toHex();
    const r9Hex = SColl(SColl(SByte), [gameDetailsBytes, participationTokenIdBytes]).toHex();

    const activeRegisters = {
        R4: r4Hex,
        R5: r5Hex,
        R6: r6Hex,
        R7: r7Hex,
        R8: r8Hex,
        R9: r9Hex
    };

    // Assets for all states
    const assets = [];
    if (isTokenGame) {
        assets.push({
            tokenId: "00".repeat(32),
            amount: creatorStakeAmount
        });
    }
    // Minted token (NFT)
    assets.push({
        tokenId: "00".repeat(32),
        amount: 1n
    });

    // --- 1. Estimate Active Game Box ---
    let activeBoxSize = 0;
    try {
        const activeTreeHex = getGopGameActiveErgoTreeHex();
        const activeBoxCandidate = {
            transactionId: "00".repeat(32),
            index: 0,
            value: 1000000n,
            ergoTree: activeTreeHex,
            creationHeight: 100000,
            assets: assets,
            additionalRegisters: activeRegisters
        };
        activeBoxSize = serializeBox(activeBoxCandidate).length;
    } catch (e) {
        console.error("Error serializing Active box:", e);
        return null;
    }

    // --- 2. Estimate Resolution Game Box ---
    let resolutionBoxSize = 0;
    try {
        const resolutionTreeHex = getGopGameResolutionErgoTreeHex();

        // Resolution R4: SInt(1) - state
        const resR4 = SInt(1).toHex();

        // Resolution R5: SColl(SByte, seed) - Seed only (no deadline)
        const resR5 = SColl(SByte, seedBytes).toHex();

        // Resolution R6: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment))
        // Secret is 32 bytes, WinnerCommitment is 32 bytes
        const dummySecret = new Uint8Array(32).fill(0);
        const dummyWinner = new Uint8Array(32).fill(0);
        const resR6 = SPair(SColl(SByte, dummySecret), SColl(SByte, dummyWinner)).toHex();

        // Resolution R7: Judges (worst case: all judges participate)
        const resR7 = r7Hex;

        // Resolution R8: Config (6 elements in resolution vs 5 in active)
        // [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline]
        const resR8 = SColl(SLong, [
            BigInt(deadlineBlock),
            creatorStakeAmount,
            participationFeeAmount,
            BigInt(perJudgeCommissionPercentage),
            BigInt(commissionPercentage),
            BigInt(deadlineBlock + 1000) // Dummy resolutionDeadline
        ]).toHex();

        // Resolution R9: [GameDetails, TokenId, ResolverErgoTree]
        // ResolverErgoTree is approximately 100 bytes
        const dummyResolverErgoTree = new Uint8Array(100).fill(0);
        const resR9 = SColl(SColl(SByte), [gameDetailsBytes, participationTokenIdBytes, dummyResolverErgoTree]).toHex();

        const resolutionRegisters = {
            R4: resR4,
            R5: resR5,
            R6: resR6,
            R7: resR7,
            R8: resR8,
            R9: resR9
        };

        const resolutionBoxCandidate = {
            transactionId: "00".repeat(32),
            index: 0,
            value: 1000000n,
            ergoTree: resolutionTreeHex,
            creationHeight: 100000,
            assets: assets,
            additionalRegisters: resolutionRegisters
        };
        resolutionBoxSize = serializeBox(resolutionBoxCandidate).length;
    } catch (e) {
        console.error("Error serializing Resolution box:", e);
        return null;
    }

    // --- 3. Estimate Cancelled Game Box ---
    let cancelledBoxSize = 0;
    try {
        const cancelledTreeHex = getGopGameCancellationErgoTreeHex();

        // Cancelled R4: SInt(2) - state cancelled
        const cancR4 = SInt(2).toHex();

        // Cancelled R5: SLong(unlockHeight) - next unlock height
        const cancR5 = SLong(BigInt(deadlineBlock + 1000)).toHex();

        // Cancelled R6: SColl(SByte, revealedSecret) - revealed secret (32 bytes)
        const dummyRevealedSecret = new Uint8Array(32).fill(0);
        const cancR6 = SColl(SByte, dummyRevealedSecret).toHex();

        // Cancelled R7: SLong(remainingStake) - remaining stake amount
        const cancR7 = SLong(creatorStakeAmount).toHex();

        // Cancelled R8: SLong(deadlineBlock) - original deadline
        const cancR8 = SLong(BigInt(deadlineBlock)).toHex();

        // Cancelled R9: [GameDetails, TokenId] - same as active
        const cancR9 = SColl(SColl(SByte), [gameDetailsBytes, participationTokenIdBytes]).toHex();

        const cancelledRegisters = {
            R4: cancR4,
            R5: cancR5,
            R6: cancR6,
            R7: cancR7,
            R8: cancR8,
            R9: cancR9
        };

        const cancelledBoxCandidate = {
            transactionId: "00".repeat(32),
            index: 0,
            value: 1000000n,
            ergoTree: cancelledTreeHex,
            creationHeight: 100000,
            assets: assets,
            additionalRegisters: cancelledRegisters
        };
        cancelledBoxSize = serializeBox(cancelledBoxCandidate).length;
    } catch (e) {
        console.error("Error serializing Cancelled box:", e);
        return null;
    }

    console.log("Active box size:", activeBoxSize);
    console.log("Resolution box size:", resolutionBoxSize);
    console.log("Cancelled box size:", cancelledBoxSize);

    return {
        activeSize: activeBoxSize,
        resolutionSize: resolutionBoxSize,
        cancelledSize: cancelledBoxSize,
        maxSize: Math.max(activeBoxSize, resolutionBoxSize, cancelledBoxSize)
    };
}

/**
 * Legacy function: Estimate total box size with dummy data.
 * For UI validation before user has entered all parameters.
 * Uses dummy values for registers except gameDetails and judgesCount.
 */
export function estimateTotalBoxSize(
    gameDetails: GameDetails,
    judgesCount: number,
    participationTokenId: string = ""
): number {
    // Construct dummy data
    const dummySeed = new Uint8Array(8).fill(0);
    const dummyHash = new Uint8Array(32).fill(0);
    const dummyJudge = new Uint8Array(32).fill(0);
    const judgesColl = Array(judgesCount).fill([...dummyJudge]);

    const jsonString = JSON.stringify(gameDetails);
    const jsonBytes = new TextEncoder().encode(jsonString);

    let tokenIdBytes = new Uint8Array(0);
    if (participationTokenId && participationTokenId.length > 0) {
        tokenIdBytes = new Uint8Array(32).fill(0);
    }

    const inputs: GameBoxInputs = {
        seedBytes: dummySeed,
        ceremonyDeadlineBlock: 1000000,
        hashedSecretBytes: dummyHash,
        judgesColl: judgesColl,
        deadlineBlock: 1100000,
        creatorStakeAmount: BigInt(1000000),
        participationFeeAmount: BigInt(100000),
        perJudgeCommissionPercentage: 5,
        commissionPercentage: 10,
        gameDetailsBytes: jsonBytes,
        participationTokenIdBytes: tokenIdBytes
    };

    const result = estimateTotalBoxSizeFromInputs(inputs);
    if (!result) {
        return MAX_BOX_SIZE + 1;
    }

    return result.maxSize;
}

/**
 * Validation result
 */
export interface ValidationResult {
    isValid: boolean;
    currentBytes: number;
    estimatedBoxSize: number;
    remainingBytes: number;
    message?: string;
}

/**
 * Validate that the estimated total box size fits within the 4096 byte limit
 */
export function validateGameContent(
    gameDetails: GameDetails,
    judgesCount: number,
    participationTokenId: string = ""
): ValidationResult {
    const currentBytes = calculateGameDetailsBytes(gameDetails);
    const estimatedBoxSize = estimateTotalBoxSize(gameDetails, judgesCount, participationTokenId);
    const remainingBytes = Math.max(0, MAX_BOX_SIZE - estimatedBoxSize);

    if (estimatedBoxSize > MAX_BOX_SIZE) {
        const excessBytes = estimatedBoxSize - MAX_BOX_SIZE;
        return {
            isValid: false,
            currentBytes,
            estimatedBoxSize,
            remainingBytes: 0,
            message: `Estimated box size (${estimatedBoxSize} bytes) exceeds maximum (${MAX_BOX_SIZE} bytes). Please reduce content by approximately ${excessBytes} bytes.`
        };
    }

    return {
        isValid: true,
        currentBytes,
        estimatedBoxSize,
        remainingBytes
    };
}

/**
 * Calculate the percentage of box size used
 */
export function getUsagePercentage(gameDetails: GameDetails, judgesCount: number, participationTokenId: string = ""): number {
    const estimatedBoxSize = estimateTotalBoxSize(gameDetails, judgesCount, participationTokenId);
    return Math.round((estimatedBoxSize / MAX_BOX_SIZE) * 100);
}
