import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { getGopEndGameErgoTreeHex, getGopJudgesPaidErgoTreeHex } from '../contract';
import { calculatePayouts } from '../utils/payout_calculator';

declare const ergo: any;

/**
 * Executes a chained transaction that:
 * 1. Tx A: Transitions the game from Resolution to EndGame state
 * 2. Tx B: Finalizes the game and distributes funds
 * 
 * This allows completing the end game flow in a single user interaction.
 */
export async function end_game_chained(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string[]> {

    console.log(`[end_game_chained] Starting chained end game for: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Validaciones Previas ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    // --- 2. Construcción de Tx A (to_end_game) ---
    const endGameErgoTree = getGopEndGameErgoTreeHex();
    const parsedInputBox = parseBox(game.box);

    // Copy registers exactly from input box to ensure contract validation passes
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

    const utxos: Box<Amount>[] = await ergo.get_utxos();

    // --- 3. Calculate payouts for Tx B ---
    const {
        finalWinnerPrize,
        finalResolverPayout,
        finalDevPayout,
        finalJudgesPayout,
        winnerParticipation
    } = calculatePayouts(game, participations);

    // Prepare helper for outputs
    const gameNft = game.box.assets[0];
    const buildOutput = (amount: bigint, script: string, other_tokens: any[] = []) => {
        return new OutputBuilder(SAFE_MIN_BOX_VALUE, script)
            .addTokens([...other_tokens, { tokenId: game.participationTokenId!, amount: amount }]);
    };

    // Parse participation boxes for use in Tx B
    const participationBoxes = participations.map(p => parseBox(p.box));

    // --- 4. Build Chained Transaction ---
    // Key insight: The chain() callback receives a builder pre-initialized with parent outputs as inputs.
    // We need to explicitly select parent.outputs[0] (the EndGame box) and add participation boxes.
    // For fees in Tx B, we need to ensure there's enough ERG from participation boxes or use change from Tx A.

    // TODO BUG: seems that there are not participation boxes included in the chained tx B inputs?

    const unsignedTransactions = await new TransactionBuilder(currentHeight)
        .from([parsedInputBox, ...utxos])
        .to(endGameBoxOutput)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .chain(function (builder, parent) {
            console.log("Chaining end game transaction...");
            console.log("Parent outputs count:", parent.outputs.length);

            const outputs: OutputBuilder[] = [];

            if (winnerParticipation !== null && finalWinnerPrize > 0n) {
                const out = buildOutput(finalWinnerPrize, winnerParticipation.playerScript_Hex, [gameNft]);
                outputs.push(out);
            }

            if (finalResolverPayout > 0n) {
                const resolverOutput = buildOutput(finalResolverPayout, game.resolverScript_Hex, winnerParticipation === null ? [gameNft] : []);
                outputs.push(resolverOutput);
            }

            if (finalDevPayout > 0n) {
                outputs.push(buildOutput(finalDevPayout, game.constants.DEV_SCRIPT));
            }

            if (finalJudgesPayout > 0n && (game.judges ?? []).length > 0) {
                const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();
                const judgesTokenIdsBytes = game.judges.map(hexToBytes).filter(b => b !== null) as Uint8Array[];
                const tokenBytes = hexToBytes(game.participationTokenId) || new Uint8Array(0);

                const judgesPaidOutput = buildOutput(finalJudgesPayout, judgesPaidErgoTree)
                    .setAdditionalRegisters({
                        R4: SColl(SColl(SByte), judgesTokenIdsBytes).toHex(),
                        R5: SColl(SByte, tokenBytes).toHex()
                    });

                outputs.push(judgesPaidOutput);
            }

            // Build Tx B:
            // - parent.outputs[0] is the EndGame box from Tx A (SELF in the contract)
            // - participationBoxes are the participation inputs to be spent
            // - parent.outputs[1] (if exists) is the change from Tx A (user's remaining funds)

            const txBInputs = [
                parent.outputs[0],
                ...participationBoxes
            ];

            return builder
                .from(txBInputs)
                .to(outputs)
                .build();
        })
        .toEIP12Object();

    console.log("Unsigned chained transactions: ", unsignedTransactions);

    // --- 6. Sign and Submit Sequentially ---
    const signedTransactions: any[] = [];

    for (const tx of unsignedTransactions) {
        try {
            const signed = await ergo.sign_tx(tx);
            signedTransactions.push(signed);
            console.log("[end_game_chained] Signed transaction index ->", signedTransactions.length - 1);
        } catch (error) {
            console.error("[end_game_chained] Error signing transaction:", error);
            throw error;
        }
    }

    const transactionIds: string[] = [];
    for (const signed of signedTransactions) {
        const txId = await ergo.submit_tx(signed);
        transactionIds.push(txId);
        console.log("[end_game_chained] Submitted transaction id ->", txId);
    }

    console.log(`End game transactions submitted successfully. IDs: ${transactionIds.join(", ")}`);
    return transactionIds;
}
