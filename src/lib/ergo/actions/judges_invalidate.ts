import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

// Constant from the game_resolution.es contract for extending the deadline
const JUDGE_PERIOD_EXTENSION = 30 + 10;

/**
 * Allows a judge (or group of judges) to invalidate the current winner.
 * This simplified version consumes the invalidated candidate's box, returns their funds
 * to the game pool, and extends the deadline for a new winner to be determined in a subsequent action.
 *
 * @param game The current GameResolution object.
 * @param invalidatedParticipation The participation box of the candidate to be invalidated.
 * @param judgeVoteDataInputs The judges' "vote" boxes, to be used as data-inputs.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function judges_invalidate(
    game: GameResolution,
    invalidatedParticipation: ParticipationResolved,
    participations: ParticipationResolved[],
    judgeVoteDataInputs: Box<Amount>[]
): Promise<string | null> {

    console.log(`Initiating candidate invalidation for the game: ${game.boxId}`);

    // --- 1. Preliminary checks ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("Invalidation is only possible before the judges' period ends.");
    }

    // Verify that the provided participation is indeed that of the current winning candidate
    if (invalidatedParticipation.commitmentC_Hex !== game.winnerCandidateCommitment) {
        throw new Error("The provided participation does not correspond to the current winning candidate of the game.");
    }
    
    const requiredVotes = Math.floor(game.judges.length / 2) + 1;
    if (judgeVoteDataInputs.length < requiredVotes) {
        throw new Error(`Required ${requiredVotes} judge votes, but only ${judgeVoteDataInputs.length} were provided.`);
    }

    const dataInputs = [...judgeVoteDataInputs, ...participations.map(p => p.box)]

    // --- 2. Prepare data for the new resolution box ---
    
    // The invalidated candidate's value is added back to the game box's value
    const newGameBoxValue = BigInt(game.value) + BigInt(invalidatedParticipation.value);
    const newDeadline = BigInt(game.resolutionDeadline + JUDGE_PERIOD_EXTENSION);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const secretS_bytes = hexToBytes(game.revealedS_Hex)!;

    // Reset the candidate to a "null" state (hash of an empty byte array)
    const nextWinnerCandidateCommitment = uint8ArrayToHex(fleetBlake2b256(new Uint8Array()));  // TODO Resolve the new winner.

    // --- 3. Build the new resolution box ---
    const recreatedGameBox = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(game.box.assets) // Keep the game's NFT
        .setAdditionalRegisters({
            // R4: Extended deadline, same counter
            R4: SInt(1).toHex(),
            // R5: Same secret, winning candidate reset
            R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(nextWinnerCandidateCommitment)!)).toHex(),
            // R6-R9: Keep the same values as the original box
            R6: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)).toHex(),
            R7: SColl(SLong, [BigInt(game.originalDeadline), game.creatorStakeNanoErg, game.participationFeeNanoErg, SLong(newDeadline), SInt(game.resolvedCounter)]).toHex(),
            R8: SPair(SColl(SByte, hexToBytes(game.resolverPK_Hex)!), SLong(BigInt(game.resolverCommission))).toHex(),
            R9: SPair(SColl(SByte, hexToBytes(game.originalCreatorPK_Hex)!), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex()
        });
        
    // --- 4. Build and Submit the Transaction ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();

    // Inputs: the resolution box, the invalidated participant's box, and the judge's UTXOs
    const inputs = [parseBox(game.box), parseBox(invalidatedParticipation.box), ...utxos];

    try {
        console.log("INPUTS ", inputs)
        console.log("OUTPUTS ", recreatedGameBox)
        console.log("DATA INPUTS ", dataInputs)

        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to(recreatedGameBox)
            .withDataFrom(dataInputs)
            .sendChangeTo(userAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Candidate invalidation transaction successfully submitted. ID: ${txId}`);
        return txId;
    } catch (error)
    {
        console.warn(error)
        throw error;
    }

}