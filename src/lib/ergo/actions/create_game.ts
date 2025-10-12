import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair } from '@fleet-sdk/serializer';
import { hexToBytes } from '$lib/ergo/utils'; 
import { getGopGameActiveErgoTreeHex } from '../contract'; 
import { stringToBytes } from '@scure/base';
import { prependHexPrefix } from '$lib/utils';

declare var ergo: any;

/**
 * Creates a transaction to generate a game box in the "GameActive" state.
 * @param gameServiceId - Service ID (optional, can be included in details).
 * @param hashedSecret - The Blake2b256 hash of the secret 'S'.
 * @param deadlineBlock - The block height at which the game ends.
 * @param creatorStakeNanoErg - The amount of ERG the creator stakes.
 * @param participationFeeNanoErg - The fee for players to participate.
 * @param commissionPercentage - The commission percentage for the creator.
 * @param judges - An array of reputation token IDs for invited judges.
 * @param gameDetailsJson - A JSON string with game details (title, description, etc.).
 * @param perJudgeComissionPercentage - The commission percentage for each judge.
 * @returns The ID of the submitted transaction.
 */
export async function create_game(
    gameServiceId: string, // Although not used directly, it's good to maintain for consistency
    hashedSecret: string,
    deadlineBlock: number,
    creatorStakeNanoErg: bigint,
    participationFeeNanoErg: bigint,
    commissionPercentage: number,
    judges: string[],
    gameDetailsJson: string,
    perJudgeComissionPercentage: number, 
): Promise<string | null> {

    console.log("Attempting to create a game with the new contracts (GameActive):", {
        hashedSecret: hashedSecret.substring(0, 10) + "...",
        deadlineBlock,
        creatorStakeNanoErg: creatorStakeNanoErg.toString(),
        judges,
        gameDetailsJsonBrief: gameDetailsJson.substring(0, 100) + "..."
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

    if (creatorStakeNanoErg < SAFE_MIN_BOX_VALUE) {
        throw new Error(`The creator's stake (${creatorStakeNanoErg}) is less than the safe minimum.`);
    }

    // --- 2. Construction of the Game Output Box ---
    const activeGameErgoTree = getGopGameActiveErgoTreeHex();
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Failed to convert the hashedSecret to bytes.");

    const judgesColl = judges
        .map(judgeId => {
            const bytes = hexToBytes(judgeId);
            return bytes ? [...bytes] : null;
        })
        .filter((item): item is number[] => item !== null);

    const gameBoxOutput = new OutputBuilder(
        creatorStakeNanoErg,
        activeGameErgoTree
    )
    .mintToken({ 
        amount: 1n,
        decimals: 0
    })
    .setAdditionalRegisters({
        // R4: Game state (0: Active)
        R4: SInt(0).toHex(),
        // R5: (Creator's public key, Commission percentage)
        R5: SPair(SColl(SByte, prependHexPrefix(creatorPkBytes)), SLong(BigInt(commissionPercentage))).toHex(),
        // R6: Hash of the secret 'S'
        R6: SColl(SByte, hashedSecretBytes).toHex(),
        // R7: Invited judges
        R7: SColl(SColl(SByte), judgesColl).toHex(),
        // R8: [deadline, creator's stake, participation fee]
        R8: SColl(SLong, [BigInt(deadlineBlock), creatorStakeNanoErg, participationFeeNanoErg, perJudgeComissionPercentage]).toHex(),
        // R9: Game details in JSON format (as bytes)
        R9: SColl(SByte, stringToBytes("utf8", gameDetailsJson)).toHex()
    });

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

    console.log(`Game creation transaction (GameActive) submitted successfully. ID: ${transactionId}`);
    return transactionId;
}