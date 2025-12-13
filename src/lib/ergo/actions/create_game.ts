import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox,
    BOX_VALUE_PER_BYTE
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair } from '@fleet-sdk/serializer';
import { hexToBytes } from '$lib/ergo/utils';
import { getGopGameActiveErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { DefaultGameConstants } from '$lib/common/constants';

function randomSeed(): string {
    // 64 bits = 16 hex characters
    let hex = '';
    while (hex.length < 16) {
        // genera hasta 8 hex chars por vez (~32 bits)
        hex += Math.floor(Math.random() * 0xffffffff)
            .toString(16)
            .padStart(8, '0');
    }
    return hex.slice(0, 16);
}

/**
 * Creates a transaction to generate a game box in the "GameActive" state.
 * @param gameServiceId - Service ID
 * @param hashedSecret - The Blake2b256 hash of the secret 'S'.
 * @param deadlineBlock - The block height at which the game ends.
 * @param creatorStakeAmount - The amount of ERG the creator stakes.
 * @param participationFeeAmount - The fee for players to participate.
 * @param commissionPercentage - The commission percentage for the creator
 * @param judges - An array of reputation token IDs for invited judges.
 * @param gameDetailsJson - A JSON string with game details.
 * @param perJudgeComissionPercentage - The commission percentage for each judge.
 * @returns The ID of the submitted transaction.
 */
export async function create_game(
    gameServiceId: string,
    hashedSecret: string,
    deadlineBlock: number,
    creatorStakeAmount: bigint,
    participationFeeAmount: bigint,
    commissionPercentage: number,
    judges: string[],
    gameDetailsJson: string,
    perJudgeComissionPercentage: number,
    participationTokenId: string = ""
): Promise<string | null> {

    const seedHex = randomSeed();

    console.log("Attempting to create a game:", {
        hashedSecret: hashedSecret.substring(0, 10) + "...",
        deadlineBlock,
        creatorStakeAmount: creatorStakeAmount.toString(),
        judges,
        gameDetailsJsonBrief: gameDetailsJson.substring(0, 100) + "...",
        seedHex: seedHex.substring(0, 10) + "...",
    });

    // --- 1. Data and Address Preparation ---
    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Could not get the creator's address from the wallet.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);
    const creatorPkBytes = creatorP2PKAddress.getPublicKeys()[0];
    if (!creatorPkBytes) {
        throw new Error(`Could not extract the public key from the address ${creatorAddressString}.`);
    }

    const inputs: InputBox[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No UTXOs found in the wallet to create the game.");
    }

    // --- 2. Game Box Construction ---

    const activeGameErgoTree = getGopGameActiveErgoTreeHex();
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Failed to convert the hashedSecret to bytes.");

    const seedBytes = hexToBytes(seedHex);
    if (!seedBytes) throw new Error("Failed to convert the seedHex to bytes.");

    const ceremonyDeadlineBlock = (await ergo.get_current_height()) + DefaultGameConstants.OPEN_CEREMONY_BLOCKS;

    const gameDetailsBytes = stringToBytes("utf8", gameDetailsJson);

    const judgesColl = judges
        .map(judgeId => {
            const bytes = hexToBytes(judgeId);
            return bytes ? [...bytes] : null;
        })
        .filter((item): item is number[] => item !== null);

    const participationTokenIdBytes = participationTokenId ? hexToBytes(participationTokenId)! : new Uint8Array(0);
    if (participationTokenId && !participationTokenIdBytes) throw new Error("Failed to convert participationTokenId to bytes.");

    // Registers preparation
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
        BigInt(perJudgeComissionPercentage),
        BigInt(commissionPercentage)
    ]).toHex();
    const r9Hex = SColl(SColl(SByte), [gameDetailsBytes, participationTokenIdBytes]).toHex();

    const registers = {
        R4: r4Hex,
        R5: r5Hex,
        R6: r6Hex,
        R7: r7Hex,
        R8: r8Hex,
        R9: r9Hex
    };

    // Size estimation
    const stripHexPrefix = (h: string) => h?.startsWith('0x') ? h.slice(2) : h;
    const isHex = (s: string) => typeof s === 'string' && /^0x?[0-9a-fA-F]+$/.test(s);
    const hexBytesLen = (hexStr: string): number => {
        if (!hexStr) return 0;
        const h = stripHexPrefix(hexStr);
        return Math.ceil(h.length / 2);
    };

    const BASE_BOX_OVERHEAD = 60;
    const PER_TOKEN_BYTES = 40; // approx: 32 (id) + 8 (amount)
    const PER_REGISTER_OVERHEAD = 1;
    const SIZE_MARGIN = 120;

    let ergoTreeBytes = 0;
    if (typeof activeGameErgoTree === 'string' && isHex(activeGameErgoTree)) {
        ergoTreeBytes = hexBytesLen(activeGameErgoTree);
    } else {
        ergoTreeBytes = new TextEncoder().encode(String(activeGameErgoTree || '')).length;
    }

    const gameTokens = participationTokenId == "" ? [] : [{
        tokenId: participationTokenId,
        amount: creatorStakeAmount
    }];
    // We also mint a token, so +1 token count
    const tokensCount = gameTokens.length + 1;
    const tokensBytes = 1 + tokensCount * PER_TOKEN_BYTES;

    let registersBytes = 0;
    for (const h of Object.values(registers)) {
        const len = hexBytesLen(h);
        registersBytes += len + PER_REGISTER_OVERHEAD;
    }

    const totalEstimatedSize = BigInt(
        BASE_BOX_OVERHEAD
        + ergoTreeBytes
        + tokensBytes
        + registersBytes
        + SIZE_MARGIN
    );

    const minRequiredValue = BOX_VALUE_PER_BYTE * totalEstimatedSize;

    let gameValue: bigint;
    if (participationTokenId == "") {
        // ERG Mode
        if (creatorStakeAmount < minRequiredValue) {
            throw new Error(`The creator's stake (${creatorStakeAmount}) is less than the minimum required for box size (${minRequiredValue}).`);
        }
        gameValue = creatorStakeAmount;
    } else {
        // Token Mode
        const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);
        gameValue = maxBigInt(SAFE_MIN_BOX_VALUE, minRequiredValue);
    }

    const gameBoxOutput = new OutputBuilder(
        gameValue,
        activeGameErgoTree
    )
        .mintToken({
            amount: 1n,
            decimals: 0
        })
        .addTokens(gameTokens)
        .setAdditionalRegisters(registers);

    // --- 3. Transaction Construction and Submission ---
    const creationHeight = await ergo.get_current_height();
    const unsignedTransaction = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(gameBoxOutput)
        .sendChangeTo(creatorAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const transactionId = await ergo.submit_tx(signedTransaction);

    console.log(`Game creation transaction submitted successfully. ID: ${transactionId}`);
    return transactionId;
}
