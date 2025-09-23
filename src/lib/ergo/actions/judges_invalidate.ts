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
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationResolvedErgoTreeHex } from '../contract';
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

    const dataInputs = [...(judgeVoteDataInputs.map(e => parseBox(e))), ...participations.map(p => parseBox(p.box))];

    // --- 2. Determinar el ganador y filtrar participaciones (lógica off-chain) ---
    let maxScore = -1n;
    const validParticipations: ParticipationResolved[] = [];
    let nextWinnerCandidateCommitment: string | null = null;
    const participationErgoTree = getGopParticipationResolvedErgoTreeHex();
    const participationErgoTreeBytes = hexToBytes(participationErgoTree);
    if (!participationErgoTreeBytes) {
        throw new Error("El ErgoTree del script de participación es inválido.");
    }
    const participationScriptHash = uint8ArrayToHex(fleetBlake2b256(participationErgoTreeBytes));


    for (const p of participations) {
        const pBox = parseBox(p.box);

        // Verificación 1: Script de Participación Correcto
        if (uint8ArrayToHex(fleetBlake2b256(hexToBytes(pBox.ergoTree) ?? "")) !== participationScriptHash) {
            console.warn(`La participación ${p.boxId} tiene un script incorrecto. Será omitida.`);
            continue;
        }

        // Verificación 2: Referencia al NFT del Juego
        if (p.gameNftId !== game.box.assets[0].tokenId) {
            console.warn(`La participación ${p.boxId} no apunta al NFT de este juego. Será omitida.`);
            continue;
        }

        // Verificación 3: Pago de la Tarifa de Participación
        if (BigInt(pBox.value) < game.participationFeeNanoErg) {
            console.warn(`La participación ${p.boxId} no cumple con la tarifa mínima. Será omitida.`);
            continue;
        }

        const secretS_bytes = hexToBytes(game.revealedS_Hex);
        if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

        // Simulación de la validación de la puntuación
        let scoreIsValid = false;
        let actualScore = -1n;

        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!,   // TODO CHECK Buffer.from(p.solverId_RawBytesHex, 'utf-8'),
                ...bigintToLongByteArray(BigInt(score)),
                ...hexToBytes(p.hashLogs_Hex)!,
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
            console.warn(`No se pudo encontrar una puntuación válida para la participación ${p.boxId}. Será omitida.`);
            continue;
        }

        validParticipations.push(p);

        // Si la participación es válida, se considera para determinar al ganador.
        if (actualScore > maxScore) {
            maxScore = actualScore;
            nextWinnerCandidateCommitment = p.commitmentC_Hex;
        }
    }

    if (!nextWinnerCandidateCommitment) {
        // throw new Error("No se pudo determinar un ganador entre las participaciones válidas.");
    }

    if (validParticipations.length !== participations.length)  {
        throw new Error("Participaciones invalidas. Esto no debería de haber ocurrido.");  // Should never happen.
    }

    console.log(`Número de participaciones válidas: ${validParticipations.length}`);
    console.log(`Ganador candidato determinado con compromiso: ${nextWinnerCandidateCommitment} y puntuación: ${maxScore}`);

    // --- 3. Prepare data for the new resolution box ---
    
    // The invalidated candidate's value is added back to the game box's value
    const newGameBoxValue = game.value + invalidatedParticipation.value;
    const newDeadline = BigInt(game.resolutionDeadline + JUDGE_PERIOD_EXTENSION);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const secretS_bytes = hexToBytes(game.revealedS_Hex)!;

    // --- 4. Build the new resolution box ---
    const recreatedGameBox = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(game.box.assets) // Keep the game's NFT
        .setAdditionalRegisters({
            // R4: Extended deadline, same counter
            R4: SInt(1),
            // R5: Same secret, winning candidate reset
            R5: SPair(
                SColl(SByte, secretS_bytes),
                SColl(SByte, nextWinnerCandidateCommitment ? hexToBytes(nextWinnerCandidateCommitment)! : [])
            ),
            // R6-R9: Keep the same values as the original box
            R6: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)),
            R7: SColl(SLong, [
                BigInt(game.originalDeadline),
                BigInt(game.creatorStakeNanoErg),
                BigInt(game.participationFeeNanoErg),
                BigInt(newDeadline),
                BigInt(game.resolvedCounter - 1),
            ]),
            R8: SPair(
                SColl(SByte, hexToBytes(game.resolverPK_Hex)!),
                SLong(BigInt(game.resolverCommission))
            ),
            R9: SPair(
                SColl(SByte, hexToBytes(game.originalCreatorPK_Hex)!),
                SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))
            ),
        });

    console.log("registers output ", [
                BigInt(game.originalDeadline),
                BigInt(game.creatorStakeNanoErg),
                BigInt(game.participationFeeNanoErg),
                BigInt(newDeadline),
                BigInt(game.resolvedCounter - 1),
            ])

    console.log("dataInputs ", dataInputs)
        
    // --- 5. Build and Submit the Transaction ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();

    // Inputs: the resolution box, the invalidated participant's box, and the judge's UTXOs
    const inputs = [parseBox(game.box), parseBox(invalidatedParticipation.box), ...utxos];

    try {
        console.log("INPUTS ", inputs)
        console.log("OUTPUTS ", recreatedGameBox)
        console.log("DATA INPUTS ", dataInputs)

        console.log("Current height: ", currentHeight)

        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to(recreatedGameBox)
            .withDataFrom(dataInputs)
            .sendChangeTo(userAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        console.log("Unsigned transaction: ", unsignedTransaction.toEIP12Object())

        const signedTransaction = await Promise.race([
            ergo.sign_tx(unsignedTransaction.toEIP12Object()),
            new Promise((_, reject) => setTimeout(() => reject(new Error("sign_tx timeout")), 15000))
        ]);

        console.log("Signed transaction: ", signedTransaction)

        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Candidate invalidation transaction successfully submitted. ID: ${txId}`);
        return txId;
    } catch (error)
    {
        console.warn(error)
        throw error;
    }

}