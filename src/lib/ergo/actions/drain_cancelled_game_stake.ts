import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { parseBox, hexToBytes } from '$lib/ergo/utils';
import { type GameCancellation } from '$lib/common/game';
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

const COOLDOWN_IN_BLOCKS_MARGIN = 10;

/**
 * Executes the drain action on a game box in the "Cancellation" state.
 * Anyone can call this function after the cooldown period has ended
 * to claim a portion of the creator's stake and recreate the box for the next cycle.
 *
 * @param game The GameCancellation object to act upon.
 * @param claimerAddressString The address of the user executing the action, who will receive the stake portion.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function drain_cancelled_game_stake(
    game: GameCancellation,
    claimerAddressString: string
): Promise<string | null> {

    console.log(`Attempting to drain the stake of the cancelled game: ${game.boxId}`);

    // --- 1. Preliminary Checks ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.unlockHeight) {
        throw new Error(`The cooldown period has not ended. Draining is only possible after block ${game.unlockHeight}.`);
    }

    const stakeToDrain = BigInt(game.currentStakeAmount);
    const stakePortionToClaim = stakeToDrain / BigInt(game.constants.STAKE_DENOMINATOR);
    const remainingStake = stakeToDrain - stakePortionToClaim;
    const isTokenGame = game.participationTokenId !== "";

    // The contract prevents this action from running if not enough stake is left (only applies to ERG stake).
    if (!isTokenGame && remainingStake < SAFE_MIN_BOX_VALUE) {
        throw new Error(`The remaining stake (${remainingStake}) is too low to continue the drain. Cannot proceed.`);
    }

    // --- 2. Build Outputs ---
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + game.constants.COOLDOWN_IN_BLOCKS + COOLDOWN_IN_BLOCKS_MARGIN);
    const revealedSecretBytes = hexToBytes(game.revealedS_Hex);
    if (!revealedSecretBytes) throw new Error("Could not convert revealed secret hex to bytes.");

    // Calculate Values and Tokens based on whether it's an ERG game or Token game
    const nextBoxValue = isTokenGame ? BigInt(game.box.value) : remainingStake;
    const nextBoxTokens = [game.box.assets[0]]; // Always preserve NFT
    if (isTokenGame) nextBoxTokens.push({ tokenId: game.participationTokenId, amount: remainingStake });

    const claimerValue = isTokenGame ? SAFE_MIN_BOX_VALUE : stakePortionToClaim;
    const claimerTokens = isTokenGame ? [{ tokenId: game.participationTokenId, amount: stakePortionToClaim }] : [];

    // OUTPUT(0): The recreated cancellation box with updated values
    const recreatedCancellationBox = new OutputBuilder(
        nextBoxValue,
        cancellationContractErgoTree
    )
        .addTokens(nextBoxTokens)
        .setAdditionalRegisters({
            // Correct register structure from the test
            R4: SInt(2).toHex(), // State: Cancelled
            R5: SLong(newUnlockHeight).toHex(),
            R6: SColl(SByte, revealedSecretBytes).toHex(),
            R7: SLong(remainingStake).toHex(), // R7 always tracks the relevant stake amount (ERG or Token)
            R8: SLong(BigInt(game.deadlineBlock)).toHex(),
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? ""]).toHex()
        });

    // OUTPUT(1): The portion of the stake for the claimer
    const claimerOutput = new OutputBuilder(
        claimerValue,
        claimerAddressString
    )
    .addTokens(claimerTokens);

    // --- 3. Build and Send the Transaction ---
    const utxos: InputBox[] = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedCancellationBox, claimerOutput])
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Stake drain transaction sent successfully. ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn(error)
        throw error;
    }
}