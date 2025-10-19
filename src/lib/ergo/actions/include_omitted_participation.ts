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
import { stringToBytes } from '@scure/base';

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
    currentWinnerParticipation: ValidParticipation|null,
    newResolverPkHex: string
): Promise<string | null> {

    console.log(`Intentando incluir la participación omitida ${omittedParticipation.boxId} en el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("No se pueden incluir participaciones después de que finalice el período de los jueces.");
    }

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();;

    const recreatedGameBox = new OutputBuilder(
        BigInt(game.value),
        resolutionErgoTree
    )
    .addTokens(game.box.assets)
    .setAdditionalRegisters({
        R4: SInt(1).toHex(), // Preservar estado (1: Resolved)
        R5: SPair(SColl(SByte, hexToBytes(game.revealedS_Hex)!), SColl(SByte, hexToBytes(omittedParticipation.commitmentC_Hex)!)),
        R6: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)),
        R7: SColl(SLong, [
            BigInt(game.deadlineBlock), 
            BigInt(game.creatorStakeNanoErg), 
            BigInt(game.participationFeeNanoErg),
            BigInt(game.perJudgeComissionPercentage),
            BigInt(game.resolutionDeadline)
        ]).toHex(),
        R8: SPair(SColl(SByte, prependHexPrefix(hexToBytes(newResolverPkHex)!)), SLong(BigInt(game.resolverCommission))),
        R9: SPair(
                SColl(SByte, hexToBytes(game.originalCreatorScript_Hex)!),
                SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))
            ),
    });
    
    const pBox = parseBox(omittedParticipation.box);

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = pkHexToBase58Address(newResolverPkHex);
    const utxos: InputBox[] = await ergo.get_utxos();
    
    const inputs = [parseBox(game.box), ...utxos];
    const dataInputs = currentWinnerParticipation ? [parseBox(currentWinnerParticipation.box), pBox] : [pBox];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedGameBox])
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();
    
    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción para incluir participación omitida enviada. ID: ${txId}`);
    return txId;
}