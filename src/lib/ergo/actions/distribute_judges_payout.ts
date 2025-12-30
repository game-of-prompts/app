import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { parseBox, hexToBytes, parseCollByteToHex, uint8ArrayToHex } from '$lib/ergo/utils';
import { getGopJudgesPaidErgoTreeHex, getReputationProofScriptHash } from '../contract';
import { fetchJudges } from '../reputation/fetch';
import { GAME } from '../reputation/types';
import { SConstant } from '@fleet-sdk/serializer';

declare const ergo: any;

/**
 * Distributes funds from a judges_paid box to the participating judges.
 * @param judgesPaidBox The box containing the funds to distribute.
 * @returns The transaction ID if successful.
 */
export async function distribute_judges_payout(
    judgesPaidBox: Box<Amount>
): Promise<string> {
    console.log(`[distribute_judges_payout] Starting distribution for box: ${judgesPaidBox.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();
    const reputationProofScriptHash = getReputationProofScriptHash();

    // 1. Parse Registers
    const r4 = judgesPaidBox.additionalRegisters['R4'];
    const r5 = judgesPaidBox.additionalRegisters['R5'];

    if (!r4 || !r5) {
        throw new Error("Invalid judges_paid box: Missing registers R4 or R5.");
    }

    // Decode R4 (Participating Judges Token IDs)
    // @ts-ignore
    const participatingJudgesBytes = SConstant.fromHex(r4).data as Uint8Array[];
    const participatingJudgesTokenIds = participatingJudgesBytes.map(b => uint8ArrayToHex(b));

    // Decode R5 (Participation Token ID)
    // @ts-ignore
    const participationTokenIdBytes = SConstant.fromHex(r5).data as Uint8Array;
    const participationTokenId = uint8ArrayToHex(participationTokenIdBytes);
    const isTokenGame = participationTokenId.length > 0;

    console.log(`Participating Judges: ${participatingJudgesTokenIds.length}`);
    console.log(`Token Game: ${isTokenGame} (${participationTokenId})`);

    // 2. Fetch Judge Info
    const dataMap = await fetchJudges();
    const judgeProofBoxes: Box<Amount>[] = [];
    const judgeAddresses: string[] = [];

    for (const tokenId of participatingJudgesTokenIds) {
        const judge = dataMap.get(tokenId);
        if (!judge) {
            console.warn(`Judge info not found for token: ${tokenId}`);
            continue;
        }

        const proofBoxWrapper = judge.current_boxes.find(b => b.box.assets.some(a => a.tokenId === tokenId));

        if (!proofBoxWrapper) {
            throw new Error(`No reputation proof box found for judge: ${tokenId}`);
        }

        judgeProofBoxes.push(proofBoxWrapper.box);
        // Use owner_ergotree from ReputationProof
        judgeAddresses.push(judge.owner_ergotree);
    }

    // 3. Calculate Payouts
    const judgeCount = BigInt(participatingJudgesTokenIds.length);
    if (judgeCount === 0n) throw new Error("No judges to pay.");

    let totalFunds = BigInt(judgesPaidBox.value);
    if (isTokenGame) {
        const asset = judgesPaidBox.assets.find(a => a.tokenId === participationTokenId);
        totalFunds = asset ? BigInt(asset.amount) : 0n;
    }

    const perJudgeCommission = totalFunds / judgeCount;

    console.log(`Total Funds: ${totalFunds}, Judge Count: ${judgeCount}, Per Judge: ${perJudgeCommission}`);

    if (perJudgeCommission === 0n) {
        throw new Error("Per-judge commission is zero. Nothing to distribute.");
    }

    // 4. Build Outputs
    const outputs: OutputBuilder[] = [];

    for (let i = 0; i < participatingJudgesTokenIds.length; i++) {
        const address = judgeAddresses[i];

        if (isTokenGame) {
            outputs.push(
                new OutputBuilder(SAFE_MIN_BOX_VALUE, address)
                    .addTokens({ tokenId: participationTokenId, amount: perJudgeCommission })
            );
        } else {
            outputs.push(
                new OutputBuilder(perJudgeCommission, address)
            );
        }
    }

    // 5. Build Transaction
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(judgesPaidBox), ...utxos];

    // Data Inputs: Judge Proof Boxes
    const dataInputs = judgeProofBoxes.map(parseBox);

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to(outputs)
            .withDataFrom(dataInputs)
            .sendChangeTo(userAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build()
            .toEIP12Object();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Distribution transaction submitted: ${txId}`);
        return txId;
    } catch (error) {
        console.error("Error distributing judge payouts:", error);
        throw error;
    }
}
