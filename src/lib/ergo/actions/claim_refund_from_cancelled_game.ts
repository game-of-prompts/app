// src/ergo/actions/claim_refund_from_cancelled_game.ts

import {
    OutputBuilder,
    TransactionBuilder,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox,
    type Amount,
    ErgoAddress
} from '@fleet-sdk/core';
import { parseBox } from '$lib/ergo/utils';
import { type Game, type Participation, GameState } from '$lib/common/game';

/**
 * Ejecuta "Acción 2: Reembolso por Cancelación" del contrato participation.es.
 * Permite a un participante gastar su propia caja de participación para recuperar
 * los fondos si el juego ha sido cancelado (es decir, el secreto 'S' ha sido revelado).
 *
 * @param game El objeto Game, necesario para usar el GameBox como data-input.
 * @param participation La participación específica que el usuario quiere reclamar.
 * @param claimerAddressString La dirección del participante que recibirá el reembolso.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function claim_refund_from_cancelled_game(
    game: Game,
    participation: Participation,
    claimerAddressString: string
): Promise<string | null> {

    console.log("Attempting to claim refund for participation:", participation.boxId);

    // --- 1. Verificaciones preliminares ---

    try {
        const a = ErgoAddress.fromBase58(claimerAddressString).toString();
        const b = ErgoAddress.fromPublicKey(participation.playerPK_Hex).toString();
        if (a !== b) {
            throw new Error("The claimer address does not match the participation's player public key. \n ${a} != ${b}");
        }
    } catch (e) {
        console.error("Invalid Ergo address format:", claimerAddressString, e);
        throw new Error(`The provided address for the refund (${claimerAddressString}) is not a valid Ergo address.`);
    }

    if (game.status !== GameState.Cancelled_Draining && game.status !== GameState.Cancelled_Finalized) {
        throw new Error("Refund can only be claimed if the game status is Cancelled_Draining or Cancelled_Finalized.");
    }

    const participationBoxToSpend: Box<Amount> = participation.box;
    const gameBoxForDataInput: Box<Amount> = game.box;

    if (!participationBoxToSpend || !gameBoxForDataInput) {
        throw new Error("GameBox or ParticipationBox data is missing.");
    }

    const refundAmount = BigInt(participationBoxToSpend.value);
    if (refundAmount < SAFE_MIN_BOX_VALUE) {
        // Esto no debería ocurrir con las tarifas de participación normales, pero es una buena comprobación.
        throw new Error(`Refund amount (${refundAmount}) is below the safe minimum box value.`);
    }

    // --- 2. Obtener UTXOs del usuario para pagar la tarifa de transacción ---
    const userUtxos: InputBox[] = await ergo.get_utxos();
    if (!userUtxos || userUtxos.length === 0) {
        throw new Error("No UTXOs found in the wallet to pay for the transaction fee.");
    }
    
    // --- 3. Construir la Salida (el reembolso) ---
    const refundOutput = new OutputBuilder(
        refundAmount,
        claimerAddressString
    );

    // --- 4. Construir y Enviar la Transacción ---
    const currentHeight = await ergo.get_current_height();
    const inputsForTx = [parseBox(participationBoxToSpend), ...userUtxos];

    const unsignedTransaction = await new TransactionBuilder(currentHeight)
        .from(inputsForTx)
        .withDataFrom([parseBox(gameBoxForDataInput)])
        .to(refundOutput)
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const eip12UnsignedTransaction = await unsignedTransaction.toEIP12Object();

    console.log("Requesting transaction signing for refund claim...");
    const signedTransaction = await ergo.sign_tx(eip12UnsignedTransaction);
    if (!signedTransaction) {
        throw new Error("Transaction signing was cancelled or failed.");
    }

    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) {
        throw new Error("Failed to submit transaction to the network.");
    }

    console.log(`Refund claim transaction submitted successfully. Transaction ID: ${transactionId}`);
    return transactionId;
}