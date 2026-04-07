import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from "@fleet-sdk/core";
import { SColl, SByte } from "@fleet-sdk/serializer";
import { WrappedErgManager } from "wrapped-erg";
import { parseBox, pkHexToBase58Address, hexToBytes } from "$lib/ergo/utils";
import {
    type GameResolution,
    type ValidParticipation,
} from "$lib/common/game";
import {
    getGopEndGameErgoTreeHex,
    getGopJudgesPaidErgoTreeHex,
} from "../contract";
import { calculatePayouts } from "../utils/payout_calculator";
import { ErgoPlatform } from "../platform";
import {
    fetchWrappedErgBankBoxByTokenId,
    resolveWrappedErgBankByTokenId,
} from "../wrapped-erg";

declare const ergo: any;

function toBigIntSafe(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value.trim());
    return 0n;
}

async function signAndSubmitChain(unsignedTransactions: any[]): Promise<string[]> {
    const transactionIds: string[] = [];

    for (const tx of unsignedTransactions) {
        const signed = await ergo.sign_tx(tx);
        const txId = await ergo.submit_tx(signed);
        transactionIds.push(txId);
    }

    return transactionIds;
}

export async function end_game_wrapped_erg_chained(
    game: GameResolution,
    participations: ValidParticipation[],
): Promise<string[]> {
    const bank = await resolveWrappedErgBankByTokenId(game.participationTokenId);
    const bankBox = await fetchWrappedErgBankBoxByTokenId(game.participationTokenId);
    if (!bank || !bankBox) {
        throw new Error(
            "Could not resolve the Wrapped ERG bank required to finalize this competition.",
        );
    }

    const currentHeight = await new ErgoPlatform().get_current_height();
    const userAddress = await ergo.get_change_address();

    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    const {
        finalWinnerPrize,
        finalResolverPayout,
        finalDevPayout,
        finalJudgesPayout,
        winnerParticipation,
    } = calculatePayouts(game, participations);

    let requiredSignerAddress: string;
    let executorPayoutAmount: bigint;

    if (winnerParticipation === null) {
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex || undefined);
        executorPayoutAmount = finalResolverPayout;
    } else {
        requiredSignerAddress = pkHexToBase58Address(
            winnerParticipation.playerPK_Hex || undefined,
        );
        executorPayoutAmount = finalWinnerPrize;
    }

    if (userAddress !== requiredSignerAddress) {
        throw new Error(
            `Invalid signature. Executor (${requiredSignerAddress}) required.`,
        );
    }

    const endGameErgoTree = getGopEndGameErgoTreeHex();
    const parsedInputBox = parseBox(game.box);
    const outputRegisters = {
        R4: parsedInputBox.additionalRegisters.R4,
        R5: parsedInputBox.additionalRegisters.R5,
        R6: parsedInputBox.additionalRegisters.R6,
        R7: parsedInputBox.additionalRegisters.R7,
        R8: parsedInputBox.additionalRegisters.R8,
        R9: parsedInputBox.additionalRegisters.R9,
    };

    const endGameBoxOutput = new OutputBuilder(
        BigInt(game.box.value),
        endGameErgoTree,
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters(outputRegisters);

    const utxos = await ergo.get_utxos();
    const participationBoxes = participations.map((p) => parseBox(p.box));

    const gameNft = game.box.assets[0];
    const buildTokenOutput = (
        amount: bigint,
        script: string,
        otherTokens: any[] = [],
    ) =>
        new OutputBuilder(SAFE_MIN_BOX_VALUE, script).addTokens([
            ...otherTokens,
            { tokenId: game.participationTokenId, amount },
        ]);

    const unsignedTransactions = (new TransactionBuilder(currentHeight)
        .from(parsedInputBox, { ensureInclusion: true })
        .and.from(utxos)
        .to(endGameBoxOutput)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build() as any)
        .chain((builder: TransactionBuilder, parent: any) => {
            const outputs: OutputBuilder[] = [];
            let executorOutputIndex = -1;

            if (winnerParticipation !== null && finalWinnerPrize > 0n) {
                const winnerOutput = buildTokenOutput(
                    finalWinnerPrize,
                    winnerParticipation.playerScript_Hex,
                    [gameNft],
                );
                outputs.push(winnerOutput);
                executorOutputIndex = outputs.length - 1;
            }

            if (finalResolverPayout > 0n) {
                const resolverOutput = buildTokenOutput(
                    finalResolverPayout,
                    game.resolverScript_Hex,
                    winnerParticipation === null ? [gameNft] : [],
                );
                outputs.push(resolverOutput);
                if (winnerParticipation === null) {
                    executorOutputIndex = outputs.length - 1;
                }
            }

            if (finalDevPayout > 0n) {
                outputs.push(buildTokenOutput(finalDevPayout, game.devScript));
            }

            if (finalJudgesPayout > 0n && (game.judges ?? []).length > 0) {
                const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();
                const judgesTokenIdsBytes = game.judges
                    .map(hexToBytes)
                    .filter((b) => b !== null) as Uint8Array[];
                const tokenBytes = hexToBytes(game.participationTokenId) || new Uint8Array(0);

                const judgesPaidOutput = buildTokenOutput(
                    finalJudgesPayout,
                    judgesPaidErgoTree,
                ).setAdditionalRegisters({
                    R4: SColl(SColl(SByte), judgesTokenIdsBytes).toHex(),
                    R5: SColl(SByte, tokenBytes).toHex(),
                });

                outputs.push(judgesPaidOutput);
            }

            const txB = builder
                .from([parent.outputs[0], ...participationBoxes], {
                    ensureInclusion: true,
                })
                .to(outputs)
                .sendChangeTo(userAddress)
                .payFee(RECOMMENDED_MIN_FEE_VALUE)
                .build();

            if (executorPayoutAmount <= 0n || executorOutputIndex < 0) {
                return txB;
            }

            return (txB as any).chain((builder2: TransactionBuilder, parent2: any) => {
                const executorOutput = parent2.outputs[executorOutputIndex];
                const currentBankWerg = toBigIntSafe(
                    bankBox.assets?.find(
                        (asset) => asset.tokenId === game.participationTokenId,
                    )?.amount,
                );
                const currentBankErg = toBigIntSafe(bankBox.value);
                const bankTokenIdBytes = hexToBytes(bank.wergTokenId);
                if (!bankTokenIdBytes) {
                    throw new Error("Wrapped ERG bank token ID is invalid.");
                }
                const updatedBankOutput = new OutputBuilder(
                    currentBankErg - executorPayoutAmount,
                    WrappedErgManager.compileBankContract(),
                )
                    .addTokens({
                        tokenId: game.participationTokenId,
                        amount: currentBankWerg + executorPayoutAmount,
                    })
                    .setAdditionalRegisters({
                        R4: SColl(SByte, bankTokenIdBytes).toHex(),
                    });

                const executorResidualTokens = (executorOutput.assets ?? [])
                    .filter((asset: any) => asset.tokenId !== game.participationTokenId)
                    .map((asset: any) => ({
                        tokenId: asset.tokenId,
                        amount: toBigIntSafe(asset.amount),
                    }));

                const convertedExecutorOutput = new OutputBuilder(
                    toBigIntSafe(executorOutput.value) + executorPayoutAmount,
                    executorOutput.ergoTree,
                );

                if (executorResidualTokens.length > 0) {
                    convertedExecutorOutput.addTokens(executorResidualTokens);
                }

                return builder2
                    .from([bankBox as any, executorOutput], {
                        ensureInclusion: true,
                    })
                    .to([updatedBankOutput, convertedExecutorOutput])
                    .sendChangeTo(userAddress)
                    .payFee(RECOMMENDED_MIN_FEE_VALUE)
                    .build();
            });
        })
        .toEIP12Object();

    return signAndSubmitChain(unsignedTransactions);
}
