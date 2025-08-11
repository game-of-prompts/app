import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Box
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, SString, uint8ArrayToHex, utf8StringToCollByteHex, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationSubmitted, type ParticipationResolved } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationResolvedErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

/**
 * Permite a cualquier usuario incluir una o más participaciones que fueron omitidas
 * durante la transición inicial a la fase de Resolución.
 *
 * @param game El objeto GameResolution actual.
 * @param omittedParticipations Un array de participaciones en estado "Submitted" a incluir.
 * @param currentResolved Un array de las participaciones ya resueltas (para encontrar al ganador actual).
 * @param newResolverPkHex La clave pública hexadecimal del usuario que ejecuta la acción, quien se convertirá en el nuevo resolver.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function include_omitted_participation(
    game: GameResolution,
    omittedParticipations: ParticipationSubmitted[],
    currentResolved: ParticipationResolved[],
    newResolverPkHex: string
): Promise<string | null> {

    console.log(`Intentando incluir ${omittedParticipations.length} participacion(es) omitida(s) en el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("No se pueden incluir participaciones después de que finalice el período de los jueces.");
    }
    if (!omittedParticipations || omittedParticipations.length === 0) {
        throw new Error("Se debe proporcionar al menos una participación omitida.");
    }

    const secretS_bytes = hexToBytes(game.revealedS_Hex);
    if (!secretS_bytes) throw new Error("El secreto 'S' del juego es inválido.");

    // --- 2. Determinar el nuevo ganador potencial ---

    // Función auxiliar para obtener la puntuación real de una participación
    const getActualScore = (p: ParticipationSubmitted | ParticipationResolved): bigint => {
        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!,
                ...bigintToLongByteArray(BigInt(score)),
                ...hexToBytes(p.hashLogs_Hex)!,
                ...secretS_bytes
            ]);
            if (uint8ArrayToHex(fleetBlake2b256(dataToHash)) === p.commitmentC_Hex) {
                return score;
            }
        }
        throw new Error(`No se pudo validar ninguna puntuación para la participación ${p.boxId}`);
    };

    // Encontrar al ganador actual y su puntuación
    const currentWinnerParticipation = currentResolved.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment);
    if (!currentWinnerParticipation) {
        throw new Error("No se pudo encontrar la participación del ganador actual en la lista de resueltos.");
    }
    let maxScore = getActualScore(currentWinnerParticipation);
    let bestCandidateCommitment = game.winnerCandidateCommitment;

    // Comparar con las nuevas participaciones
    for (const omittedP of omittedParticipations) {
        const score = getActualScore(omittedP);
        if (score > maxScore) {
            maxScore = score;
            bestCandidateCommitment = omittedP.commitmentC_Hex;
        }
    }

    // --- 3. Construir las Salidas de la Transacción ---
    
    // SALIDA(0): La caja del juego de resolución, recreada y actualizada
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const recreatedGameBox = new OutputBuilder(
        BigInt(game.value), // El valor de la caja del juego no cambia
        resolutionErgoTree
    )
    .addTokens(game.box.assets)
    .setAdditionalRegisters({
        // R4: Mismo plazo, pero se incrementa el contador de resueltos
        R4: SPair(SLong(BigInt(game.resolutionDeadline)), SInt(game.resolvedCounter + omittedParticipations.length)).toHex(),
        // R5: Mismo secreto, pero el candidato a ganador puede cambiar
        R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(bestCandidateCommitment)!)).toHex(),
        // R6 y R7 se mantienen
        R6: SColl(SColl(SByte), game.participatingJudges.map(hexToBytes)).toHex(),
        R7: SColl(SLong, [BigInt(game.originalDeadline), game.creatorStakeNanoErg, game.participationFeeNanoErg]).toHex(),
        // R8: Se actualiza la PK del resolver
        R8: SPair(SColl(SByte, hexToBytes(newResolverPkHex)!), SLong(BigInt(game.resolverCommission))).toHex(),
        // R9 se mantiene
        R9: SPair(SColl(SByte, hexToBytes(game.originalCreatorPK_Hex)!), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex()
    });

    // SALIDAS(1...N): Las nuevas cajas de participación resueltas
    const resolvedParticipationErgoTree = getGopParticipationResolvedErgoTreeHex();
    const resolvedParticipationOutputs = omittedParticipations.map((p: ParticipationSubmitted) => {
        const pBox = parseBox(p.box);
        return new OutputBuilder(BigInt(pBox.value), resolvedParticipationErgoTree)
            .setAdditionalRegisters({
                R4: SColl(SByte, hexToBytes(p.playerPK_Hex) ?? "").toHex(),
                R5: SColl(SByte, hexToBytes(p.commitmentC_Hex) ?? "").toHex(),
                R6: SColl(SByte, hexToBytes(p.gameNftId) ?? "").to-Hex(),
                R7: utf8StringToCollByteHex(p.solverId_String ?? ""), 
                R8: SColl(SByte, hexToBytes(p.hashLogs_Hex) ?? "").toHex(),
                R9: SColl(SLong, p.scoreList.map(s => BigInt(s))).toHex()
            });
    });

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = pkHexToBase58Address(newResolverPkHex);
    const utxos: InputBox[] = await ergo.get_utxos();

    // Inputs: La caja del juego, las participaciones omitidas a gastar, y las UTXOs del nuevo resolver.
    const inputs = [parseBox(game.box), ...omittedParticipations.map(p => parseBox(p.box)), ...utxos];
    // Data Input: La caja del ganador actual para verificar su puntuación on-chain.
    const dataInputs = [parseBox(currentWinnerParticipation.box)];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedGameBox, ...resolvedParticipationOutputs])
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción para incluir participaciones omitidas enviada. ID: ${txId}`);
    return txId;
}