import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    SConstant
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, uint8ArrayToHex, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation, type ValidParticipation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationErgoTreeHex } from '../contract';
import { prependHexPrefix } from '$lib/utils';

/**
 * Permite a cualquier usuario incluir una participación que fue omitida
 * durante la transición inicial a la fase de Resolución.
 *
 * @param game El objeto GameResolution actual.
 * @param omittedParticipation La participación en estado "Submitted" a incluir.
 * @param currentWinnerParticipation La participación ya resuelta del ganador actual.
 * @param newResolverPkHex La clave pública hexadecimal del usuario que ejecuta la acción, quien se convertirá en el nuevo resolver.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function include_omitted_participation(
    game: GameResolution,
    omittedParticipation: ValidParticipation,
    currentWinnerParticipation: ValidParticipation,
    newResolverPkHex: string
): Promise<string | null> {

    console.log(`Intentando incluir la participación omitida ${omittedParticipation.boxId} en el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("No se pueden incluir participaciones después de que finalice el período de los jueces.");
    }
    if (!omittedParticipation) {
        throw new Error("Se debe proporcionar una participación omitida.");
    }

    const secretS_bytes = hexToBytes(game.revealedS_Hex);
    if (!secretS_bytes) throw new Error("El secreto 'S' del juego es inválido.");

    // --- 2. Determinar el nuevo ganador potencial ---

    const getActualScore = (p: ValidParticipation | ValidParticipation): bigint => {
        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!, ...bigintToLongByteArray(BigInt(score)),
                ...hexToBytes(p.hashLogs_Hex)!, ...secretS_bytes
            ]);
            if (uint8ArrayToHex(fleetBlake2b256(dataToHash)) === p.commitmentC_Hex) return score;
        }
        throw new Error(`No se pudo validar ninguna puntuación para la participación ${p.boxId}`);
    };

    const currentWinnerScore = getActualScore(currentWinnerParticipation);
    const omittedScore = getActualScore(omittedParticipation);

    let newWinnerCommitment = game.winnerCandidateCommitment;

    if (omittedScore > currentWinnerScore) {
        newWinnerCommitment = omittedParticipation.commitmentC_Hex;
    } else if (omittedScore === currentWinnerScore) {
        // Regla de desempate: la participación creada antes gana.
        if (omittedParticipation.creationHeight < currentWinnerParticipation.creationHeight) {
            newWinnerCommitment = omittedParticipation.commitmentC_Hex;
        }
    }

    // --- 3. Construir las Salidas de la Transacción ---
    
    // SALIDA(0): La caja del juego de resolución, recreada y actualizada
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    
    // Extraer y actualizar los parámetros numéricos de R7
    const numericalParams = [
        BigInt(game.deadlineBlock), 
        game.creatorStakeNanoErg, 
        game.participationFeeNanoErg,
        BigInt(game.resolutionDeadline),
        BigInt(game.resolvedCounter)
    ];
    numericalParams[4] += 1n; // Incrementar el resolvedCounter

    const recreatedGameBox = new OutputBuilder(
        BigInt(game.value),
        resolutionErgoTree
    )
    .addTokens(game.box.assets)
    .setAdditionalRegisters({
        R4: SInt(1).toHex(), // Preservar estado (1: Resolved)
        R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(newWinnerCommitment)!)),
        R6: SConstant(game.box.additionalRegisters.R6), // Preservar jueces
        R7: SColl(SLong, numericalParams).toHex(), // Actualizar contador en R7
        R8: SPair(SColl(SByte, prependHexPrefix(hexToBytes(newResolverPkHex)!)), SLong(BigInt(game.resolverCommission))),
        R9: SConstant(game.box.additionalRegisters.R9) // Preservar proveniencia
    });

    // SALIDA(1): La nueva caja de participación resuelta
    const participationErgoTree = getGopParticipationErgoTreeHex();
    const pBox = parseBox(omittedParticipation.box);
    const participationOutput = new OutputBuilder(BigInt(pBox.value), participationErgoTree)
        .setAdditionalRegisters({
                R4: SColl(SByte, hexToBytes(omittedParticipation.playerPK_Hex) ?? "").toHex(),
                R5: SColl(SByte, hexToBytes(omittedParticipation.commitmentC_Hex) ?? "").toHex(),
                R6: SColl(SByte, hexToBytes(omittedParticipation.gameNftId) ?? "").toHex(),
                R7: SColl(SByte, (hexToBytes(omittedParticipation.solverId_String ?? "")) ?? "").toHex(), 
                R8: SColl(SByte, hexToBytes(omittedParticipation.hashLogs_Hex) ?? "").toHex(),
                R9: SColl(SLong, omittedParticipation.scoreList.map(s => BigInt(s))).toHex()
        });

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = pkHexToBase58Address(newResolverPkHex);
    const utxos: InputBox[] = await ergo.get_utxos();
    
    const inputs = [parseBox(game.box), pBox, ...utxos];
    const dataInputs = [parseBox(currentWinnerParticipation.box)];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedGameBox, participationOutput])
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción para incluir participación omitida enviada. ID: ${txId}`);
    return txId;
}