import {
    OutputBuilder,
    TransactionBuilder,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, parseLongColl } from '$lib/ergo/utils';
import { type Game } from '$lib/common/game';
import { blake2b256 } from "@fleet-sdk/crypto";

// --- Constants defined based on the contract's logic ---
// The fixed amount of nanoERGs to penalize/drain from the creator's stake in each cancellation step.
// This must be greater than SAFE_MIN_BOX_VALUE to be a valid output.
const PENALTY_NANOERG = SAFE_MIN_BOX_VALUE; 

// The cooldown period in blocks before the next stake drain can occur.
const COOLDOWN_IN_BLOCKS = 20; 


/**
 * Executes "Action 2: Game Cancellation & Stake Draining" from the game.es contract.
 * This function can be called to either initiate the cancellation of an active game
 * or to perform a subsequent stake drain on an already-canceled game.
 *
 * @param game The Game object to be canceled, containing the live GameBox data.
 * @param secretS_hex The secret string 'S' in hex format, which will be revealed on-chain.
 * @param claimerAddressString The Ergo address of the user initiating the cancellation, who will receive the penalty amount.
 * @returns A promise that resolves to the transaction ID if successful, or null otherwise.
 */
export async function cancel_game_before_deadline(
    game: Game,
    secretS_hex: string,
    claimerAddressString: string
): Promise<string | null> {

    console.log("Attempting to cancel/drain game:", game.boxId);
    
    // --- 1. Get necessary data and perform pre-checks ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.deadlineBlock) {
        throw new Error("Game cancellation is only possible before the deadline.");
    }

    const gameBoxToSpend: Box<Amount> = game.box;
    if (!gameBoxToSpend) throw new Error("GameBox data is missing from the game object.");

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Invalid secretS_hex format.");

    // --- 2. Parse existing GameBox registers ---
    const stateTupleRaw = game.box.additionalRegisters.R5!.renderedValue;
    const parsedStateTuple = Array.isArray(stateTupleRaw) ? stateTupleRaw : JSON.parse(stateTupleRaw);
    const unlockHeight_in_self = BigInt(parsedStateTuple[0]);
    const hashOrSecret_in_self_hex = parsedStateTuple[1];

    const numericalParams = parseLongColl(game.box.additionalRegisters.R7!.renderedValue);
    if (!numericalParams || numericalParams.length < 3) throw new Error("Could not parse R7 from GameBox.");
    const [deadline, creatorStakeNanoErg, participationFeeNanoErg] = numericalParams;

    // --- 3. Determine if this is an initial cancellation or a subsequent drain ---
    if (unlockHeight_in_self === 0n) {
        // Phase A: Initial Cancellation
        console.log("Executing initial cancellation (Phase A).");
        const hashS_from_box = hashOrSecret_in_self_hex;
        const hash_of_provided_secret = blake2b256(secretS_bytes);
        
        if (Buffer.from(hash_of_provided_secret).toString('hex') !== hashS_from_box) {
            throw new Error("Provided secret does not match the hash in the GameBox.");
        }

    } else {
        // Phase B: Subsequent Draining
        console.log("Executing subsequent stake drain (Phase B).");
        if (currentHeight < unlockHeight_in_self) {
            throw new Error(`Cooldown period not over. Can only drain after block ${unlockHeight_in_self}.`);
        }
        // In this phase, the revealed secret is already in R5._2, but we still need it for the new box.
        if (secretS_hex !== hashOrSecret_in_self_hex) {
             throw new Error("The provided secret does not match the revealed secret in the already-canceled box.");
        }
    }

    // --- 4. Calculate new values for the re-created GameBox ---
    const newCreatorStake = creatorStakeNanoErg - PENALTY_NANOERG;
    if (newCreatorStake < SAFE_MIN_BOX_VALUE) {
        throw new Error(`Cannot drain further. Remaining stake (${newCreatorStake}) is less than SAFE_MIN_BOX_VALUE.`);
    }
    const newUnlockHeight = BigInt(currentHeight + COOLDOWN_IN_BLOCKS);

    // --- 5. Build Transaction Outputs ---
    
    // OUTPUT(0): The re-created GameBox with updated state
    const recreatedGameBoxOutput = new OutputBuilder(
        newCreatorStake,
        gameBoxToSpend.ergoTree
    )
    .addTokens(gameBoxToSpend.assets) // Preserve all tokens, including the Game NFT
    .setAdditionalRegisters({
        R4: gameBoxToSpend.additionalRegisters.R4.serializedValue, // gameCreatorPK
        R5: SPair(SLong(newUnlockHeight), SColl(SByte, secretS_bytes)).toHex(), // (newUnlockHeight, revealed_S)
        R6: gameBoxToSpend.additionalRegisters.R6.serializedValue, // expectedParticipationScriptHash
        R7: SColl(SLong, [deadline, newCreatorStake, participationFeeNanoErg]).toHex(), // [deadline, new_stake, fee]
        R8: gameBoxToSpend.additionalRegisters.R8.serializedValue, // commissionPercentage
        R9: gameBoxToSpend.additionalRegisters.R9.serializedValue  // gameDetailsJsonHex
    });

    // OUTPUT(1): The output for the claimer, containing the drained stake
    const claimerOutput = new OutputBuilder(
        PENALTY_NANOERG,
        claimerAddressString
    );

    // --- 6. Build and Submit Transaction ---
    const claimerUtxos: InputBox[] = await ergo.get_utxos();
    const inputsForTx = [parseBox(gameBoxToSpend), ...claimerUtxos];

    const unsignedTransaction = await new TransactionBuilder(currentHeight)
        .from(inputsForTx)
        .to(recreatedGameBoxOutput) // OUTPUTS(0)
        .to(claimerOutput)         // OUTPUTS(1)
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    const eip12UnsignedTransaction = await unsignedTransaction.toEIP12Object();

    console.log("Requesting transaction signing for game cancellation...");
    const signedTransaction = await ergo.sign_tx(eip12UnsignedTransaction);
    if (!signedTransaction) throw new Error("Transaction signing was cancelled or failed.");

    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) throw new Error("Failed to submit transaction to the network.");

    console.log(`Game cancellation/drain transaction submitted successfully. Transaction ID: ${transactionId}`);
    return transactionId;
}