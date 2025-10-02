import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    ErgoAddress,
} from '@fleet-sdk/core';
import { parseBox } from '$lib/ergo/utils'; // Assuming you have a utility function to parse JSON to InputBox
import type { GameCancellation, ValidParticipation } from '$lib/common/game'; // Assuming your data types

// Declaration for the wallet connector (dApp connector)
declare var ergo: any;

/**
 * Builds and sends a transaction for a participant to claim their refund
 * after a game has been cancelled.
 *
 * @param game The object representing the cancelled game box (to be used as data-input).
 * @param participation The object representing the participation box submitted by the player.
 * @returns The transaction ID on success.
 */
export async function claim_after_cancellation(
    game: GameCancellation,
    participation: ValidParticipation
): Promise<string> {
    console.log(`[claim_after_cancellation] Initiating claim for participation: ${participation.boxId}`);

    // --- 1. Get user and chain data ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();
    const currentHeight = await ergo.get_current_height();

    // --- 2. Preliminary validations ---
    if (!utxos || utxos.length === 0) {
        throw new Error("No UTXOs found in the wallet to cover the transaction fee.");
    }

    // --- 3. Prepare transaction inputs and outputs ---

    // The address to which the refund should be sent is derived from the public key
    // stored in the R4 register of the participation box.
    const playerAddress = ErgoAddress.fromPublicKey(participation.playerPK_Hex);

    // Main input: The participation box to be spent.
    const participationInput = parseBox(participation.box);

    // Data input: The cancelled game box. This provides on-chain proof
    // that the game is in a "Cancelled" state without needing to spend it.
    const gameCancellationDataInput = parseBox(game.box);

    // Output: The refund box that returns funds to the participant.
    // Its value is the same as the original participation box.
    const refundOutput = new OutputBuilder(
        BigInt(participationInput.value),
        playerAddress
    );

    // --- 4. Build and send the transaction ---
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([participationInput, ...utxos]) // Inputs to be spent
        .withDataFrom([gameCancellationDataInput]) // Read-only input
        .to(refundOutput) // Output with the refund
        .sendChangeTo(userAddress) // The change returns to the user's wallet
        .payFee(RECOMMENDED_MIN_FEE_VALUE) // Pay the transaction fee
        .build();

    console.log("Unsigned refund transaction generated:", unsignedTransaction.toEIP12Object());

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`✅ Success! Refund transaction sent. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.error("Error signing or sending the refund transaction:", error);
        throw error;
    }
}