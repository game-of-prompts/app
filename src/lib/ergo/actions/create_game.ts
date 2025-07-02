import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox,
    type Amount // Asegúrate de tener Amount si Box es Box<Amount>
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte } from '@fleet-sdk/serializer';
// Asumimos que SString de utils.ts serializa un string a formato constante "0e..." para registros
import { hexToBytes, SString, uint8ArrayToHex } from '$lib/ergo/utils'; 
import { getGopGameBoxErgoTreeHex, getGopParticipationBoxScriptHash } from '../contract'; // Ajusta la ruta

// declare var ergo: any; // Si 'ergo' es global y no se pasa a través de platformInstance

export async function create_game(
    gameServiceId: string,
    hashedSecret: string,     // Hex de blake2b256(S) para R5
    deadlineBlock: number,    // Para R7
    creatorStakeNanoErg: bigint, // Para R7 y valor de la caja
    participationFeeNanoErg: bigint, // Para R7
    commissionPercentage: number,    // Para R8
    gameDetailsJson: string,  // Para R9
): Promise<string | null> {

    console.log("Attempting to create GoP game with params:", { 
        gameServiceId,
        hashedSecret: hashedSecret.substring(0, 10) + "...",
        deadlineBlock,
        creatorStakeNanoErg: creatorStakeNanoErg.toString(),
        participationFeeNanoErg: participationFeeNanoErg.toString(),
        commissionPercentage,
        gameDetailsJsonBrief: gameDetailsJson.substring(0, 100) + "..."
    });

    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Failed to get creator's change address from wallet.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);
    const pkBytesArrayFromAddress = creatorP2PKAddress.getPublicKeys();
    if (!pkBytesArrayFromAddress || pkBytesArrayFromAddress.length === 0) {
        // Considera no usar alert() en funciones de librería, mejor lanzar error.
        const msg = `Could not extract public key from creator address (${creatorAddressString}) for R4.`;
        console.error(msg);
        throw new Error(msg);
    }
    const creatorPkBytes_for_R4 = pkBytesArrayFromAddress[0];

    const inputs: InputBox[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No UTXOs found in the wallet to create the game.");
    }

    if (creatorStakeNanoErg < SAFE_MIN_BOX_VALUE) {
        throw new Error(
            `Creator stake (${creatorStakeNanoErg / 1000000000n} ERG) is less than SAFE_MIN_BOX_VALUE.`
        );
    }
    const outputBoxValue = creatorStakeNanoErg;
    const gopGameContractErgoTree = getGopGameBoxErgoTreeHex();

    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Failed to convert hashedSecret hex to bytes.");
    
    const expectedParticipationScriptHashBytes = hexToBytes(getGopParticipationBoxScriptHash());
    if (!expectedParticipationScriptHashBytes) throw new Error("Failed to convert expected participation script hash hex to bytes.");

    // Como indicaste, no se necesita name/description para mintToken si se manejan vía registros de la caja que contiene el NFT (o no se usan)
    const gameBoxOutput = new OutputBuilder(
        outputBoxValue,
        gopGameContractErgoTree
    )
    .mintToken({ 
        amount: 1n,
        decimals: 0
    })
    .setAdditionalRegisters({
        R4: SColl(SByte, creatorPkBytes_for_R4).toHex(),
        R5: SColl(SByte, hashedSecretBytes).toHex(),
        R6: SColl(SByte, expectedParticipationScriptHashBytes).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStakeNanoErg, participationFeeNanoErg]).toHex(),
        R8: SInt(commissionPercentage).toHex(),
        R9: SString(gameDetailsJson) // SString de utils.ts debe devolver el hex de la constante serializada
    });

    const creationHeight = await ergo.get_current_height();
    const unsignedTransactionBuilder = new TransactionBuilder(creationHeight)
        .from(inputs) // Fleet SDK seleccionará las UTXOs necesarias de este pool
        .to(gameBoxOutput) // No llamar a .build() en gameBoxOutput aquí
        .sendChangeTo(creatorAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE);
    
    const unsignedTransaction = await unsignedTransactionBuilder.build();
    const eip12UnsignedTransaction = await unsignedTransaction.toEIP12Object();

    console.log("Requesting transaction signing for game creation...");
    const signedTransaction = await ergo.sign_tx(eip12UnsignedTransaction);
    if (!signedTransaction) throw new Error("Transaction signing was cancelled or failed.");

    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) throw new Error("Failed to submit transaction to the network.");

    console.log(`GoP Game creation transaction submitted successfully. Transaction ID: ${transactionId}`);
    return transactionId;
}