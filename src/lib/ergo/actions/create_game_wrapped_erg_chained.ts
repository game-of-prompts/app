import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    BOX_VALUE_PER_BYTE,
} from "@fleet-sdk/core";
import { SColl, SLong, SInt, SByte } from "@fleet-sdk/serializer";
import { stringToBytes } from "@scure/base";
import { WrappedErgManager } from "wrapped-erg";
import { hexToBytes } from "$lib/ergo/utils";
import {
    getGopGameActiveErgoTreeHex,
    getGopMintIdtAddress,
} from "../contract";
import { getGameConstants } from "$lib/common/constants";
import { DEV_SCRIPT, DEV_COMMISSION_PERCENTAGE } from "../envs";
import {
    estimateTotalBoxSizeFromInputs,
    MAX_BOX_SIZE,
    type GameBoxInputs,
} from "../utils/box-size-calculator";
import { ErgoPlatform } from "../platform";
import {
    getWrappedErgWalletAdapter,
    resolveWrappedErgBankByTokenId,
} from "../wrapped-erg";

declare const ergo: any;

function randomSeed(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    return Array.from(array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
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

export async function create_game_wrapped_erg_chained(
    gameServiceId: string,
    hashedSecret: string,
    deadlineBlock: number,
    resolverStakeAmount: bigint,
    participationFeeAmount: bigint,
    commissionPercentage: number,
    judges: string[],
    gameDetailsJson: string,
    perJudgeCommissionPercentage: number,
    participationTokenId: string,
    timeWeight: bigint,
    eip4ImageHash?: string,
    eip4ImageLink?: string,
): Promise<string[] | null> {
    const bank = await resolveWrappedErgBankByTokenId(participationTokenId);
    if (!bank) {
        throw new Error(
            "Could not resolve a Wrapped ERG bank for this participation token.",
        );
    }

    const seedHex = randomSeed();

    let gameTitle = "Game of Prompts";
    let gameDescription = "A Game of Prompts competition";
    try {
        const details = JSON.parse(gameDetailsJson);
        if (details.title) gameTitle = details.title;
        if (details.description) gameDescription = details.description;
    } catch (e) {
        console.warn("Failed to parse game details JSON", e);
    }

    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Could not get the creator's address from the wallet.");
    }

    const activeGameErgoTree = getGopGameActiveErgoTreeHex();
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) {
        throw new Error("Failed to convert the hashedSecret to bytes.");
    }

    const seedBytes = hexToBytes(seedHex);
    if (!seedBytes) {
        throw new Error("Failed to convert the seedHex to bytes.");
    }

    const ceremonyDeadlineBlock =
        deadlineBlock - getGameConstants().PARTICIPATION_TIME_WINDOW;
    const currentHeight = await new ErgoPlatform().get_current_height();

    if (currentHeight >= ceremonyDeadlineBlock) {
        throw new Error(
            `Current height (${currentHeight}) is past the ceremony deadline (${ceremonyDeadlineBlock}). Increase the deadline or reduce the participation time window.`,
        );
    }

    const gameDetailsBytes = stringToBytes("utf8", gameDetailsJson);
    const judgesColl = judges
        .map((judgeId) => {
            const bytes = hexToBytes(judgeId);
            return bytes ? [...bytes] : null;
        })
        .filter((item): item is number[] => item !== null);

    const participationTokenIdBytes = hexToBytes(participationTokenId);
    if (!participationTokenIdBytes) {
        throw new Error("Failed to convert participationTokenId to bytes.");
    }

    const boxSizeInputs: GameBoxInputs = {
        seedBytes,
        ceremonyDeadlineBlock,
        hashedSecretBytes,
        judgesColl,
        deadlineBlock,
        resolverStakeAmount,
        participationFeeAmount,
        perJudgeCommissionPercentage: Math.round(
            perJudgeCommissionPercentage * 10000,
        ),
        commissionPercentage: Math.round(commissionPercentage * 10000),
        gameDetailsBytes,
        participationTokenIdBytes,
    };

    const sizeResult = estimateTotalBoxSizeFromInputs(boxSizeInputs);
    if (!sizeResult) {
        throw new Error(
            "Failed to calculate box sizes. The box might be too large or contain invalid data.",
        );
    }
    if (sizeResult.maxSize > MAX_BOX_SIZE) {
        throw new Error(
            `The maximum box size (${sizeResult.maxSize} bytes) exceeds the limit of ${MAX_BOX_SIZE} bytes.`,
        );
    }

    const creationHeight = await new ErgoPlatform().get_current_height();
    const r4Hex = SInt(0).toHex();
    const r5Hex = SColl(SByte, seedBytes).toHex();
    const r6Hex = SColl(SByte, hashedSecretBytes).toHex();
    const r7Hex = SColl(SColl(SByte), judgesColl).toHex();
    const commission = BigInt(
        Math.round(
            (commissionPercentage / 100) *
                getGameConstants().COMMISSION_DENOMINATOR,
        ),
    );
    const perJudgeCommission = BigInt(
        Math.round(
            (perJudgeCommissionPercentage / 100) *
                getGameConstants().COMMISSION_DENOMINATOR,
        ),
    );
    const devCommission = BigInt(
        Math.round(
            (DEV_COMMISSION_PERCENTAGE / 100) *
                getGameConstants().COMMISSION_DENOMINATOR,
        ),
    );
    const devScriptBytes = hexToBytes(DEV_SCRIPT);
    if (!devScriptBytes) {
        throw new Error("Invalid DEV_SCRIPT constant");
    }

    const r8Hex = SColl(SLong, [
        BigInt(creationHeight),
        timeWeight,
        BigInt(deadlineBlock),
        resolverStakeAmount,
        participationFeeAmount,
        perJudgeCommission,
        commission,
        devCommission,
    ]).toHex();
    const r9Hex = SColl(SColl(SByte), [
        gameDetailsBytes,
        participationTokenIdBytes,
        devScriptBytes,
    ]).toHex();

    const registers = {
        R4: r4Hex,
        R5: r5Hex,
        R6: r6Hex,
        R7: r7Hex,
        R8: r8Hex,
        R9: r9Hex,
    };

    const minRequiredValue = BigInt(sizeResult.maxSize) * BOX_VALUE_PER_BYTE;
    const maxBigInt = (...vals: bigint[]) =>
        vals.reduce((a, b) => (a > b ? a : b), vals[0]);
    const gameValue = maxBigInt(SAFE_MIN_BOX_VALUE, minRequiredValue);

    const mintIdtAddress = getGopMintIdtAddress();
    const mintOutput = new OutputBuilder(SAFE_MIN_BOX_VALUE, mintIdtAddress)
        .mintToken({
            amount: 1n,
            name: gameTitle,
            decimals: 0,
            description: gameDescription,
        });

    if (eip4ImageHash && eip4ImageLink) {
        const imageHashBytes = hexToBytes(eip4ImageHash);
        if (imageHashBytes) {
            mintOutput.setAdditionalRegisters({
                R7: SColl(SByte, [0x01, 0x01]).toHex(),
                R8: SColl(SByte, imageHashBytes).toHex(),
                R9: SColl(SByte, stringToBytes("utf8", eip4ImageLink)).toHex(),
            });
        }
    }

    const manager = new WrappedErgManager(
        getWrappedErgWalletAdapter(),
        bank.wergTokenId,
    );

    const wrapBuilder = await manager.wrapBuilder({
        amountNanoErg: resolverStakeAmount,
    });

    const unsignedTransactions = (wrapBuilder.build() as any)
        .chain((builder: TransactionBuilder, parent: any) => {
            if (!parent.change.length) {
                throw new Error(
                    "Wrapped ERG step did not produce a change output for minting the game NFT.",
                );
            }

            return builder
                .to(mintOutput)
                .sendChangeTo(creatorAddressString)
                .payFee(RECOMMENDED_MIN_FEE_VALUE)
                .build()
                .chain((builder2: TransactionBuilder, parent2: any) => {
                    const mintBox = parent2.outputs[0];
                    const gameTokenId = parent2.inputs[0].boxId;

                    const gameBoxOutput = new OutputBuilder(
                        gameValue,
                        activeGameErgoTree,
                    )
                        .addTokens([
                            { tokenId: gameTokenId, amount: 1n },
                            {
                                tokenId: participationTokenId,
                                amount: resolverStakeAmount,
                            },
                        ])
                        .setAdditionalRegisters(registers);

                    return builder2
                        .from(mintBox, { ensureInclusion: true })
                        .to(gameBoxOutput)
                        .sendChangeTo(creatorAddressString)
                        .payFee(RECOMMENDED_MIN_FEE_VALUE)
                        .build();
                });
        })
        .toEIP12Object();

    return signAndSubmitChain(unsignedTransactions);
}
