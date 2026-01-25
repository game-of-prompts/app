import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { getGopGameResolutionErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

const JUDGE_PERIOD_MARGIN = 10;

/**
 * Allows a judge (or group of judges) to mark the current winner as unavailable.
 * This is similar to invalidation but does not penalize the resolver.
 * The participation is invalidated but the resolver's stake is not affected.
 *
 * @param game The current GameResolution object.
 * @param invalidatedParticipation The participation box of the candidate to be marked as unavailable.
 * @param judgeVoteDataInputs The judges' "vote" boxes, to be used as data-inputs.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function judges_invalidate_unavailable(
    game: GameResolution,
    invalidatedParticipation: ValidParticipation,
    judgeVoteDataInputs: Box<Amount>[]
): Promise<string | null> {

    console.log(`Initiating candidate unavailable marking for the game: ${game.boxId}`);

    // --- 1. Preliminary checks ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("Unavailable marking is only possible before the judges' period ends.");
    }

    // Verify that the provided participation is indeed that of the current winning candidate
    if (invalidatedParticipation.commitmentC_Hex !== game.winnerCandidateCommitment) {
        throw new Error("The provided participation does not correspond to the current winning candidate of the game.");
    }

    // Check all judge votes - they should be for PARTICIPATION_UNAVAILABLE_TYPE_ID
    for (const p of judgeVoteDataInputs) {
        const reg = p.additionalRegisters;

        console.log("Regs ", reg)

        // TODO CHECK.
        const valid = reg.R4 === "0e20"+game.constants.PARTICIPATION_UNAVAILABLE_TYPE_ID &&
            reg.R5 === "0e20"+game.winnerCandidateCommitment;

        if (!valid) {
            console.log(reg.R4)
            console.log(reg.R5)
            throw new Error("Invalid judge vote for unavailable marking.")
        }

    }

    const requiredVotes = Math.floor(game.judges.length / 2) + 1;
    if (judgeVoteDataInputs.length < requiredVotes) {
        throw new Error(`Required ${requiredVotes} judge votes, but only ${judgeVoteDataInputs.length} were provided.`);
    }

    // --- 3. Prepare data for the new resolution box ---

    const dataInputs = [
        ...judgeVoteDataInputs.map(e => e)
    ];

    // Calculate new Value (ERG) and Tokens
    // We sum the raw box values (nanoErgs) to preserve safe mins.
    const newGameBoxValue = BigInt(game.box.value) + BigInt(invalidatedParticipation.box.value);

    // Calculate new Token Balances if applicable
    const gameTokens = [game.box.assets[0]]; // NFT
    if (game.participationTokenId !== "") {
        const currentAmount = BigInt(game.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        const invalidatedAmount = BigInt(invalidatedParticipation.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        gameTokens.push({ tokenId: game.participationTokenId, amount: currentAmount + invalidatedAmount });
    }

    const newDeadline = BigInt(currentHeight + game.constants.JUDGE_PERIOD + JUDGE_PERIOD_MARGIN);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();

    // --- 4. Build the new resolution box ---
    const recreatedGameBox = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(gameTokens) // Updated tokens list
        .setAdditionalRegisters({
            // R4
            R4: SInt(1).toHex(),

            // R5: Seed (Coll[Byte])
            R5: SColl(SByte, hexToBytes(game.seed)!).toHex(),

            // R6: (revealedSecretS, winnerCandidateCommitment)
            R6: SPair(
                SColl(SByte, hexToBytes(game.revealedS_Hex)!),
                SColl(SByte, [])
            ).toHex(),

            // --- R7: participatingJudges: Coll[Coll[Byte]] ---
            R7: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)).toHex(),

            // R8: numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercentage, resolverCommissionPercentage, resolutionDeadline, timeWeight]
            R8: SColl(SLong, [
                BigInt(game.deadlineBlock),
                BigInt(game.resolverStakeAmount),
                BigInt(game.participationFeeAmount),
                BigInt(game.perJudgeCommissionPercentage),
                BigInt(game.resolverCommission),  // Resolver commission is NOT penalized in unavailable case
                BigInt(newDeadline),
                BigInt(game.timeWeight)
            ]).toHex(),

            // R9: gameProvenance: Coll[Coll[Byte]] -> [ rawJsonBytes, participationTokenId, resolverScriptBytes ]
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? "", hexToBytes(game.resolverScript_Hex)!]).toHex(),
        });

    // --- 5. Build and Submit the Transaction ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();

    // Inputs: the resolution box, the invalidated participant's box, and the judge's UTXOs
    const inputs = [parseBox(game.box), parseBox(invalidatedParticipation.box), ...utxos];

    try {

        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to(recreatedGameBox)
            .withDataFrom(dataInputs)
            .sendChangeTo(userAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();


        const signedTransaction = await Promise.race([
            ergo.sign_tx(unsignedTransaction.toEIP12Object()),
            new Promise((_, reject) => setTimeout(() => reject(new Error("sign_tx timeout")), 15000))
        ]);


        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Candidate unavailable marking transaction successfully submitted. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.warn(error)
        throw error;
    }
}