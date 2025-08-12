import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SByte, SLong } from '@fleet-sdk/serializer';
import { parseBox, SString } from '$lib/ergo/utils';
import { type GameCancellation } from '$lib/common/game';
import { getGopGameCancellationErgoTreeHex } from '../contract';

// Constantes del contrato game_cancellation.es
const STAKE_DENOMINATOR = 5n;
const COOLDOWN_IN_BLOCKS_BASE = 30; // Cooldown definido en el contrato
const COOLDOWN_IN_BLOCKS_USED = COOLDOWN_IN_BLOCKS_BASE + 10;

/**
 * Ejecuta la acción de drenaje sobre una caja de juego en estado "Cancelación".
 * Cualquiera puede llamar a esta función después de que el período de enfriamiento haya terminado
 * para reclamar una porción del stake del creador y recrear la caja para el siguiente ciclo.
 *
 * @param game El objeto GameCancellation sobre el que se va a actuar.
 * @param claimerAddressString La dirección del usuario que ejecuta la acción y recibirá la porción del stake.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function drain_cancelled_game_stake(
    game: GameCancellation,
    claimerAddressString: string
): Promise<string | null> {

    console.log(`Intentando drenar el stake del juego cancelado: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.unlockHeight) {
        throw new Error(`El período de enfriamiento no ha terminado. Solo se puede drenar después del bloque ${game.unlockHeight}.`);
    }

    const stakeToDrain = game.currentStakeNanoErg;
    const stakePortionToClaim = stakeToDrain / STAKE_DENOMINATOR;
    const remainingStake = stakeToDrain - stakePortionToClaim;

    // El contrato previene que esta acción se ejecute si no queda suficiente stake.
    if (remainingStake < SAFE_MIN_BOX_VALUE) {
        // En este caso, se debería usar una acción diferente para finalizar el drenaje y mintear el NFT de prueba.
        // Por ahora, lanzamos un error para indicar que esta acción ya no es válida.
        throw new Error(`El stake restante (${remainingStake}) es demasiado bajo para continuar el drenaje. Se debe usar la acción de finalización.`);
    }

    // --- 2. Construir Salidas ---
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + COOLDOWN_IN_BLOCKS_USED);

    // SALIDA(0): La caja de cancelación recreada con valores actualizados
    const recreatedCancellationBox = new OutputBuilder(
        remainingStake,
        cancellationContractErgoTree
    )
    .addTokens(game.box.assets) // Mantener el NFT del juego
    .setAdditionalRegisters({
        R4: SLong(newUnlockHeight).toHex(),
        R5: SColl(SByte, game.revealedS_Hex).toHex(),
        R6: SLong(remainingStake).toHex(),
        R7: SString(game.content.rawJsonString) // Mantener la info inmutable
    });

    // SALIDA(1): La porción del stake para el reclamante
    const claimerOutput = new OutputBuilder(
        stakePortionToClaim,
        claimerAddressString
    );

    // --- 3. Construir y Enviar la Transacción ---
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

        console.log(`Transacción de drenaje de stake enviada con éxito. ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn(error)
        throw error;
    }
}