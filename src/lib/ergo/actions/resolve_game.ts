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
import { bigintToLongByteArray, hexToBytes, parseBox, SString, uint8ArrayToHex, utf8StringToCollByteHex } from '$lib/ergo/utils';
import { type GameActive, type ParticipationSubmitted } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationResolvedErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

// Constante del contrato game_resolution.es
const JUDGE_PERIOD = 30;

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
    judgeProofBoxes: Box<Amount>[] // MODIFICADO: Se añade este parámetro.
): Promise<string | null> {

    console.log(`Iniciando transición a resolución para el juego: ${game.boxId}`);
    
    // --- 1. Preparación de datos y validaciones ---
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
    if (game.invitedJudges.length !== judgeProofBoxes.length) {
        throw new Error(`Se esperaba ${game.invitedJudges.length} prueba(s) de juez, pero se recibieron ${judgeProofBoxes.length}.`);
    }

    const invitedJudgesTokens = [...game.invitedJudges].sort();
    const participatingJudgesTokens = judgeProofBoxes.map(box => box.assets[0].tokenId).sort();

    if (JSON.stringify(invitedJudgesTokens) !== JSON.stringify(participatingJudgesTokens)) {
        throw new Error("Los tokens de prueba de los jueces no coinciden con los jueces invitados en el contrato.");
    }

    // --- 2. Determinar el ganador y el pozo de premios (lógica off-chain) ---
    // ... (el resto de esta sección no cambia)
    let maxScore = -1n;
    let winnerCandidateCommitment: string | null = null;
    const validParticipationInputs: InputBox[] = [];

    for (const p of participations) {
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

        if (scoreIsValid) {
            validParticipationInputs.push(p);
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
        const _msg = "No se encontraron participaciones válidas. No se puede resolver el juego.";
        console.warn(_msg);
        throw new Error(_msg)
    }

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const resolvedCounter = validParticipationInputs.length;
    
    // MODIFICADO: `judgesColl` ahora se construye a partir de los tokens de los jueces participantes (de los dataInputs).
    const judgesColl = participatingJudgesTokens
        .map(judgeTokenId => {
            const bytes = hexToBytes(judgeTokenId);
            return bytes ? [...bytes] : null;
        })
        .filter((item): item is number[] => item !== null);
    
    const resolutionBoxOutput = new OutputBuilder(
        game.creatorStakeNanoErg,
        resolutionErgoTree
    )
    .addTokens(game.box.assets)
    .setAdditionalRegisters({
        R4: SPair(SLong(resolutionDeadline), SInt(resolvedCounter)).toHex(),
        R5: SPair(SColl(SByte, secretS_bytes), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R6: SColl(SColl(SByte), judgesColl).toHex(), // R6 contiene los tokens de los jueces
        R7: SColl(SLong, [BigInt(game.deadlineBlock), game.creatorStakeNanoErg, game.participationFeeNanoErg]).toHex(),
        R8: SPair(SColl(SByte, resolverPkBytes), SLong(BigInt(game.commissionPercentage))).toHex(),
        R9: SPair(SColl(SByte, hexToBytes(game.gameCreatorPK_Hex)!), SColl(SByte, stringToBytes('utf8', game.content.rawJsonString))).toHex()
    });
    
    const resolvedParticipationErgoTree = getGopParticipationResolvedErgoTreeHex();
    const resolvedParticipationOutputs = validParticipationInputs.map((p: ParticipationSubmitted) => {
        const pBox = parseBox(p.box)

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
    const inputs = [parseBox(game.box), ...validParticipationInputs.map(p => parseBox(p.box)), ...utxos];
    
    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to([resolutionBoxOutput, ...resolvedParticipationOutputs])
            .sendChangeTo(resolverAddressString)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataInputs(judgeProofBoxes) // MODIFICADO: Se añaden los dataInputs de los jueces.
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Transición a resolución enviada con éxito. ID de la transacción: ${txId}`);
        return txId;
        
    } catch (error) {
        console.warn(error)
    }
}