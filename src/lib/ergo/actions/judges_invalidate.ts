import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Box
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex } from '../contract';

// Constante del contrato game_resolution.es para la extensión del plazo
const JUDGE_PERIOD_EXTENSION = 30;

/**
 * Permite a un juez (o grupo de jueces) invalidar al ganador actual.
 * Esta versión simplificada consume la caja del candidato invalidado, devuelve sus fondos
 * al pozo del juego y extiende el plazo para que se determine un nuevo ganador en una acción posterior.
 *
 * @param game El objeto GameResolution actual.
 * @param invalidatedParticipation La caja de participación del candidato que será invalidado.
 * @param judgeVoteDataInputs Las cajas de "voto" de los jueces, que se usarán como data-inputs.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function judges_invalidate(
    game: GameResolution,
    invalidatedParticipation: ParticipationResolved,
    judgeVoteDataInputs: Box<bigint>[]
): Promise<string | null> {

    console.log(`Iniciando invalidación de candidato para el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("La invalidación solo es posible antes de que finalice el período de los jueces.");
    }

    // Verificar que la participación proporcionada es realmente la del candidato a ganador
    if (invalidatedParticipation.commitmentC_Hex !== game.winnerCandidateCommitment) {
        throw new Error("La participación proporcionada no corresponde al candidato a ganador actual del juego.");
    }
    
    const requiredVotes = Math.floor(game.participatingJudges.length / 2) + 1;
    if (judgeVoteDataInputs.length < requiredVotes) {
        throw new Error(`Se requieren ${requiredVotes} votos de jueces, pero solo se proporcionaron ${judgeVoteDataInputs.length}.`);
    }

    // --- 2. Preparar datos para la nueva caja de resolución ---
    
    // El valor del candidato invalidado se suma de nuevo al valor de la caja del juego
    const newGameBoxValue = BigInt(game.value) + BigInt(invalidatedParticipation.value);
    const newDeadline = BigInt(game.resolutionDeadline + JUDGE_PERIOD_EXTENSION);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const secretS_bytes = hexToBytes(game.revealedS_Hex)!;

    // Se resetea el candidato a un estado "nulo" (hash de un array de bytes vacío)
    const nextWinnerCandidateCommitment = uint8ArrayToHex(fleetBlake2b256(new Uint8Array()));

    // --- 3. Construir la nueva caja de resolución ---
    const recreatedGameBox = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(game.box.assets) // Mantener el NFT del juego
        .setAdditionalRegisters({
            // R4: Plazo extendido, mismo contador
            R4: SPair(SLong(newDeadline), SInt(game.resolvedCounter)).toHex(),
            // R5: Mismo secreto, candidato a ganador reseteado
            R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(nextWinnerCandidateCommitment)!)).toHex(),
            // R6-R9: Mantener los mismos valores que la caja original
            R6: SColl(SColl(SByte), game.participatingJudges.map(hexToBytes)).toHex(),
            R7: SColl(SLong, [BigInt(game.originalDeadline), game.creatorStakeNanoErg, game.participationFeeNanoErg]).toHex(),
            R8: SPair(SColl(SByte, hexToBytes(game.resolverPK_Hex)!), SLong(BigInt(game.resolverCommission))).toHex(),
            R9: SPair(SColl(SByte, hexToBytes(game.originalCreatorPK_Hex)!), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex()
        });
        
    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();

    // Inputs: la caja de resolución, la caja del participante invalidado y las UTXOs del juez.
    const inputs = [parseBox(game.box), parseBox(invalidatedParticipation.box), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(recreatedGameBox)
        .withDataFrom(judgeVoteDataInputs) // Añadir las cajas de voto de los jueces como data-inputs
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción de invalidación de candidato enviada con éxito. ID: ${txId}`);
    return txId;
}