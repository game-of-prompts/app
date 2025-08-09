import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair } from '@fleet-sdk/serializer';
import { hexToBytes, SString } from '$lib/ergo/utils'; 
import { getGopGameActiveErgoTreeHex } from '../contract'; // <-- Importación actualizada

declare var ergo: any;

/**
 * Crea una transacción para generar una caja de juego en estado "GameActive".
 * @param gameServiceId - ID del servicio (opcional, puede ir en los detalles).
 * @param hashedSecret - El hash Blake2b256 del secreto 'S'.
 * @param deadlineBlock - Altura de bloque en la que finaliza el juego.
 * @param creatorStakeNanoErg - Cantidad de ERG que el creador pone en juego.
 * @param participationFeeNanoErg - Tarifa para que los jugadores participen.
 * @param commissionPercentage - Porcentaje de comisión para el creador.
 * @param invitedJudges - Array de IDs de los tokens de reputación de los jueces invitados.
 * @param gameDetailsJson - String JSON con los detalles del juego (título, descripción, etc.).
 * @returns El ID de la transacción enviada.
 */
export async function create_game(
    gameServiceId: string, // Aunque no se usa directamente, es bueno mantenerlo por consistencia
    hashedSecret: string,
    deadlineBlock: number,
    creatorStakeNanoErg: bigint,
    participationFeeNanoErg: bigint,
    commissionPercentage: number,
    invitedJudges: string[], // <-- Nuevo parámetro para los jueces
    gameDetailsJson: string
): Promise<string | null> {

    console.log("Intentando crear un juego con los nuevos contratos (GameActive):", {
        hashedSecret: hashedSecret.substring(0, 10) + "...",
        deadlineBlock,
        creatorStakeNanoErg: creatorStakeNanoErg.toString(),
        invitedJudges,
        gameDetailsJsonBrief: gameDetailsJson.substring(0, 100) + "..."
    });

    // --- 1. Preparación de datos y direcciones ---
    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("No se pudo obtener la dirección del creador desde la billetera.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);
    const creatorPkBytes = creatorP2PKAddress.getPublicKeys()[0];
    if (!creatorPkBytes) {
        throw new Error(`No se pudo extraer la clave pública de la dirección ${creatorAddressString}.`);
    }

    const inputs: InputBox[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No se encontraron UTXOs en la billetera para crear el juego.");
    }

    if (creatorStakeNanoErg < SAFE_MIN_BOX_VALUE) {
        throw new Error(`El stake del creador (${creatorStakeNanoErg}) es menor que el mínimo seguro.`);
    }

    // --- 2. Construcción de la caja de salida del juego ---
    const activeGameErgoTree = getGopGameActiveErgoTreeHex();
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Fallo al convertir el hashedSecret a bytes.");

    // Convertir los IDs de los jueces a un formato que el contrato entienda (Coll[Coll[Byte]])
    const judgesColl = invitedJudges.map(judgeId => hexToBytes(judgeId));

    const gameBoxOutput = new OutputBuilder(
        creatorStakeNanoErg,
        activeGameErgoTree
    )
    .mintToken({ 
        amount: 1n,
        decimals: 0
    })
    .setAdditionalRegisters({
        // Estructura de registros según `game_active.es`
        R4: SPair(SColl(SByte, creatorPkBytes), SInt(commissionPercentage)).toHex(),
        R5: SColl(SByte, hashedSecretBytes).toHex(),
        R6: SColl(SColl(SByte, judgesColl)).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStakeNanoErg, participationFeeNanoErg]).toHex(),
        // R8 ya no se usa aquí.
        R9: SString(gameDetailsJson)
    });

    // --- 3. Construcción y envío de la transacción ---
    const creationHeight = await ergo.get_current_height();
    const unsignedTransaction = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(gameBoxOutput)
        .sendChangeTo(creatorAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const transactionId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción de creación de juego (GameActive) enviada con éxito. ID: ${transactionId}`);
    return transactionId;
}