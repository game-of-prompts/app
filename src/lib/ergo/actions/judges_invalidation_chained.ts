import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { create_opinion_chained, update_opinion_chained } from 'reputation-system';
import { PARTICIPATION } from '$lib/ergo/reputation/types';
import { reputation_proof } from '$lib/common/store';
import { get } from 'svelte/store';
import { explorer_uri } from '../envs';

declare const ergo: any;

const JUDGE_PERIOD_MARGIN = 10;

/**
 * Performs a chained transaction that:
 * 1. Tx A: Creates/updates the judge's opinion about the participation (invalidation vote)
 * 2. Tx B: Executes judges_invalidate when the majority threshold is reached
 *
 * This allows the final deciding judge to complete both actions atomically.
 *
 * @param game The current GameResolution object.
 * @param invalidatedParticipation The participation box of the candidate to be invalidated.
 * @param participations All valid participations in the game.
 * @param judgeVoteDataInputs The judges' existing "vote" boxes (excluding the current judge's vote).
 * @returns A promise that resolves with an array of transaction IDs [txA_id, txB_id].
 */
export async function judges_invalidation_chained(
    game: GameResolution,
    invalidatedParticipation: ValidParticipation,
    participations: ValidParticipation[],
    judgeVoteDataInputs: Box<Amount>[]
): Promise<string[]> {

    console.log(`[judges_invalidation_chained] Starting chained invalidation for game: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Preliminary checks ---
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("Invalidation is only possible before the judges' period ends.");
    }

    if (invalidatedParticipation.commitmentC_Hex !== game.winnerCandidateCommitment) {
        throw new Error("The provided participation does not correspond to the current winning candidate of the game.");
    }

    // Check all existing judge votes
    for (const p of judgeVoteDataInputs) {
        const reg = p.additionalRegisters;

        const valid = reg.R4.renderedValue === game.constants.PARTICIPATION_TYPE_ID &&
            reg.R5.renderedValue === game.winnerCandidateCommitment &&
            reg.R6.renderedValue === "true" &&
            reg.R8.renderedValue === "false";

        if (!valid) {
            throw new Error("Invalid judge vote [chained].")
        }
    }

    // --- 2. Prepare Tx A: Create or Update Opinion ---
    const proof = get(reputation_proof);
    if (!proof) throw new Error("User has no reputation proof");

    const existingOpinion = proof.current_boxes.find(
        b => b.type.tokenId === PARTICIPATION && b.object_pointer === invalidatedParticipation.commitmentC_Hex
    );

    let txABuilder: TransactionBuilder;

    if (existingOpinion) {
        txABuilder = await update_opinion_chained(
            get(explorer_uri),
            existingOpinion as any,
            false, // polarization: false = invalidation vote
            null   // content
        );
    } else {
        const mainBox = proof.current_boxes.find(b => b.is_locked === false && b.object_pointer === b.token_id);
        if (!mainBox) throw new Error("No main box found");

        txABuilder = await create_opinion_chained(
            get(explorer_uri),
            1,
            PARTICIPATION,
            invalidatedParticipation.commitmentC_Hex,
            false, // polarization: false = invalidation vote
            null,  // content
            true,
            mainBox as any
        );
    }

    // --- 3. Determine the next winner candidate (off-chain logic) ---
    let maxScore = -1n;
    let nextWinnerCandidateCommitment: string | null = null;
    let nextWinnerCandidatePBox: Box<Amount> | null = null;
    const participationErgoTree = getGopParticipationErgoTreeHex();
    const participationErgoTreeBytes = hexToBytes(participationErgoTree);
    if (!participationErgoTreeBytes) {
        throw new Error("The ErgoTree of the participation script is invalid.");
    }
    const participationScriptHash = uint8ArrayToHex(fleetBlake2b256(participationErgoTreeBytes));

    for (const p of participations) {
        // Skip the invalidated participation
        if (p.commitmentC_Hex === invalidatedParticipation.commitmentC_Hex) continue;

        const pBox = parseBox(p.box);

        // Verification 1: Correct Participation Script
        if (uint8ArrayToHex(fleetBlake2b256(hexToBytes(pBox.ergoTree) ?? "")) !== participationScriptHash) {
            console.warn(`Participation ${p.boxId} has an incorrect script. It will be omitted.`);
            continue;
        }

        // Verification 2: Reference to the Game NFT
        if (p.gameNftId !== game.box.assets[0].tokenId) {
            console.warn(`Participation ${p.boxId} does not point to this game's NFT. It will be omitted.`);
            continue;
        }

        // Verification 3: Payment of the Participation Fee (Check Tokens or ERG)
        const feeCheck = game.participationTokenId === ""
            ? BigInt(pBox.value)
            : BigInt(pBox.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);

        if (feeCheck < game.participationFeeAmount) {
            console.warn(`Participation ${p.boxId} does not meet the minimum fee. It will be omitted.`);
            continue;
        }

        const secretS_bytes = hexToBytes(game.revealedS_Hex);
        if (!secretS_bytes) throw new Error("Invalid secretS_hex format.");

        // Score validation simulation
        let scoreIsValid = false;
        let actualScore = -1n;

        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!,
                ...bigintToLongByteArray(BigInt(score)),
                ...hexToBytes(p.hashLogs_Hex)!,
                ...hexToBytes(p.playerScript_Hex)!,
                ...secretS_bytes
            ]);
            const testCommitment = fleetBlake2b256(dataToHash);
            if (uint8ArrayToHex(testCommitment) === p.commitmentC_Hex) {
                scoreIsValid = true;
                actualScore = score;
                break;
            }
        }

        if (!scoreIsValid) {
            console.warn(`Could not find a valid score for participation ${p.boxId}. It will be omitted.`);
            continue;
        }

        // If valid, consider for next winner
        if (actualScore > maxScore) {
            maxScore = actualScore;
            nextWinnerCandidateCommitment = p.commitmentC_Hex;
            nextWinnerCandidatePBox = pBox;
        }
    }

    console.log(`[judges_invalidation_chained] Next winner candidate determined with commitment: ${nextWinnerCandidateCommitment} and score: ${maxScore}`);

    // --- 4. Prepare data for Tx B (judges_invalidate) ---
    const newGameBoxValue = BigInt(game.box.value) + BigInt(invalidatedParticipation.box.value);

    const gameTokens = [game.box.assets[0]]; // NFT
    if (game.participationTokenId !== "") {
        const currentAmount = BigInt(game.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        const invalidatedAmount = BigInt(invalidatedParticipation.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        gameTokens.push({ tokenId: game.participationTokenId, amount: currentAmount + invalidatedAmount });
    }

    const newDeadline = BigInt(currentHeight + game.constants.JUDGE_PERIOD + JUDGE_PERIOD_MARGIN);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();

    const recreatedGameBoxOutput = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(gameTokens)
        .setAdditionalRegisters({
            R4: SInt(1).toHex(),
            R5: SColl(SByte, hexToBytes(game.seed)!).toHex(),
            R6: SPair(
                SColl(SByte, hexToBytes(game.revealedS_Hex)!),
                SColl(SByte, nextWinnerCandidateCommitment ? hexToBytes(nextWinnerCandidateCommitment)! : [])
            ).toHex(),
            R7: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)).toHex(),
            R8: SColl(SLong, [
                BigInt(game.deadlineBlock),
                BigInt(game.creatorStakeAmount),
                BigInt(game.participationFeeAmount),
                BigInt(game.perJudgeComissionPercentage) + BigInt(game.resolverCommission),
                0n,  // resolver commission goes to judges
                BigInt(newDeadline),
                BigInt(game.timeWeight)
            ]).toHex(),
            R9: SColl(SColl(SByte), [
                stringToBytes('utf8', game.content.rawJsonString),
                hexToBytes(game.participationTokenId) ?? "",
                hexToBytes(game.resolverScript_Hex)!
            ]).toHex(),
        });

    // --- 5. Build Chained Transaction ---
    const utxos: InputBox[] = await ergo.get_utxos();
    const parsedGameBox = parseBox(game.box);
    const parsedInvalidatedBox = parseBox(invalidatedParticipation.box);

    // Data inputs for Tx B: existing judge votes + next winner candidate participation
    const dataInputsForTxB = [
        ...judgeVoteDataInputs.map(e => parseBox(e)),
        ...(nextWinnerCandidatePBox ? [nextWinnerCandidatePBox] : [])
    ];

    const unsignedTransactions = await txABuilder
        .chain((builder, parent) => {
            console.log("[judges_invalidation_chained] Chaining judges_invalidate transaction...");
            console.log("Parent outputs count:", parent.outputs.length);

            // parent.outputs[0] should be the opinion box from Tx A
            // We include it as a data input for Tx B validation
            const allDataInputs = [parent.outputs[0], ...dataInputsForTxB];

            return builder
                .from([parsedGameBox, parsedInvalidatedBox])
                .to(recreatedGameBoxOutput)
                .withDataFrom(allDataInputs)
                .sendChangeTo(userAddress)
                .payFee(RECOMMENDED_MIN_FEE_VALUE)
                .build();
        })
        .toEIP12Object();

    console.log("[judges_invalidation_chained] Unsigned chained transactions:", unsignedTransactions);

    // --- 6. Sign and Submit Sequentially ---
    const transactionIds: string[] = [];

    for (const tx of unsignedTransactions) {
        const signed = await ergo.sign_tx(tx);
        const txId = await ergo.submit_tx(signed);
        transactionIds.push(txId);
        console.log("[judges_invalidation_chained] Submitted transaction id ->", txId);
    }

    console.log(`[judges_invalidation_chained] Chained invalidation completed. IDs: ${transactionIds.join(", ")}`);
    return transactionIds;
}
