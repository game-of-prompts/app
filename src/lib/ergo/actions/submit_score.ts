import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SLong, SByte, SGroupElement } from '@fleet-sdk/serializer';
import { hexToBytes } from '$lib/ergo/utils';
import { getGopParticipationErgoTreeHex } from '../contract'; // <-- Importación actualizada
import { prependHexPrefix } from '$lib/utils';

declare var ergo: any;

/**
 * Construye y envía una transacción para crear una caja de participación en estado "Submitted".
 * @param gameNftIdHex - ID del NFT del juego al que se une el jugador (para R6).
 * @param scoreList - Lista de puntuaciones para ofuscar la real (para R9).
 * @param participationFeeForBox - Tarifa de participación que será el valor de la caja.
 * @param commitmentCHex - El commitment criptográfico con la puntuación real (para R5).
 * @param solverIdString - El ID/nombre del solver (para R7).
 * @param hashLogsHex - El hash de los logs del juego (para R8).
 * @returns El ID de la transacción enviada.
 */
export async function submit_score(
    gameNftIdHex: string,
    scoreList: bigint[],
    participationFeeForBox: bigint,
    commitmentCHex: string,
    solverIdString: string,
    hashLogsHex: string
): Promise<string | null> {

    console.log("Intentando enviar puntuación con los parámetros:", {
        gameNftIdHex,
        scoreList: scoreList.map(s => s.toString()),
        participationFeeForBox: participationFeeForBox.toString(),
        commitmentCHex,
        solverIdString,
        hashLogsHex
    });

    if (participationFeeForBox < SAFE_MIN_BOX_VALUE) {
        throw new Error(
            `La tarifa de participación (${participationFeeForBox / 1000000000n} ERG) es menor que el valor mínimo requerido para una caja.`
        );
    }

    // 1. Obtener la clave pública del jugador desde la billetera
    const playerAddressString = await ergo.get_change_address();
    if (!playerAddressString) {
        throw new Error("No se pudo obtener la dirección del jugador desde la billetera.");
    }
    const playerP2PKAddress = ErgoAddress.fromBase58(playerAddressString);
    const playerPkBytes = playerP2PKAddress.getPublicKeys()[0];
    if (!playerPkBytes) {
        throw new Error(`No se pudo extraer la clave pública de la dirección del jugador (${playerAddressString}).`);
    }

    // 2. Obtener UTXOs del jugador para cubrir la tarifa
    const inputs: InputBox[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No se encontraron UTXOs en la billetera. Asegúrate de tener fondos.");
    }

    // 3. Obtener el ErgoTree del contrato de participación
    const participationContractErgoTree = getGopParticipationErgoTreeHex(); // <-- Uso de la función actualizada
    if (!participationContractErgoTree) {
        throw new Error("No se pudo obtener el ErgoTree del contrato de participación.");
    }

    // 4. Preparar los valores para los registros
    const commitmentC_bytes = hexToBytes(commitmentCHex);
    if (!commitmentC_bytes) throw new Error("Fallo al convertir commitmentC a bytes.");

    const gameNftId_bytes = hexToBytes(gameNftIdHex);
    if (!gameNftId_bytes) throw new Error("Fallo al convertir gameNftId a bytes.");
    
    const hashLogs_bytes = hexToBytes(hashLogsHex);
    if (!hashLogs_bytes) throw new Error("Fallo al convertir hashLogs a bytes.");

    // 5. Construir la caja de salida (ParticipationBox)
    const participationBoxOutput = new OutputBuilder(
        participationFeeForBox,
        participationContractErgoTree
    )
    .setAdditionalRegisters({
        R4: SColl(SByte, playerPkBytes).toHex(),
        R5: SColl(SByte, commitmentC_bytes).toHex(),
        R6: SColl(SByte, gameNftId_bytes).toHex(),
        R7: SColl(SByte, prependHexPrefix(hexToBytes(solverIdString)!)).toHex(),
        R8: SColl(SByte, hashLogs_bytes).toHex(),
        R9: SColl(SLong, scoreList).toHex()
    });

    // 6. Construir y firmar la transacción
    const creationHeight = await ergo.get_current_height();
    const unsignedTransaction = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(participationBoxOutput)
        .sendChangeTo(playerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    if (!signedTransaction) {
        throw new Error("El usuario canceló o falló la firma de la transacción.");
    }

    // 7. Enviar la transacción a la red
    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) {
        throw new Error("Fallo al enviar la transacción a la red.");
    }

    console.log(`Transacción de envío de puntuación enviada con éxito. ID: ${transactionId}`);
    return transactionId;
}