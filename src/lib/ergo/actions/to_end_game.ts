import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution } from '$lib/common/game';
import { getGopEndGameErgoTreeHex } from '../contract';


declare const ergo: any;

export async function to_end_game(
    game: GameResolution
): Promise<string> {

    console.log(`[to_end_game] Starting transition to end game for: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    const endGameErgoTree = getGopEndGameErgoTreeHex();

    const r4Hex = SInt(1).toHex();
    const r5Hex = SColl(SByte, hexToBytes(game.seed)!).toHex();

    const revealedSBytes = hexToBytes(game.revealedS_Hex)!;
    const winnerCommitmentBytes = game.winnerCandidateCommitment ? hexToBytes(game.winnerCandidateCommitment)! : new Uint8Array();
    const r6Hex = SPair(SColl(SByte, revealedSBytes), SColl(SByte, winnerCommitmentBytes)).toHex();

    const judgesBytes = game.judges.map(j => hexToBytes(j)!);
    const r7Hex = SColl(SColl(SByte), judgesBytes).toHex();


    const inputR9 = game.box.additionalRegisters.R9;
    if (!inputR9) throw new Error("Input box missing R9");

    const r9HexFromInput = inputR9;

    const registers = {
        R4: game.box.additionalRegisters.R4,
        R5: game.box.additionalRegisters.R5,
        R6: game.box.additionalRegisters.R6,
        R7: game.box.additionalRegisters.R7,
        R8: game.box.additionalRegisters.R8,
        R9: game.box.additionalRegisters.R9
    };

    const parsedInputBox = parseBox(game.box);

    const outputRegisters = {
        R4: parsedInputBox.additionalRegisters.R4,
        R5: parsedInputBox.additionalRegisters.R5,
        R6: parsedInputBox.additionalRegisters.R6,
        R7: parsedInputBox.additionalRegisters.R7,
        R8: parsedInputBox.additionalRegisters.R8,
        R9: parsedInputBox.additionalRegisters.R9
    };

    const endGameBoxOutput = new OutputBuilder(
        BigInt(game.box.value),
        endGameErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters(outputRegisters);

    const utxos = await ergo.get_utxos();
    const inputs = [parsedInputBox, ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(endGameBoxOutput)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`[to_end_game] Success! Tx ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.error("[to_end_game] Tx Error:", error);
        throw error;
    }
}
