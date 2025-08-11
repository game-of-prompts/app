import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox
} from '@fleet-sdk/core';
import { ErgoAddress } from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';

// --- Constantes del contrato 'game_resolution.es' ---
const DEV_ADDR = "9hP2jM1s3P2o3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v"; // Reemplazar con la dirección real del desarrollador
const DEV_COMMISSION_PERCENTAGE = 5n;
const JUDGE_COMMISSION_PERCENTAGE = 5n;

/**
 * Ejecuta la acción final para un juego en estado de Resolución.
 * Consume la caja del juego y todas las participaciones resueltas para
 * pagar al ganador, al resolver, a los jueces y al desarrollador.
 *
 * @param game El objeto GameResolution a finalizar.
 * @param participations Un array de todas las participaciones en estado resuelto.
 * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito.
 */
export async function end_game(
    game: GameResolution,
    participations: ParticipationResolved[]
): Promise<string | null> {

    console.log(`[end_game] Iniciando finalización para el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.resolutionDeadline) {
        throw new Error(`[CHECK FAILED] El período de los jueces no ha terminado. Bloque actual: ${currentHeight}, Deadline: ${game.resolutionDeadline}.`);
    }
    console.log("[CHECK PASSED] El período de los jueces ha finalizado.");

    if (!participations || participations.length === 0) {
        throw new Error("[CHECK FAILED] No se proporcionaron participaciones para finalizar el juego.");
    }
    console.log(`[INFO] Procesando ${participations.length} participaciones.`);

    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment);
    if (!winnerParticipation) {
        throw new Error(`[CHECK FAILED] No se pudo encontrar la caja de participación del ganador con el commitment: ${game.winnerCandidateCommitment}.`);
    }
    console.log(`[CHECK PASSED] Ganador encontrado: ${winnerParticipation.playerPK_Hex}`);
    
    const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
    const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
    const gameNft = game.box.assets[0];

    // Check adicional: Asegurarse de que el NFT del juego existe.
    if (!gameNft) {
        throw new Error("[CHECK FAILED] La caja del juego no contiene el NFT identificador.");
    }
    console.log(`[INFO] NFT del juego: ${gameNft.tokenId}`);


    // --- 2. Calcular el pozo de premios y las comisiones (lógica del contrato) ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    
    const resolverCommissionAmount = (prizePool * BigInt(game.resolverCommission)) / 100n;
    const devCommissionAmount = (prizePool * DEV_COMMISSION_PERCENTAGE) / 100n;
    const judgesCommissionAmount = (prizePool * JUDGE_COMMISSION_PERCENTAGE) / 100n;

    const winnerPrize = prizePool - resolverCommissionAmount - devCommissionAmount - judgesCommissionAmount;
    
    // Check adicional: El premio del ganador no puede ser negativo.
    if (winnerPrize < 0) {
        throw new Error("[CHECK FAILED] El cálculo del premio del ganador resultó en un valor negativo. Revise las comisiones.");
    }
    
    // El 'resolver' recibe su comisión más el stake original del creador.
    let resolverTotalPayout = game.creatorStakeNanoErg + resolverCommissionAmount;

    console.log("[CALCULATIONS] Resumen de pagos (en nanoErgs):", {
        prizePool: prizePool.toString(),
        resolverCommissionAmount: resolverCommissionAmount.toString(),
        devCommissionAmount: devCommissionAmount.toString(),
        judgesCommissionAmount: judgesCommissionAmount.toString(),
        winnerPrize: winnerPrize.toString(),
        resolverStakeRefund: game.creatorStakeNanoErg.toString(),
        resolverTotalPayout: resolverTotalPayout.toString(),
    });


    // --- 3. Construir las Salidas de la Transacción ---
    const outputs: OutputBuilder[] = [];

    // SALIDA(0): El premio para el ganador
    // Solo se crea la caja si el premio es superior al mínimo existencial de una caja.
    if (winnerPrize >= SAFE_MIN_BOX_VALUE) {
        outputs.push(new OutputBuilder(winnerPrize, winnerAddressString)
            .addTokens([gameNft]) // El ganador recibe el NFT del juego como trofeo.
        );
        console.log(`[OUTPUT] Creada salida para el ganador (${winnerAddressString}) con ${winnerPrize} nanoErgs.`);
    } else {
        console.warn(`[OUTPUT] El premio del ganador (${winnerPrize}) es muy bajo, los fondos se quedarán en la caja del resolver.`);
        // Si el premio es muy bajo, se añade al pago del resolver para no perder los fondos.
        resolverTotalPayout += winnerPrize;
    }

    // SALIDA(1): El pago para el 'resolver'
    if (resolverTotalPayout < SAFE_MIN_BOX_VALUE) {
        throw new Error(`[CHECK FAILED] El pago total del resolver (${resolverTotalPayout}) es menor que el mínimo requerido para una caja.`);
    }
    outputs.push(new OutputBuilder(resolverTotalPayout, resolverAddressString));
    console.log(`[OUTPUT] Creada salida para el resolver (${resolverAddressString}) con ${resolverTotalPayout} nanoErgs.`);


    // SALIDA(2): La comisión para el desarrollador
    if (devCommissionAmount >= SAFE_MIN_BOX_VALUE) {
        outputs.push(new OutputBuilder(devCommissionAmount, DEV_ADDR));
        console.log(`[OUTPUT] Creada salida para el dev (${DEV_ADDR}) con ${devCommissionAmount} nanoErgs.`);
    }
    
    // SALIDA(3): La comisión para los jueces. 
    // Por simplicidad, se envía a la dirección del desarrollador. En un caso real, podría distribuirse.
    if (judgesCommissionAmount >= SAFE_MIN_BOX_VALUE) {
        outputs.push(new OutputBuilder(judgesCommissionAmount, DEV_ADDR));
        console.log(`[OUTPUT] Creada salida para los jueces (enviada a ${DEV_ADDR}) con ${judgesCommissionAmount} nanoErgs.`);
    }

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();
    
    // Los inputs incluyen la caja del juego, todas las participaciones y las UTXOs del usuario para las tarifas.
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box)), ...utxos];

    console.log("[TXN_BUILD] Construyendo la transacción...");
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(outputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    console.log("[TXN_SIGN] Solicitando firma al usuario...");
    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    
    console.log("[TXN_SUBMIT] Enviando transacción a la red...");
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`[SUCCESS] Transacción de finalización de juego enviada con éxito. ID: ${txId}`);
    return txId;
}