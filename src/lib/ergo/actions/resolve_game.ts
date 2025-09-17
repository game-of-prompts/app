import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    type Amount,
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, uint8ArrayToHex, utf8StringToCollByteHex } from '$lib/ergo/utils';
import { type GameActive, type ParticipationSubmitted } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationResolvedErgoTreeHex, getGopParticipationSubmittedErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { GAME } from '../reputation/types';
import { fetchJudges } from '../reputation/fetch';

// Constante del contrato game_resolution.es
const JUDGE_PERIOD = 40;

/**
 * Inicia la transición de un juego del estado Activo al de Resolución.
 * Esta acción consume la caja del juego y todas las participaciones válidas,
 * y crea una nueva caja 'GameResolution' y cajas 'ParticipationResolved'.
 * @param game El objeto GameActive a resolver.
 * @param participations Un array de todas las participaciones enviadas (ParticipationSubmitted).
 * @param secretS_hex El secreto 'S' en formato hexadecimal para revelar al ganador.
 * @param judgeProofBoxes Un array de las cajas de prueba de reputación de los jueces, que se usarán como dataInputs.
 * @returns El ID de la transacción si tiene éxito.
 */
export async function resolve_game(
    game: GameActive,
    participations: ParticipationSubmitted[],
    secretS_hex: string,
    judgeProofs: string[]
): Promise<string | null> {

    console.log(`Iniciando transición a resolución para el juego: ${game.boxId}`);
    
    const dataMap = await fetchJudges();
    const judgeProofBoxes: Box<Amount>[] = judgeProofs.flatMap(key => {
        const judge = dataMap.get(key);
        if (!judge) { return []; }
        const boxWrapper = judge.current_boxes.find(box => box.type.tokenId == GAME && box.object_pointer === game.gameId);
        return boxWrapper ? [boxWrapper.box] : [];
    });

    console.warn("Judge proofs ", judgeProofs, dataMap, judgeProofBoxes)

    if (!Array.isArray(participations)) {
        throw new Error("El listado de participaciones proporcionado es inválido.");
    }
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.deadlineBlock) {
        throw new Error("El juego no puede ser resuelto antes de su fecha límite.");
    }

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("El secreto proporcionado no coincide con el hash del juego.");
    }

    const resolverAddressString = await ergo.get_change_address();
    const resolverPkBytes = ErgoAddress.fromBase58(resolverAddressString).getPublicKeys()[0];
    if (!resolverPkBytes || uint8ArrayToHex(resolverPkBytes) !== game.gameCreatorPK_Hex) {
        throw new Error("La resolución debe ser iniciada desde la billetera del creador original del juego.");
    }

    if (!Array.isArray(judgeProofBoxes)) {
        throw new Error("El listado de cajas de prueba de los jueces es inválido.");
    }
    if (game.judges.length !== judgeProofBoxes.length) {
        throw new Error(`Se esperaba ${game.judges.length} prueba(s) de juez, pero se recibieron ${judgeProofBoxes.length}.`);
    }

    const invitedJudgesTokens = [...game.judges].sort();
    const participatingJudgesTokens = judgeProofBoxes.map(box => box.assets[0].tokenId).sort();

    if (JSON.stringify(invitedJudgesTokens) !== JSON.stringify(participatingJudgesTokens)) {
        throw new Error("Los tokens de prueba de los jueces no coinciden con los jueces invitados en el contrato.");
    }

    // --- 2. Determinar el ganador y filtrar participaciones (lógica off-chain) ---
    let maxScore = -1n;
    let winnerCandidateCommitment: string | null = null;
    const validParticipations: ParticipationSubmitted[] = [];
    const participationErgoTree = getGopParticipationSubmittedErgoTreeHex();
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

        // Simulación de la validación de la puntuación
        let scoreIsValid = false;
        let actualScore = -1n;

        for (const score of p.scoreList) {
            const dataToHash = new Uint8Array([
                ...hexToBytes(p.solverId_RawBytesHex)!,
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

        // Omitir la participación de 100, a modo de prueba
        if (actualScore === 100n) {
            console.warn(`La participación ${p.boxId} tiene una puntuación de 100 y será omitida (prueba).`);
            continue;
        }

        // Si la participación es válida, se considera para determinar al ganador.
        if (actualScore > maxScore) {
            maxScore = actualScore;
            winnerCandidateCommitment = p.commitmentC_Hex;
        }
    }

    if (!winnerCandidateCommitment) {
        throw new Error("No se pudo determinar un ganador entre las participaciones válidas.");
    }

    console.log(`Número de participaciones válidas: ${validParticipations.length}`);
    console.log(`Ganador candidato determinado con compromiso: ${winnerCandidateCommitment} y puntuación: ${maxScore}`);

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const resolvedCounter = BigInt(validParticipations.length);

    const newNumericalParams = [
        BigInt(game.deadlineBlock), 
        game.creatorStakeNanoErg, 
        game.participationFeeNanoErg,
        resolutionDeadline,
        resolvedCounter
    ];
    
    const resolutionBoxOutput = new OutputBuilder(
        game.creatorStakeNanoErg,
        resolutionErgoTree
    )
    .addTokens(game.box.assets)
    .setAdditionalRegisters({
        R4: SInt(1).toHex(), // Estado: Resuelto (1)
        R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R6: SColl(SColl(SByte), participatingJudgesTokens.map(t => hexToBytes(t)!)).toHex(),
        R7: SColl(SLong, newNumericalParams).toHex(),
        R8: SPair(SColl(SByte, resolverPkBytes), SLong(BigInt(game.commissionPercentage))).toHex(),
        R9: SPair(SColl(SByte, hexToBytes(game.gameCreatorPK_Hex)!), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex()
    });
    
    const resolvedParticipationErgoTree = getGopParticipationResolvedErgoTreeHex();
    const resolvedParticipationOutputs = validParticipations.map((p: ParticipationSubmitted) => {
        const pBox = parseBox(p.box);
        return new OutputBuilder(BigInt(pBox.value), resolvedParticipationErgoTree)
            .setAdditionalRegisters({
                R4: SColl(SByte, hexToBytes(p.playerPK_Hex) ?? "").toHex(),
                R5: SColl(SByte, hexToBytes(p.commitmentC_Hex) ?? "").toHex(),
                R6: SColl(SByte, hexToBytes(p.gameNftId) ?? "").toHex(),
                R7: utf8StringToCollByteHex(p.solverId_String ?? ""), 
                R8: SColl(SByte, hexToBytes(p.hashLogs_Hex) ?? "").toHex(),
                R9: SColl(SLong, p.scoreList.map(s => BigInt(s))).toHex()
            });
    });

    // --- 4. Construir y Enviar la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...validParticipations.map(p => parseBox(p.box)), ...utxos];
    
    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to([resolutionBoxOutput, ...resolvedParticipationOutputs])
            .sendChangeTo(resolverAddressString)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataFrom(judgeProofBoxes)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Transición a resolución enviada con éxito. ID de la transacción: ${txId}`);
        return txId;
        
    } catch (error) {
        console.error("Error al construir o enviar la transacción:", error);
        throw error;
    }
}