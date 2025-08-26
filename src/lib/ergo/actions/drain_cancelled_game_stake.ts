import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox,
    SConstant
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { parseBox, hexToBytes } from '$lib/ergo/utils';
import { type GameCancellation } from '$lib/common/game';
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

// Constantes del contrato game_cancellation.es
const STAKE_DENOMINATOR = 5n;
const COOLDOWN_IN_BLOCKS = 40; // Cooldown definido en el contrato

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

    const stakeToDrain = BigInt(game.currentStakeNanoErg);
    const stakePortionToClaim = stakeToDrain / STAKE_DENOMINATOR;
    const remainingStake = stakeToDrain - stakePortionToClaim;

    // The contract prevents this action from running if not enough stake is left.
    if (remainingStake < SAFE_MIN_BOX_VALUE) {
        // In this case, a different action should be used to finalize the drain.
        // For now, we throw an error to indicate this action is no longer valid.
        throw new Error(`The remaining stake (${remainingStake}) is too low to continue the drain. Cannot proceed.`);
    }

    // --- 2. Build Outputs ---
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + COOLDOWN_IN_BLOCKS);
    const revealedSecretBytes = hexToBytes(game.revealedS_Hex);
    if (!revealedSecretBytes) throw new Error("Could not convert revealed secret hex to bytes.");

    // OUTPUT(0): The recreated cancellation box with updated values
    const recreatedCancellationBox = new OutputBuilder(
        remainingStake,
        cancellationContractErgoTree
    )
    .addTokens(game.box.assets) // Keep the game NFT
    .setAdditionalRegisters({
        // Correct register structure from the test
        R4: SInt(2).toHex(), // State: Cancelled
        R5: SLong(newUnlockHeight).toHex(),
        R6: SColl(SByte, revealedSecretBytes).toHex(),
        R7: SLong(remainingStake).toHex(),
        R8: SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))
    });

    // OUTPUT(1): The portion of the stake for the claimer
    const claimerOutput = new OutputBuilder(
        stakePortionToClaim,
        claimerAddressString
    );

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