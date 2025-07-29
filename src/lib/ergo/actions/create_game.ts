import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type InputBox,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair } from '@fleet-sdk/serializer';
import { hexToBytes, SString } from '$lib/ergo/utils'; 
import { getGopGameBoxErgoTreeHex, getGopParticipationBoxScriptHash } from '../contract';

declare var ergo: any;

export async function create_game(
    gameServiceId: string,
    hashedSecret: string,
    deadlineBlock: number,
    creatorStakeNanoErg: bigint,
    participationFeeNanoErg: bigint,
    commissionPercentage: number,
    gameDetailsJson: string,
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
        R5: SPair(SLong(0n), SColl(SByte, hashedSecretBytes)).toHex(),
        R6: SColl(SByte, expectedParticipationScriptHashBytes).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStakeNanoErg, participationFeeNanoErg]).toHex(),
        R8: SInt(commissionPercentage).toHex(),
        R9: SString(gameDetailsJson)
    });

    const creationHeight = await ergo.get_current_height();
    const unsignedTransactionBuilder = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(gameBoxOutput)
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
