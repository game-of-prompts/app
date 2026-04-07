import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
} from "@fleet-sdk/core";
import { SColl, SLong, SByte } from "@fleet-sdk/serializer";
import { WrappedErgManager } from "wrapped-erg";
import { hexToBytes } from "$lib/ergo/utils";
import { getGopParticipationErgoTreeHex } from "../contract";
import { prependHexPrefix } from "$lib/utils";
import {
    getWrappedErgWalletAdapter,
    resolveWrappedErgBankByTokenId,
} from "../wrapped-erg";

declare const ergo: any;

async function signAndSubmitChain(unsignedTransactions: any[]): Promise<string> {
    const transactionIds: string[] = [];

    for (const tx of unsignedTransactions) {
        const signed = await ergo.sign_tx(tx);
        const txId = await ergo.submit_tx(signed);
        transactionIds.push(txId);
    }

    return transactionIds.join(", ");
}

export async function submit_score_wrapped_erg_chained(
    gameNftIdHex: string,
    scoreList: bigint[],
    participationFeeForBox: bigint,
    participationTokenId: string,
    commitmentCHex: string,
    solverIdString: string,
    hashLogsHex: string,
): Promise<string | null> {
    if (scoreList.length > 10) {
        throw new Error("The scores list cannot have more than 10 items.");
    }

    const bank = await resolveWrappedErgBankByTokenId(participationTokenId);
    if (!bank) {
        throw new Error(
            "Could not resolve the Wrapped ERG bank required to participate in this competition.",
        );
    }

    const playerAddressString = await ergo.get_change_address();
    if (!playerAddressString) {
        throw new Error("Could not get the player's address from the wallet.");
    }

    const playerP2PKAddress = ErgoAddress.fromBase58(playerAddressString);
    const playerPkBytes = playerP2PKAddress.getPublicKeys()[0];
    if (!playerPkBytes) {
        throw new Error(
            `Could not extract the public key from the player's address (${playerAddressString}).`,
        );
    }

    const participationContractErgoTree = getGopParticipationErgoTreeHex();
    if (!participationContractErgoTree) {
        throw new Error("Could not get the participation contract ErgoTree.");
    }

    const commitmentCBytes = hexToBytes(commitmentCHex);
    const gameNftIdBytes = hexToBytes(gameNftIdHex);
    const hashLogsBytes = hexToBytes(hashLogsHex);
    const solverIdBytes = hexToBytes(solverIdString);

    if (!commitmentCBytes) throw new Error("Could not convert commitmentC to bytes.");
    if (!gameNftIdBytes) throw new Error("Could not convert gameNftId to bytes.");
    if (!hashLogsBytes) throw new Error("Could not convert hashLogs to bytes.");
    if (!solverIdBytes) throw new Error("Could not convert solverId to bytes.");

    const participationBoxOutput = new OutputBuilder(
        SAFE_MIN_BOX_VALUE,
        participationContractErgoTree,
    )
        .addTokens({
            tokenId: participationTokenId,
            amount: participationFeeForBox,
        })
        .setAdditionalRegisters({
            R4: SColl(SByte, prependHexPrefix(playerPkBytes)).toHex(),
            R5: SColl(SByte, commitmentCBytes).toHex(),
            R6: SColl(SByte, gameNftIdBytes).toHex(),
            R7: SColl(SByte, solverIdBytes).toHex(),
            R8: SColl(SByte, hashLogsBytes).toHex(),
            R9: SColl(SLong, scoreList).toHex(),
        });

    const manager = new WrappedErgManager(
        getWrappedErgWalletAdapter(),
        bank.wergTokenId,
    );

    const wrapBuilder = await manager.wrapBuilder({
        amountNanoErg: participationFeeForBox,
    });

    const unsignedTransactions = (wrapBuilder.build() as any)
        .chain((builder: TransactionBuilder) => {
            return builder
                .to(participationBoxOutput)
                .sendChangeTo(playerAddressString)
                .payFee(RECOMMENDED_MIN_FEE_VALUE)
                .build();
        })
        .toEIP12Object();

    return signAndSubmitChain(unsignedTransactions);
}
