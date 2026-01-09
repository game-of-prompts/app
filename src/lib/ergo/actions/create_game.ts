import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    BOX_VALUE_PER_BYTE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair } from '@fleet-sdk/serializer';
declare const ergo: any;
import { hexToBytes } from '$lib/ergo/utils';
import { getGopGameActiveErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { getGameConstants } from '$lib/common/constants';
import { estimateTotalBoxSizeFromInputs, MAX_BOX_SIZE, type GameBoxInputs } from '../utils/box-size-calculator';

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
    participationTokenId: string
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

    const inputs: Box<Amount>[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No UTXOs found in the wallet to create the game.");
    }

    // --- 2. Game Box Construction ---

    const activeGameErgoTree = getGopGameActiveErgoTreeHex();
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Failed to convert the hashedSecret to bytes.");

    const seedBytes = hexToBytes(seedHex);
    if (!seedBytes) throw new Error("Failed to convert the seedHex to bytes.");

    const ceremonyDeadlineBlock = (await ergo.get_current_height()) + getGameConstants().OPEN_CEREMONY_BLOCKS;

    if (ceremonyDeadlineBlock >= deadlineBlock) {
        throw new Error("Deadline can't be before ceremony deadline. You are trying to create a fast-game. Select Fast Game Mode constants instead.")
    }

    const gameDetailsBytes = stringToBytes("utf8", gameDetailsJson);

    const judgesColl = judges
        .map(judgeId => {
            const bytes = hexToBytes(judgeId);
            return bytes ? [...bytes] : null;
        })
        .filter((item): item is number[] => item !== null);

    const participationTokenIdBytes = participationTokenId ? hexToBytes(participationTokenId)! : new Uint8Array(0);
    if (participationTokenId && !participationTokenIdBytes) throw new Error("Failed to convert participationTokenId to bytes.");

    // --- Box Size Validation using centralized calculator ---
    const boxSizeInputs: GameBoxInputs = {
        seedBytes: seedBytes,
        ceremonyDeadlineBlock: ceremonyDeadlineBlock,
        hashedSecretBytes: hashedSecretBytes,
        judgesColl: judgesColl,
        deadlineBlock: deadlineBlock,
        creatorStakeAmount: creatorStakeAmount,
        participationFeeAmount: participationFeeAmount,
        perJudgeCommissionPercentage: Math.round(perJudgeComissionPercentage * 10000),
        commissionPercentage: Math.round(commissionPercentage * 10000),
        gameDetailsBytes: gameDetailsBytes,
        participationTokenIdBytes: participationTokenIdBytes
    };

    const sizeResult = estimateTotalBoxSizeFromInputs(boxSizeInputs);
    if (!sizeResult) {
        throw new Error("Failed to calculate box sizes. The box might be too large or contain invalid data.");
    }

    console.log("Box sizes calculated:", {
        activeSize: sizeResult.activeSize,
        resolutionSize: sizeResult.resolutionSize,
        cancelledSize: sizeResult.cancelledSize,
        maxSize: sizeResult.maxSize
    });

    if (sizeResult.maxSize > MAX_BOX_SIZE) {
        throw new Error(
            `The maximum box size (${sizeResult.maxSize} bytes) exceeds the limit of ${MAX_BOX_SIZE} bytes. ` +
            `Active: ${sizeResult.activeSize}, Resolution: ${sizeResult.resolutionSize}, Cancelled: ${sizeResult.cancelledSize} bytes.`
        );
    }

    // Registers preparation (using the same data as the calculator)
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
        BigInt(Math.round(perJudgeComissionPercentage * 10000)),
        BigInt(Math.round(commissionPercentage * 10000))
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

    const creationHeight = await ergo.get_current_height();

    const gameTokens = [{
        tokenId: participationTokenId,
        amount: creatorStakeAmount
    }];

    // Use the maximum size to determine the safe minimum value
    const minRequiredValue = BigInt(sizeResult.maxSize) * BOX_VALUE_PER_BYTE;

    // Token Mode
    const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);
    const gameValue = maxBigInt(SAFE_MIN_BOX_VALUE, minRequiredValue);

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
