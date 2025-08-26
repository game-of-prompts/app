import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    SConstant
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameActive } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

// --- Constantes del contrato game_cancellation.es ---
const STAKE_DENOMINATOR = 5n; // Usar BigInt para consistencia
const COOLDOWN_IN_BLOCKS = 40; // Cooldown base definido en el contrato

/**
 * Inicia la cancelación de un juego activo, haciendo la transición de GameActive -> GameCancellation.
 * Esta acción revela el secreto 'S' antes de la fecha límite para penalizar al creador.
 *
 * @param game El objeto GameActive a cancelar.
 * @param secretS_hex El secreto 'S' en formato hexadecimal.
 * @param claimerAddressString La dirección del usuario que inicia la cancelación y reclama la penalización.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function cancel_game(
    game: GameActive,
    secretS_hex: string,
    claimerAddressString: string
): Promise<string | null> {

    console.warn(`Iniciando transición de cancelación para el juego: ${game.boxId}`);
    
    // --- 1. Obtener datos y realizar pre-chequeos ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.deadlineBlock) {
        throw new Error("La cancelación del juego solo es posible antes de la fecha límite.");
    }

    const gameBoxToSpend = game.box;
    if (!gameBoxToSpend) throw new Error("Los datos de la GameBox no se encuentran en el objeto del juego.");

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

    // Verificar que el secreto proporcionado coincide con el hash en la caja activa.
    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("El secreto proporcionado no coincide con el hash en la GameBox.");
    }

    // --- 2. Calcular valores para la nueva caja de cancelación y la penalización ---
    let stakePortionToClaim = game.creatorStakeNanoErg / STAKE_DENOMINATOR;
    let newCreatorStake = game.creatorStakeNanoErg - stakePortionToClaim;

    if (newCreatorStake < SAFE_MIN_BOX_VALUE) {
        console.warn(`Ajuste de stake: El valor restante calculado (${newCreatorStake}) es menor que SAFE_MIN_BOX_VALUE (${SAFE_MIN_BOX_VALUE}).`);
        
        // El stake para la nueva caja se fija en el mínimo seguro.
        newCreatorStake = SAFE_MIN_BOX_VALUE;
        
        // La porción a reclamar es el resto, para que el total se conserve.
        stakePortionToClaim = game.creatorStakeNanoErg - newCreatorStake;

        console.log(`Valores ajustados -> newCreatorStake: ${newCreatorStake}, stakePortionToClaim: ${stakePortionToClaim}`);
    }

    // --- 3. Construir Salidas de la Transacción ---
    
    // La dirección/ErgoTree de la nueva caja será la del script de cancelación.
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + COOLDOWN_IN_BLOCKS);

    // SALIDA(0): La nueva caja de cancelación (`game_cancellation.es`)
    const cancellationBoxOutput = new OutputBuilder(
        newCreatorStake,
        cancellationContractErgoTree
    )
    .addTokens(gameBoxToSpend.assets) // Preservar el NFT del juego
    .setAdditionalRegisters({
        // R4: Estado del juego (2: Cancelado)
        R4: SInt(2).toHex(),
        // R5: Altura de bloque para el siguiente drenaje
        R5: SLong(newUnlockHeight).toHex(),
        // R6: El secreto 'S' revelado
        R6: SColl(SByte, secretS_bytes).toHex(),
        // R7: El stake restante del creador
        R7: SLong(newCreatorStake).toHex(),
        // R8: Información inmutable del juego (transferida desde R9 de la caja activa)
        R8: SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))
    });


    // --- 4. Construir y Enviar la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(gameBoxToSpend), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(stakePortionToClaim >= SAFE_MIN_BOX_VALUE ? 
            [
                cancellationBoxOutput, 
                new OutputBuilder(
                    stakePortionToClaim,
                    claimerAddressString
                )
            ] : 
            [cancellationBoxOutput]
        )
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Transición a cancelación enviada con éxito. ID de la transacción: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn("Error al firmar o enviar la transacción de cancelación:", error);
        throw error;
    }
}