import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    ErgoAddress,
} from '@fleet-sdk/core';
import { parseBox } from '$lib/ergo/utils';
import type { GameResolution, ValidParticipation } from '$lib/common/game';

/**
 * Builds and sends a transaction for the game creator to reclaim funds form a 
 * participation box that has been abandoned (unclaimed) by the player for > 90 days.
 *
 * @param game The object representing the 'Resolved' game box (Data Input).
 * @param participation The object representing the participation box to be consumed.
 * @returns The transaction ID on success.
 */
export async function reclaim_abandoned_participation(
    game: GameResolution,
    participation: ValidParticipation
): Promise<string> {
    console.log(`[reclaim_abandoned_participation] Initiating creator reclaim for: ${participation.boxId}`);

    // --- 1. Obtener datos del entorno y usuario ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();
    const currentHeight = await ergo.get_current_height();

    // --- 2. Validaciones Previas (Fail-fast) ---
    if (!utxos || utxos.length === 0) {
        throw new Error("No UTXOs found to cover transaction fees.");
    }

    // Parseamos las cajas
    const participationInput = parseBox(participation.box);
    const gameDataInput = parseBox(game.box);

    // --- 3. Determinar el destinatario (El Creador) ---
    // El contrato verifica que los fondos vayan al `resolverPK` que está en R9[2] de la caja del juego.
    // Debemos decodificar esa propiedad para obtener la dirección de destino.
    // R9[2] es un Coll[Byte] (PropositionBytes).
    const resolverPropBytes = game.resolverPK_Hex ?? "";
    const creatorAddress = ErgoAddress.fromErgoTree(resolverPropBytes).toString();

    // --- 4. Construir el Output (Devolución de fondos) ---
    
    // El output principal debe contener el valor de la participación.
    // Si hay tokens en la participación (juego con tokens), deben incluirse.
    const reclaimOutput = new OutputBuilder(
        BigInt(participationInput.value),
        creatorAddress // Los fondos deben ir obligatoriamente al creador definido en el juego
    );

    // Si la caja de participación tiene tokens, los añadimos al output de destino.
    if (participationInput.assets.length > 0) {
        reclaimOutput.addTokens(participationInput.assets);
    }

    // --- 5. Construir y enviar la transacción ---
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([participationInput, ...utxos]) // Consumimos la participación + UTXOs para fees
        .withDataFrom([gameDataInput])        // Prueba de que el juego está resuelto y pasó el tiempo
        .to(reclaimOutput)                    // Enviamos los fondos al creador
        .sendChangeTo(userAddress)            // El cambio (de los UTXOs usados para el fee) vuelve al usuario conectado
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    console.log("Unsigned reclaim abandoned tx:", unsignedTransaction.toEIP12Object());

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`✅ Success! Abandoned funds reclaimed. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.error("Error executing reclaim_abandoned_participation:", error);
        throw error;
    }
}