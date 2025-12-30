import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    type Amount,
    BOX_VALUE_PER_BYTE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt, serializeBox } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { resolve_participation_commitment, calculateEffectiveScore, type GameActive, type ValidParticipation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { GAME } from '../reputation/types';
import { fetchJudges } from '../reputation/fetch';
import { prependHexPrefix } from '$lib/utils';
import { DefaultGameConstants } from '$lib/common/constants';

declare const ergo: any;

// Constante del contrato game_resolution.es
const JUDGE_PERIOD = DefaultGameConstants.JUDGE_PERIOD + 10;

/**
 * Inicia la transición de un juego del estado Activo al de Resolución.
 * Esta acción consume la caja del juego y todas las participaciones válidas,
 * y crea una nueva caja 'GameResolution' y cajas 'Participation'.
 * @param game El objeto GameActive a resolver.
 * @param participations Un array de todas las participaciones enviadas (Participation).
 * @param secretS_hex El secreto 'S' en formato hexadecimal para revelar al ganador.
 * @param judgeProofBoxes Un array de las cajas de prueba de reputación de los jueces, que se usarán como dataInputs.
 * @returns El ID de la transacción si tiene éxito.
 */
export async function resolve_game(
    game: GameActive,
    participations: ValidParticipation[],
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
    let winnerCandidateBox: Box<Amount> | null = null;

    const participationErgoTree = getGopParticipationErgoTreeHex();
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
        if (BigInt(pBox.value) < game.participationFeeAmount) {
            console.warn(`La participación ${p.boxId} no cumple con la tarifa mínima. Será omitida.`);
            continue;
        }

        // Simulación de la validación de la puntuación
        let actualScore = resolve_participation_commitment(p, secretS_hex, game.seed);

        if (actualScore === null) {
            console.warn(`No se pudo encontrar una puntuación válida para la participación ${p.commitmentC_Hex}. Será omitida.`);
            continue;
        }

        const pBoxCreationHeight = pBox.creationHeight;
        const effectiveScore = calculateEffectiveScore(actualScore, game.deadlineBlock, pBoxCreationHeight);

        // Si la participación es válida, se considera para determinar al ganador.
        // Usamos effectiveScore para comparar.
        // En caso de empate en effectiveScore, preferimos el que se envió antes (menor altura).
        // Si tienen misma altura y mismo effectiveScore (mismo rawScore), es indiferente, nos quedamos con el primero o actualizamos.
        // Aquí usamos > para actualizar solo si es estrictamente mejor.
        // Pero espera, si effectiveScore es igual, y height es menor, effectiveScore debería ser mayor?
        // No necesariamente. S1 * (D - H1) vs S2 * (D - H2).
        // Si H1 < H2, entonces (D - H1) > (D - H2).
        // Para que sean iguales, S1 debe ser menor que S2.
        // Ejemplo: D=100.
        // A: S=10, H=90. Eff = 10 * 10 = 100.
        // B: S=20, H=95. Eff = 20 * 5 = 100.
        // Empate en Eff. A se envió antes (H=90). Preferimos A?
        // El contrato dice: if (new > current || (new == current && newHeight < currentHeight))
        // Si implementamos la misma lógica:

        if (effectiveScore > maxScore || (effectiveScore === maxScore && pBoxCreationHeight < (winnerCandidateBox ? parseBox(winnerCandidateBox).creationHeight : Infinity))) {
            maxScore = effectiveScore;
            winnerCandidateCommitment = p.commitmentC_Hex;
            winnerCandidateBox = p.box;
        }
    }

    console.log(`Ganador candidato determinado con compromiso: ${winnerCandidateCommitment} y puntuación: ${maxScore}`);

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);

    const newNumericalParams = [
        BigInt(game.deadlineBlock),
        game.creatorStakeAmount,
        game.participationFeeAmount,
        game.perJudgeComissionPercentage,
        BigInt(game.commissionPercentage),
        resolutionDeadline
    ];

    let winnerCommitmentBytes: Uint8Array;
    if (winnerCandidateCommitment) {
        const bytes = hexToBytes(winnerCandidateCommitment);
        if (!bytes) throw new Error("Fallo al convertir commitmentC a bytes.");
        winnerCommitmentBytes = bytes;
    }
    else {
        winnerCommitmentBytes = new Uint8Array();
    }
    // max para BigInt
    const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);

    const seedBytes = hexToBytes(game.seed);
    if (!seedBytes) throw new Error("No se pudo obtener el 'seed' del objeto game (game.seedHex).");

    const gameDetailsBytes = stringToBytes('utf8', game.content.rawJsonString);

    const r4Hex = SInt(1).toHex(); // R4: Estado (1: Resuelto)
    const r5Hex = SColl(SByte, seedBytes).toHex(); // R5: Seed
    const r6Hex = SPair(SColl(SByte, secretS_bytes), SColl(SByte, winnerCommitmentBytes)).toHex(); // R6: (secretS, winnerCommitment)
    const r7Hex = SColl(SColl(SByte), participatingJudgesTokens.map(t => hexToBytes(t)!)).toHex(); // R7: Jueces participantes
    const r8Hex = SColl(SLong, newNumericalParams).toHex(); // R8: Parámetros numéricos

    const r9Hex = SColl(SColl(SByte), [gameDetailsBytes, hexToBytes(game.participationTokenId) ?? "", prependHexPrefix(resolverPkBytes)]).toHex();

    const boxCandidate = {
        transactionId: "00".repeat(32),
        index: 0,
        value: SAFE_MIN_BOX_VALUE,
        ergoTree: resolutionErgoTree,
        creationHeight: currentHeight,
        assets: game.box.assets,
        additionalRegisters: {
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        }
    };

    let boxSize = 0;
    try {
        const serialized = serializeBox(boxCandidate);
        boxSize = serialized.length;
        console.log("REAL resolution box size:", boxSize);
    } catch (e) {
        console.error("Error serializing resolution box:", e);
        throw new Error("Failed to serialize the resolution box. It might be too large or invalid.");
    }

    if (boxSize > 4096) {
        throw new Error(`The resolution box size (${boxSize} bytes) exceeds the maximum allowed size of 4096 bytes.`);
    }

    const minRequiredValue = BigInt(boxSize) * BOX_VALUE_PER_BYTE;

    // valor actual de la caja (asegurate que sea BigInt)
    const originalValue = BigInt(game.box.value);

    // seleccionar el mayor entre originalValue, minRequiredValue y SAFE_MIN_BOX_VALUE
    const resolutionBoxValue = maxBigInt(originalValue, minRequiredValue, SAFE_MIN_BOX_VALUE);

    const resolutionBoxOutput = new OutputBuilder(
        resolutionBoxValue,
        resolutionErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters({
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        });

    // --- 4. Construir y Enviar la Transacción ---    

    const dataInputs = winnerCandidateBox ? [...judgeProofBoxes, winnerCandidateBox] : judgeProofBoxes;

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from([parseBox(game.box), ...await ergo.get_utxos()])
            .to([resolutionBoxOutput])
            .sendChangeTo(resolverAddressString)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataFrom(dataInputs)
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