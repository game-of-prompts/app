import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import type { GameActive } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameActiveErgoTreeHex } from '../contract'; // Asume que esta función existe
import { stringToBytes } from '@scure/base';

/**
 * Ejecuta la acción "Open Ceremony" (action3_openCeremony) para un juego activo.
 * * Esta acción permite a cualquiera "re-gastar" la caja del juego antes del
 * 'ceremonyDeadline' para actualizar la semilla del juego (gameSeed), 
 * añadiendo así entropía.
 * * La nueva semilla se calcula como:
 * updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
 * * Todos los demás registros y valores de la caja se preservan.
 * * @param game El objeto GameActive (caja a consumir).
 * @returns El ID de la transacción si tiene éxito.
 */
export async function contribute_to_ceremony(
    game: GameActive
): Promise<string | null> {

    console.log(`Iniciando contribución a ceremonia para el juego: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();

    // 1. --- Validación (Pre-checks) ---
    if (currentHeight >= game.ceremonyDeadline) {
        throw new Error("La ceremonia de apertura ha finalizado. No se puede agregar más entropía.");
    }

    const gameBoxToSpend = parseBox(game.box);
    if (BigInt(gameBoxToSpend.value) < SAFE_MIN_BOX_VALUE) {
        throw new Error(`La caja del juego tiene un valor (${gameBoxToSpend.value}) inferior al mínimo seguro (${SAFE_MIN_BOX_VALUE}).`);
    }

    // 2. --- Calcular el nuevo estado ---

    const oldSeedBytes = hexToBytes(game.seed);
    if (!oldSeedBytes) throw new Error("Seed (R5._1) del juego inválido.");

    const inputBoxIdBytes = hexToBytes(game.boxId);
    if (!inputBoxIdBytes) throw new Error("Box ID del juego inválido.");

    // Calcular: updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
    // INPUTS(0).id es game.boxId
    const combinedBytes = new Uint8Array(oldSeedBytes.length + inputBoxIdBytes.length);
    combinedBytes.set(oldSeedBytes);
    combinedBytes.set(inputBoxIdBytes, oldSeedBytes.length);

    const updatedSeedBytes = fleetBlake2b256(combinedBytes);

    console.log(`Seed antiguo: ${game.seed}`);
    console.log(`Seed nuevo: ${uint8ArrayToHex(updatedSeedBytes)}`);

    // 3. --- Reconstruir Registros ---
    // Todos los registros deben ser idénticos, excepto R5._1

    // R4: Sigue en estado 0 (Activo)
    const r4Hex = SInt(0).toHex();

    // R5: (updated_seed, ceremonyDeadline)
    const r5Hex = SPair(
        SColl(SByte, updatedSeedBytes),
        SLong(BigInt(game.ceremonyDeadline))
    ).toHex();

    // R6: secretHash (se mantiene)
    const r6Hex = SColl(SByte, hexToBytes(game.secretHash)!).toHex();

    // R7: invitedJudges (se mantiene)
    const r7Hex = SColl(
        SColl(SByte),
        game.judges.map(tokenId => hexToBytes(tokenId)!)
    ).toHex();

    // R8: numericalParameters (se mantiene)
    const numericalParams = [
        BigInt(game.deadlineBlock),
        game.creatorStakeAmount,
        game.participationFeeAmount,
        game.perJudgeComissionPercentage,
        BigInt(game.commissionPercentage),
        BigInt(game.timeWeight)
    ];
    const r8Hex = SColl(SLong, numericalParams).toHex();

    const r9 = [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? ""];
    console.log(`R9 values (bytes):`, r9);
    // R9: Coll[Coll[Byte]] -> [gameDetailsJSON, participationTokenId]
    const r9Hex = SColl(SColl(SByte), r9).toHex()

    // 4. --- Construir la Caja de Salida ---
    const gameActiveErgoTree = getGopGameActiveErgoTreeHex();

    const ceremonyOutputBox = new OutputBuilder(
        BigInt(gameBoxToSpend.value),
        gameActiveErgoTree
    )
        .addTokens(gameBoxToSpend.assets)
        .setAdditionalRegisters({
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        });

    // 5. --- Construir y Enviar la Transacción ---

    const changeAddress = await ergo.get_change_address();

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from([gameBoxToSpend, ...await ergo.get_utxos()])
            .to([ceremonyOutputBox])
            .sendChangeTo(changeAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Contribución a ceremonia enviada con éxito. ID de la transacción: ${txId}`);
        return txId;

    } catch (error) {
        console.error("Error al construir o enviar la transacción de ceremonia:", error);
        throw error;
    }
}