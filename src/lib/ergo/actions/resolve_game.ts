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
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { bigintToLongByteArray, hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameActive, type ValidParticipation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { GAME } from '../reputation/types';
import { fetchJudges } from '../reputation/fetch';
import { prependHexPrefix } from '$lib/utils';

// Constante del contrato game_resolution.es
const JUDGE_PERIOD = 40;

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
                ...hexToBytes(p.playerScript_Hex)!,
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
            console.warn(`No se pudo encontrar una puntuación válida para la participación ${p.commitmentC_Hex}. Será omitida.`);
            continue;
        }

        // Si la participación es válida, se considera para determinar al ganador.
        if (actualScore > maxScore) {
            maxScore = actualScore;
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
        game.creatorStakeNanoErg, 
        game.participationFeeNanoErg,
        game.perJudgeComissionPercentage,
        resolutionDeadline
    ];
    
    let winnerCommitmentBytes = null;
    if (winnerCandidateCommitment) {
        winnerCommitmentBytes = hexToBytes(winnerCandidateCommitment);
        if (!winnerCommitmentBytes) throw new Error("Fallo al convertir commitmentC a bytes.");
    }
    else {
        winnerCommitmentBytes = new Uint8Array();
    }

    const gameCreatorScript = hexToBytes(game.gameCreatorScript_Hex!)!;

    if (!gameCreatorScript) throw new Error("Fallo al convertir gameCreatorScript a bytes.");

    // Helpers
    const stripHexPrefix = (h: string) => h?.startsWith('0x') ? h.slice(2) : h;
    const isHex = (s: string) => typeof s === 'string' && /^0x?[0-9a-fA-F]+$/.test(s);

    // devuelve número de bytes representados por la cadena hex (sin prefijo)
    const hexBytesLen = (hexStr: string): number => {
    if (!hexStr) return 0;
    const h = stripHexPrefix(hexStr);
    return Math.ceil(h.length / 2);
    };

    // max para BigInt
    const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);

    // CONSTANTES (ajustalas según tu entorno)
    const BASE_BOX_OVERHEAD = 60;          // bytes aprox. (header, value, creationHeight, etc.)
    const PER_TOKEN_BYTES = 40;            // aproximación por token: 32 (id) + 8 (amount)
    const PER_REGISTER_OVERHEAD = 1;       // bytes por índice/encabezado de registro
    const SIZE_MARGIN = 120;               // margen de seguridad en bytes

    // --- construí aquí los hex de los registros igual que los vas a poner en setAdditionalRegisters ---
    const r4Hex = SInt(1).toHex();
    const r5Hex = SPair(SColl(SByte, secretS_bytes), SColl(SByte, winnerCommitmentBytes)).toHex();
    const r6Hex = SColl(SColl(SByte), participatingJudgesTokens.map(t => hexToBytes(t)!)).toHex();
    const r7Hex = SColl(SLong, newNumericalParams).toHex();
    const r8Hex = SPair(SColl(SByte, prependHexPrefix(resolverPkBytes)), SLong(BigInt(game.commissionPercentage))).toHex();
    const r9Hex = SPair(SColl(SByte, gameCreatorScript), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex();

    // Conteos y tamaños
    const registersHex = [r4Hex, r5Hex, r6Hex, r7Hex, r8Hex, r9Hex];

    // tamaño del ergoTree (puede ser hex o fuente legible); detectamos si es hex:
    let ergoTreeBytes = 0;
    if (typeof resolutionErgoTree === 'string' && isHex(resolutionErgoTree)) {
    ergoTreeBytes = hexBytesLen(resolutionErgoTree);
    } else {
    // si no es hex, calculamos bytes de la cadena UTF-8
    ergoTreeBytes = new TextEncoder().encode(String(resolutionErgoTree || '')).length;
    }

    // tamaño tokens
    const tokens = Array.isArray(game.box.assets) ? game.box.assets : [];
    const tokensCount = tokens.length;
    const tokensBytes = 1 + tokensCount * PER_TOKEN_BYTES; // 1 byte para count + cada token

    // tamaño registros (sumando overhead por registro)
    let registersBytes = 0;
    for (const h of registersHex) {
    const len = hexBytesLen(h);
    registersBytes += len + PER_REGISTER_OVERHEAD;
    }

    // tamaño total estimado
    const totalEstimatedSize = BigInt(
    BASE_BOX_OVERHEAD
    + ergoTreeBytes
    + tokensBytes
    + registersBytes
    + SIZE_MARGIN
    );

    // mínimo requerido en nanoErgs
    const minRequiredValue = BOX_VALUE_PER_BYTE * totalEstimatedSize;

    // valor actual de la caja (asegurate que sea BigInt)
    const originalValue = BigInt(game.box.value);

    // seleccionar el mayor entre originalValue, minRequiredValue y SAFE_MIN_BOX_VALUE
    const resolutionBoxValue = maxBigInt(originalValue, minRequiredValue, SAFE_MIN_BOX_VALUE);

    // Ahora construís la salida con ese value (no se usa setValue después)
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