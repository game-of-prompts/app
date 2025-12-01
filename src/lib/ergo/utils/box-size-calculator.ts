/**
 * Utilities for calculating and validating Ergo box sizes for Game of Prompts
 */

import { SInt, SLong, SColl, SPair, SByte } from '@fleet-sdk/serializer';
import { getGopGameActiveErgoTreeHex } from '../contract';

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
    imageURL: string;
    webLink: string;
    serviceId: string;
    mirrorUrls: string[];
    indetermismIndex: number;
}

/**
 * Calculate the size in bytes of the game details JSON (R9 register)
 */
export function calculateGameDetailsBytes(details: GameDetails): number {
    const jsonString = JSON.stringify(details);
    return utf8ByteLength(jsonString);
}

/**
 * Estimate the total size of all registers (R4-R9) in bytes
 */
export interface RegisterSizes {
    r4Bytes: number;  // Game state (SInt)
    r5Bytes: number;  // Seed + CeremonyDeadline (SPair)
    r6Bytes: number;  // HashedSecret (SColl<SByte>)
    r7Bytes: number;  // Judges (SColl<SColl<SByte>>)
    r8Bytes: number;  // Config (SColl<SLong>)
    r9Bytes: number;  // GameDetails JSON (SColl<SByte>)
}

export function estimateRegisterSizes(
    judgesCount: number,
    gameDetails: GameDetails
): RegisterSizes {
    const PER_REGISTER_OVERHEAD = 1; // Type byte/overhead for the register itself

    // R4: SInt(0)
    const r4Hex = SInt(0).toHex();

    // R5: SPair(SColl(SByte, 8 bytes), SLong)
    // Seed is 16 hex chars = 8 bytes
    const dummySeed = new Uint8Array(8).fill(0);
    const dummyDeadline = BigInt(1000000);
    const r5Hex = SPair(SColl(SByte, dummySeed), SLong(dummyDeadline)).toHex();

    // R6: SColl(SByte, 32 bytes) - Hashed Secret (Blake2b256)
    const dummyHash = new Uint8Array(32).fill(0);
    const r6Hex = SColl(SByte, dummyHash).toHex();

    // R7: SColl(SColl(SByte), judges)
    // Each judge is a token ID (32 bytes)
    const dummyJudge = new Uint8Array(32).fill(0);
    const judgesList = Array(judgesCount).fill(dummyJudge);
    const r7Hex = SColl(SColl(SByte), judgesList).toHex();

    // R8: SColl(SLong, [5 longs])
    const dummyLongs = Array(5).fill(BigInt(0));
    const r8Hex = SColl(SLong, dummyLongs).toHex();

    // R9: SColl(SByte, JSON)
    // We calculate this based on the actual content
    const jsonString = JSON.stringify(gameDetails);
    // We need to wrap it in SColl(SByte, ...) to get the full hex including types
    const jsonBytes = new TextEncoder().encode(jsonString);
    const r9Hex = SColl(SByte, jsonBytes).toHex();

    return {
        r4Bytes: hexByteLength(r4Hex) + PER_REGISTER_OVERHEAD,
        r5Bytes: hexByteLength(r5Hex) + PER_REGISTER_OVERHEAD,
        r6Bytes: hexByteLength(r6Hex) + PER_REGISTER_OVERHEAD,
        r7Bytes: hexByteLength(r7Hex) + PER_REGISTER_OVERHEAD,
        r8Bytes: hexByteLength(r8Hex) + PER_REGISTER_OVERHEAD,
        r9Bytes: hexByteLength(r9Hex) + PER_REGISTER_OVERHEAD,
    };
}

/**
 * Maximum box size in Ergo blockchain
 */
export const MAX_BOX_SIZE = 4096;

/**
 * Estimate total box size including all components
 */
export function estimateTotalBoxSize(
    gameDetails: GameDetails,
    judgesCount: number
): number {
    const BASE_BOX_OVERHEAD = 60; // Variable, but ~60 is a safe lower bound for non-complex boxes
    const PER_TOKEN_BYTES = 0; // We are minting 1 token, but it's the box's own token (NFT/singleton), usually handled in base size or slight overhead.
    // However, if we are minting a token, the box will contain the token ID and amount.
    // Minted token: TokenID is the BoxID (derived), so it doesn't take extra space in the box bytes usually?
    // Actually, for a box containing tokens, it adds to the size.
    // If we mint a token, it is present in the box.
    const MINTED_TOKEN_BYTES = 34; // TokenID (32) + Amount (VInt) ~ 2-9 bytes. Let's say 34-40.

    const SIZE_MARGIN = 100; // Safety margin

    // ErgoTree
    // We use the actual ErgoTree from the contract
    let ergoTreeSize = 0;
    try {
        const treeHex = getGopGameActiveErgoTreeHex();
        ergoTreeSize = hexByteLength(treeHex);
    } catch (e) {
        console.warn("Could not get ErgoTree hex, using estimate");
        ergoTreeSize = 400; // Estimate for GoP contract
    }

    const registerSizes = estimateRegisterSizes(judgesCount, gameDetails);

    const totalRegistersBytes =
        registerSizes.r4Bytes +
        registerSizes.r5Bytes +
        registerSizes.r6Bytes +
        registerSizes.r7Bytes +
        registerSizes.r8Bytes +
        registerSizes.r9Bytes;

    return (
        BASE_BOX_OVERHEAD +
        ergoTreeSize +
        MINTED_TOKEN_BYTES +
        totalRegistersBytes +
        SIZE_MARGIN
    );
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
    judgesCount: number
): ValidationResult {
    const currentBytes = calculateGameDetailsBytes(gameDetails);
    const estimatedBoxSize = estimateTotalBoxSize(gameDetails, judgesCount);
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
export function getUsagePercentage(gameDetails: GameDetails, judgesCount: number): number {
    const estimatedBoxSize = estimateTotalBoxSize(gameDetails, judgesCount);
    return Math.round((estimatedBoxSize / MAX_BOX_SIZE) * 100);
}
