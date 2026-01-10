import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution } from '$lib/common/game';
import { getGopEndGameErgoTreeHex } from '../contract';


declare const ergo: any;

export async function to_end_game(
    game: GameResolution
): Promise<string> {

    console.log(`[to_end_game] Starting transition to end game for: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Validaciones Previas ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    // --- 2. Construcción de Outputs ---
    const endGameErgoTree = getGopEndGameErgoTreeHex();

    // Recreamos los registros exactamente igual
    const r4Hex = SInt(1).toHex(); // R4: Estado (1: Resuelto) - se mantiene igual
    const r5Hex = SColl(SByte, hexToBytes(game.seed)!).toHex(); // R5: Seed

    // R6: (revealedS, winnerCandidateCommitment)
    const revealedSBytes = hexToBytes(game.revealedS_Hex)!;
    const winnerCommitmentBytes = game.winnerCandidateCommitment ? hexToBytes(game.winnerCandidateCommitment)! : new Uint8Array();
    const r6Hex = SPair(SColl(SByte, revealedSBytes), SColl(SByte, winnerCommitmentBytes)).toHex();

    // R7: Participating Judges
    const judgesBytes = game.judges.map(j => hexToBytes(j)!);
    const r7Hex = SColl(SColl(SByte), judgesBytes).toHex();

    // R8: Numerical Parameters
    // [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline, timeWeight]
    const numericalParams = [
        BigInt(game.deadlineBlock),
        game.creatorStakeAmount,
        game.participationFeeAmount,
        game.perJudgeComissionPercentage,
        BigInt(game.resolverCommission),
        BigInt(game.resolutionDeadline),
        BigInt(game.timeWeight)
    ];
    const r8Hex = SColl(SLong, numericalParams).toHex();

    // R9: Game Provenance
    // [gameDetailsJsonHex, ParticipationTokenID, resolverErgoTree]
    // We need to reconstruct this.
    // game.content.rawJsonString is not hex. We need the original hex or re-encode?
    // fetch.ts parses it from hex. But we don't have the original hex stored in GameResolution directly, 
    // only the parsed content.
    // However, we can read it from the current box registers!
    // It's safer to copy from the input box to ensure exact match.

    const inputR9 = game.box.additionalRegisters.R9;
    if (!inputR9) throw new Error("Input box missing R9");

    // We can just use the renderedValue or serialized value from the input box if we are careful.
    // But fleet-sdk TransactionBuilder might handle it if we just pass the hex.
    // Let's try to extract the hex values from the input box registers directly to be safe.

    const r9HexFromInput = inputR9; // This is the serialized hex of the register? No, it's usually an object in the explorer response.
    // Fleet-sdk Box type has additionalRegisters as Record<string, string> (hex).
    // Let's check the type of game.box.

    // In fetch.ts: box.additionalRegisters.R9?.renderedValue
    // But game.box is the raw box.

    // Let's rely on reconstructing it if possible, or copying.
    // Copying is better to avoid any encoding differences.

    const registers = {
        R4: game.box.additionalRegisters.R4,
        R5: game.box.additionalRegisters.R5,
        R6: game.box.additionalRegisters.R6,
        R7: game.box.additionalRegisters.R7,
        R8: game.box.additionalRegisters.R8,
        R9: game.box.additionalRegisters.R9
    };

    // The issue is that the explorer returns "renderedValue" sometimes, or just the hex.
    // Fleet-sdk `parseBox` handles this.
    // If we use `game.box` directly in `from()`, we are good for inputs.
    // For outputs, we need to construct the registers.

    // Let's use the values we parsed in `GameResolution` to be safe and explicit, 
    // EXCEPT for R9 where we might want to copy the hex to avoid re-serialization issues if possible.
    // But `GameResolution` has `resolverScript_Hex` and `participationTokenId`.
    // And `gameDetails`... we have `game.content`.

    // Actually, `game_resolution.es` checks:
    // recreatedGameBox.R9[Coll[Coll[Byte]]].get == gameProvenance
    // So it MUST be identical.

    // Let's look at `resolve_game.ts` to see how R9 is constructed.
    /*
    const gameDetailsBytes = stringToBytes('utf8', game.content.rawJsonString);
    const r9Hex = SColl(SColl(SByte), [gameDetailsBytes, hexToBytes(game.participationTokenId) ?? "", prependHexPrefix(resolverPkBytes)]).toHex();
    */

    // In `GameResolution`, we have `resolverScript_Hex`.
    // `resolve_game.ts` used `resolverPkBytes` (which is the content of the P2PK or script).
    // `game_resolution.es` expects `resolverPK` in R9(2).
    // `GameResolution` interface has `resolverPK_Hex` (if P2PK) and `resolverScript_Hex`.
    // If it's P2PK, `resolverPK_Hex` is the public key.
    // If it's a script, `resolverScript_Hex` is the script.

    // Let's look at `fetch.ts` parsing of R9:
    /*
    const resolverScript_Hex = parseCollByteToHex(r9Value[2]);
    const resolverPK_Hex = resolverScript_Hex.slice(0, 6) == "0008cd" ? resolverScript_Hex.slice(6, resolverScript_Hex.length) : null
    */

    // So `resolverScript_Hex` holds the full value stored in R9(2).
    // So we should use `resolverScript_Hex`.

    // For game details, `fetch.ts` does:
    /*
    const gameDetailsHex = r9Value[0];
    const content = parseGameContent(hexToUtf8(gameDetailsHex), ...);
    */
    // We don't have `gameDetailsHex` stored in `GameResolution`.
    // We have `game.content.rawJsonString`.
    // We can convert it back to hex.

    // However, to be 100% sure we match the input register (which is required by the contract),
    // we should try to use the register value from the input box if possible.
    // `game.box.additionalRegisters.R9` should contain the hex string of the register content if it's a fleet-sdk box.
    // If it came from explorer, it might be different.

    // Let's try to reconstruct it.
    // If `game.content.rawJsonString` is exactly what was decoded, re-encoding it should work.

    // Wait, `game_resolution.es` says:
    // recreatedGameBox.R9[Coll[Coll[Byte]]].get == gameProvenance

    // So we can just copy the R9 register from the input box!
    // But `game.box.additionalRegisters.R9` might be the serialized string (starting with 1e...) or the rendered value.
    // `parseBox` in `utils` handles conversion.

    // Let's assume we can reconstruct it.

    // But wait, `game.box` is type `Box<Amount>`.
    // In fleet-sdk, `additionalRegisters` values are hex strings of the serialized registers (e.g. "0e01...").
    // So we can just pass `game.box.additionalRegisters.R9` directly to the output builder?
    // OutputBuilder expects `serialized` hex string for registers?
    // `setAdditionalRegisters` expects: `{ R4: "hex", ... }`.
    // If `game.box.additionalRegisters.R9` is the serialized hex, we can use it.

    // Let's verify what `fetch.ts` puts in `game.box`.
    // It puts the raw box from explorer.
    // Explorer API v1 returns registers as `{ R4: "hex", ... }` or `{ R4: { renderedValue: "..." }, ... }`?
    // It depends on the explorer instance/version, but usually it's `additionalRegisters: { R4: "serializedHex" }`.
    // BUT `fetch.ts` uses `box.additionalRegisters.R4?.renderedValue`.
    // This implies the box object has `renderedValue`.
    // So `game.box` is the raw JSON from explorer.

    // If we use `parseBox(game.box)` it converts it to a fleet-sdk box where registers are hex strings.
    const parsedInputBox = parseBox(game.box);

    // So `parsedInputBox.additionalRegisters.R9` should be the hex string we want.
    // EXCEPT, `parseBox` might not preserve the exact original hex if it re-serializes?
    // No, `parseBox` usually just maps the fields.

    // Let's use `parsedInputBox.additionalRegisters` for R4-R9 to be safe and exact?
    // R4 changes (State 1 -> 1). Wait, state is ALREADY 1 in Resolution.
    // So R4 is identical.
    // R5 is identical.
    // R6 is identical.
    // R7 is identical.
    // R8 is identical.
    // R9 is identical.

    // So we are just cloning the box but changing the script (ergoTree).

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

    // --- 3. Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parsedInputBox, ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(endGameBoxOutput)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`[to_end_game] Success! Tx ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.error("[to_end_game] Tx Error:", error);
        throw error;
    }
}
