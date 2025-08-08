import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    type InputBox,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameActive, type ParticipationSubmitted } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationResolvedErgoTreeHex } from '../contract';

// Constante del contrato game_resolution.es
const JUDGE_PERIOD = 30;

/**
 * Inicia la transición de un juego del estado Activo al de Resolución.
 * Esta acción consume la caja del juego y todas las participaciones válidas,
 * y crea una nueva caja 'GameResolution' y cajas 'ParticipationResolved'.
 * * @param game El objeto GameActive a resolver.
 * @param participations Un array de todas las participaciones enviadas (ParticipationSubmitted).
 * @param secretS_hex El secreto 'S' en formato hexadecimal para revelar al ganador.
 * @returns El ID de la transacción si tiene éxito.
 */
export async function resolve_game(
    game: GameActive,
    participations: ParticipationSubmitted[],
    secretS_hex: string
): Promise<string | null> {

    console.log(`Iniciando transición a resolución para el juego: ${game.boxId}`);
    
    // --- 1. Preparación de datos y validaciones ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.deadlineBlock) {
        throw new Error("El juego no puede ser resuelto antes de su fecha límite.");
    }

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

    // Verificar que el secreto coincide con el hash del juego activo.
    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("El secreto proporcionado no coincide con el hash del juego.");
    }

    const resolverAddressString = await ergo.get_change_address();
    const resolverPkBytes = ErgoAddress.fromBase58(resolverAddressString).getPublicKeys()[0];
    if (!resolverPkBytes) throw new Error("No se pudo obtener la clave pública del 'resolvedor'.");

    // --- 2. Determinar el ganador y el pozo de premios (lógica off-chain) ---
    // Esta lógica simula lo que el contrato hará on-chain para asegurar que la tx es válida.
    let maxScore = -1n;
    let winnerCandidateCommitment: string | null = null;
    let totalPrizePool = 0n;
    const validParticipationInputs: InputBox[] = [];

    for (const p of participations) {
        let scoreIsValid = false;
        let actualScore = -1n;

        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!,
                ...bigintToLongByteArray(score),
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

        if (scoreIsValid) {
            validParticipationInputs.push(parseBox(p.box));
            totalPrizePool += p.value;
            if (actualScore > maxScore) {
                maxScore = actualScore;
                winnerCandidateCommitment = p.commitmentC_Hex;
            }
        }
    }

    if (!winnerCandidateCommitment && validParticipationInputs.length > 0) {
        throw new Error("Se encontraron participaciones válidas, pero no se pudo determinar un ganador.");
    }
    
    if (!winnerCandidateCommitment) {
        console.warn("No se encontraron participaciones válidas. El pozo de premios será cero.");
        winnerCandidateCommitment = uint8ArrayToHex(new Uint8Array(32).fill(0)); // Un commitment placeholder si no hay ganador.
    }

    // --- 3. Construir las Salidas de la Transacción ---

    // SALIDA(0): La caja GameResolution
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const resolvedCounter = validParticipationInputs.length;
    
    const resolutionBoxOutput = new OutputBuilder(
        game.creatorStakeNanoErg + totalPrizePool,
        resolutionErgoTree
    )
    .addTokens(game.box.assets) // Transferir el NFT del juego
    .setAdditionalRegisters({
        R4: SPair(SLong(resolutionDeadline), SInt(resolvedCounter)).toHex(),
        R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R6: SColl(SColl(SByte, game.invitedJudges.map(hexToBytes) as Uint8Array[])).toHex(),
        R7: SColl(SLong, [BigInt(game.deadlineBlock), game.creatorStakeNanoErg, game.participationFeeNanoErg]).toHex(),
        R8: SPair(SColl(SByte, resolverPkBytes), SInt(game.commissionPercentage)).toHex(),
        R9: SPair(SColl(SByte, hexToBytes(game.gameCreatorPK_Hex)!), SString(game.content.rawJsonString).toBytes()).toHex()
    });
    
    // SALIDAS(1...N): Las cajas ParticipationResolved
    const resolvedParticipationErgoTree = getGopParticipationResolvedErgoTreeHex();
    const resolvedParticipationOutputs = validParticipationInputs.map(pBox => {
        return new OutputBuilder(BigInt(pBox.value), resolvedParticipationErgoTree)
            .setAdditionalRegisters(pBox.additionalRegisters);
    });

    // --- 4. Construir y Enviar la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...validParticipationInputs, ...utxos];
    
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([resolutionBoxOutput, ...resolvedParticipationOutputs])
        .sendChangeTo(resolverAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transición a resolución enviada con éxito. ID de la transacción: ${txId}`);
    return txId;
}