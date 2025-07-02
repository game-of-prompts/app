// submit_score.ts
import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox,
    type Amount // Asegúrate de tener este tipo si Box es Box<Amount>
} from '@fleet-sdk/core';
import { SColl, SLong, SByte } from '@fleet-sdk/serializer';
import { hexToBytes, utf8StringToCollByteHex } from '$lib/ergo/utils'; // utf8StringToCollByteHex serializa un string a Coll[Byte] en formato hex
import { getGopParticipationBoxErgoTreeHex } from '../contract'; // Ajusta la ruta a contract.ts

// Asumimos que 'ergo' es una variable global/accesible del conector del wallet
// declare var ergo: any; 

/**
 * Construye y envía la transacción para crear una nueva GoP ParticipationBox.
 */
export async function submit_score( // Manteniendo el nombre de tu archivo/función
    gameNftIdHex: string,           // Para R6
    scoreList: bigint[],            // Para R9: Lista de puntuaciones, una es la real
    participationFeeForBox: bigint, // Valor de la caja (SELF.value)
    commitmentCHex: string,         // Para R5: Commitment que usa la puntuación real de scoreList
    solverIdString: string,         // Para R7: ID/Nombre del Solver (string UTF-8)
    hashLogsHex: string,            // Para R8: Hash de los logs (hex)
): Promise<string | null> {

    console.log("Attempting to submit score with params:", {
        gameNftIdHex,
        scoreList: scoreList.map(s => s.toString()), // Loguear como strings para legibilidad
        participationFeeForBox: participationFeeForBox.toString(),
        commitmentCHex,
        solverIdString,
        hashLogsHex
    });

    if (participationFeeForBox < SAFE_MIN_BOX_VALUE) {
        throw new Error(
            `Participation fee (${participationFeeForBox / 1000000000n} ERG) is less than the minimum required box value ` +
            `(${SAFE_MIN_BOX_VALUE / 1000000000n} ERG).`
        );
    }

    // 1. Obtener información del Wallet del Jugador
    const playerAddressString = await ergo.get_change_address();
    if (!playerAddressString) {
        throw new Error("Failed to get player's change address from wallet.");
    }
    const playerP2PKAddress = ErgoAddress.fromBase58(playerAddressString);
    const pkBytesArrayFromAddress = playerP2PKAddress.getPublicKeys();

    if (!pkBytesArrayFromAddress || pkBytesArrayFromAddress.length === 0) {
        throw new Error(`Could not extract public key from player address (${playerAddressString}) for R4.`);
    }
    const playerPkBytes_for_R4 = pkBytesArrayFromAddress[0];

    // 2. Obtener Inputs del Wallet del Jugador para cubrir la tarifa y la comisión de tx
    const inputs: InputBox[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No UTXOs found in the wallet to pay for participation. Please ensure your wallet has funds.");
    }

    // 3. Obtener ErgoTree del Contrato de ParticipationBox
    const participationContractErgoTree = getGopParticipationBoxErgoTreeHex();
    if (!participationContractErgoTree) {
        throw new Error("Failed to get GoP Participation Box Contract ErgoTree.");
    }

    // 4. Preparar Bytes/Valores Serializados para los Registros
    const commitmentC_bytes = hexToBytes(commitmentCHex);
    if (!commitmentC_bytes) throw new Error(`Failed to convert commitmentC hex '${commitmentCHex}' to bytes.`);

    const gameNftId_bytes = hexToBytes(gameNftIdHex);
    if (!gameNftId_bytes) throw new Error(`Failed to convert gameNftId hex '${gameNftIdHex}' to bytes.`);
    
    // R7: solverId (Coll[Byte] a partir de string UTF-8)
    const solverId_collByte_hex_for_R7 = utf8StringToCollByteHex(solverIdString); 
    if (!solverId_collByte_hex_for_R7) throw new Error (`Failed to convert solverId string to CollByteHex.`)
    
    const hashLogs_bytes = hexToBytes(hashLogsHex);
    if (!hashLogs_bytes) throw new Error(`Failed to convert hashLogs hex '${hashLogsHex}' to bytes.`);

    // R9: scoreList (Coll[Long])
    // SColl espera un array de BigInts o Numbers para SLong.
    // Asegurarse de que scoreList ya es bigint[] o convertir.
    const scoreList_for_R9_values = scoreList.map(s => BigInt(s)); // Asegurar que son BigInt
    const scoreList_collLong_hex_for_R9 = SColl(SLong, scoreList_for_R9_values).toHex();

    // 5. Construir la Salida (ParticipationBox)
    const participationBoxOutput = new OutputBuilder(
        participationFeeForBox, // El valor de la caja es la tarifa de participación
        participationContractErgoTree
    )
    .setAdditionalRegisters({
        R4: SColl(SByte, playerPkBytes_for_R4).toHex(),
        R5: SColl(SByte, commitmentC_bytes).toHex(),
        R6: SColl(SByte, gameNftId_bytes).toHex(),
        R7: solverId_collByte_hex_for_R7, 
        R8: SColl(SByte, hashLogs_bytes).toHex(),
        R9: scoreList_collLong_hex_for_R9 
    });

    // 6. Construir la Transacción
    const creationHeight = await ergo.get_current_height();
    const unsignedTransactionBuilder = new TransactionBuilder(creationHeight)
        .from(inputs) // Fleet SDK seleccionará las UTXOs necesarias de este pool
        .to(participationBoxOutput) // Pasar la instancia de OutputBuilder directamente
        .sendChangeTo(playerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE);
    
    const unsignedTransaction = await unsignedTransactionBuilder.build();
    const eip12UnsignedTransaction = unsignedTransaction.toEIP12Object();

    // 7. Firmar y Enviar
    console.log("Requesting transaction signing for score submission...");
    const signedTransaction = await ergo.sign_tx(eip12UnsignedTransaction);
    if (!signedTransaction) {
        throw new Error("Transaction signing was cancelled or failed by the user.");
    }

    console.log("Transaction signed. Submitting to Ergo network...");
    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) {
        throw new Error("Failed to submit score transaction to the network.");
    }

    console.log(`GoP Score submission transaction sent successfully. Transaction ID: ${transactionId}`);
    return transactionId;
}