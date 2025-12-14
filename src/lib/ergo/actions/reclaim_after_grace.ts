import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    ErgoAddress,
} from '@fleet-sdk/core';
import { parseBox } from '$lib/ergo/utils'; // Assuming you have a utility function to parse JSON
import type { GameActive, ValidParticipation } from '$lib/common/game'; // Assuming your data types

/**
 * Builds and sends a transaction for a participant to claim their share
 * if the game creator fails to resolve it after a grace period has passed.
 *
 * @param game The object representing the 'Active' game box (to be used as data-input).
 * @param participation The object representing the participation box submitted by the player.
 * @returns The transaction ID on success.
 */
export async function reclaim_after_grace(
    game: GameActive,
    participation: ValidParticipation
): Promise<string> {
    console.log(`[reclaim_after_grace] Initiating reclaim for participation: ${participation.boxId}`);

    // --- 1. Get user and chain data ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();
    const currentHeight = await ergo.get_current_height();

    // --- 2. Preliminary validations ---
    if (!utxos || utxos.length === 0) {
        throw new Error("No UTXOs found in the wallet to cover the transaction fee.");
    }

    // --- 3. Prepare transaction inputs and outputs ---

    // The refund address is obtained from the public key in R4 of the participation box.
    // This is a contract security requirement.
    const playerAddress = ErgoAddress.fromPublicKey(participation.playerPK_Hex);

    // Input to be spent: the player's participation box.
    const participationInput = parseBox(participation.box);

    // Data input (read-only): the game box that is "stuck" in an active state.
    const gameDataInput = parseBox(game.box);

    // Output: the box containing the full refund.
    const refundOutput = new OutputBuilder(
        BigInt(participationInput.value),
        playerAddress
    );

    // --- 4. Build and send the transaction ---
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([participationInput, ...utxos]) // Inputs to be spent
        .withDataFrom([gameDataInput])        // Proof that the game is stuck
        .to(refundOutput)                      // Output with the refund
        .sendChangeTo(userAddress)             // Address for the change
        .payFee(RECOMMENDED_MIN_FEE_VALUE)     // Transaction fee
        .build();

    console.log("Unsigned reclaim transaction (grace period):", unsignedTransaction.toEIP12Object());

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`✅ Success! Reclaim transaction sent. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.error("Error signing or sending the reclaim transaction:", error);
        throw error;
    }
}
