import {
    OutputBuilder,
    TransactionBuilder,
    type Box,
    type Amount
} from "@fleet-sdk/core";
import { type GameResolution, type ValidParticipation } from "$lib/common/game";
import { getGopParticipationBatchErgoTreeHex } from "../contract";
import { parseBox } from "../utils";

declare const ergo: any;

const MAX_INPUTS_PER_BATCH = 2;

export async function batch_participations(
    game: GameResolution,
    participations: ValidParticipation[],
    batches: Box<Amount>[]
): Promise<string> {
    const currentHeight = await ergo.get_current_height();
    const batchScript = getGopParticipationBatchErgoTreeHex();

    // 1. Select inputs (mix of participations and batches)
    // We prioritize batches to merge them, then participations
    let inputs: Box<Amount>[] = [];
    let inputsCount = 0;

    // Add existing batches first
    for (const batch of batches) {
        if (inputsCount >= MAX_INPUTS_PER_BATCH) break;
        inputs.push(batch);
        inputsCount++;
    }

    // Add participations if we still have space
    for (const p of participations) {
        if (inputsCount >= MAX_INPUTS_PER_BATCH) break;
        inputs.push(p.box);
        inputsCount++;
    }

    if (inputs.length < 2) {
        throw new Error("Not enough inputs to batch (minimum 2).");
    }

    // 2. Calculate totals
    let totalNanoErgs = 0n;
    let totalParticipationTokens = 0n;
    const participationTokenId = game.participationTokenId;

    for (const input of inputs) {
        totalNanoErgs += BigInt(input.value);
        if (participationTokenId) {
            const token = input.assets.find(t => t.tokenId === participationTokenId);
            if (token) {
                totalParticipationTokens += BigInt(token.amount);
            }
        }
    }

    // 3. Create output batch box
    const outputBuilder = new OutputBuilder(
        totalNanoErgs,
        batchScript
    ).setAdditionalRegisters({
        R6: game.gameId // gameNftId
    });

    if (participationTokenId && totalParticipationTokens > 0n) {
        outputBuilder.addTokens({
            tokenId: participationTokenId,
            amount: totalParticipationTokens
        });
    }

    // 4. Build transaction
    const unsignedTx = new TransactionBuilder(currentHeight)
        .from(inputs.map(parseBox))
        .withDataFrom([parseBox(game.box)]) // Game box as data input
        .to(outputBuilder)
        .sendChangeTo(await ergo.get_change_address())
        .payMinFee()
        .build()
        .toEIP12Object();

    // 5. Sign and submit
    const signedTx = await ergo.sign_tx(unsignedTx);
    return await ergo.submit_tx(signedTx);
}
