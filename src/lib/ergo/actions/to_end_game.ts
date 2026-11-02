import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE
} from '@fleet-sdk/core';
import { SInt } from '@fleet-sdk/serializer';
import { parseBox } from '$lib/ergo/utils';
import { ENDING_GAME_STATE } from '$lib/common/constants';
import { type GameResolution } from '$lib/common/game';
import { getGopEndGameErgoTreeHex } from '../contract';
import { ErgoPlatform } from '../platform';


declare const ergo: any;

export async function to_end_game(
    game: GameResolution
): Promise<string> {

    console.log(`[to_end_game] Starting transition to end game for: ${game.boxId}`);

    const currentHeight = await (new ErgoPlatform()).get_current_height();
    const userAddress = await ergo.get_change_address();

    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    const endGameErgoTree = getGopEndGameErgoTreeHex();

    const parsedInputBox = parseBox(game.box);

    const outputRegisters = {
        R4: SInt(ENDING_GAME_STATE).toHex(),
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
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(parsedInputBox, { ensureInclusion: true })
        .and.from(utxos)
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
