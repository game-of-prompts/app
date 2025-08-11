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

    console.log(`Finalizando el juego: ${game.boxId}`);

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.resolutionDeadline) {
        throw new Error(`El período de los jueces no ha terminado. Solo se puede finalizar después del bloque ${game.resolutionDeadline}.`);
    }

    if (!participations || participations.length === 0) {
        throw new Error("No se proporcionaron participaciones para finalizar el juego.");
    }

    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment);
    if (!winnerParticipation) {
        throw new Error(`No se pudo encontrar la caja de participación del ganador con el commitment: ${game.winnerCandidateCommitment}.`);
    }
    
    const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
    const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
    const gameNft = game.box.assets[0];


    // --- 2. Calcular el pozo de premios y las comisiones (lógica del contrato) ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    
    const resolverCommissionAmount = (prizePool * BigInt(game.resolverCommission)) / 100n;
    const devCommissionAmount = (prizePool * DEV_COMMISSION_PERCENTAGE) / 100n;
    const judgesCommissionAmount = (prizePool * JUDGE_COMMISSION_PERCENTAGE) / 100n;

    const winnerPrize = prizePool - resolverCommissionAmount - devCommissionAmount - judgesCommissionAmount;
    
    // El 'resolver' recibe su comisión más el stake original del creador.
    const resolverTotalPayout = game.creatorStakeNanoErg + resolverCommissionAmount;


    // --- 3. Construir las Salidas de la Transacción ---
    const outputs: OutputBuilder[] = [];

    // SALIDA(0): El premio para el ganador
    if (winnerPrize > 0) {
        outputs.push(new OutputBuilder(winnerPrize, winnerAddressString)
            .addTokens([gameNft]) // El ganador recibe el NFT del juego como trofeo.
        );
    }

    // SALIDA(1): El pago para el 'resolver'
    outputs.push(new OutputBuilder(resolverTotalPayout, resolverAddressString));

    // SALIDA(2): La comisión para el desarrollador
    if (devCommissionAmount >= SAFE_MIN_BOX_VALUE) {
        outputs.push(new OutputBuilder(devCommissionAmount, DEV_ADDR));
    }
    
    // SALIDA(3): La comisión para los jueces. 
    // Por simplicidad, se envía a la dirección del desarrollador. En un caso real, podría distribuirse.
    if (judgesCommissionAmount >= SAFE_MIN_BOX_VALUE) {
        outputs.push(new OutputBuilder(judgesCommissionAmount, DEV_ADDR));
    }

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = await ergo.get_change_address();
    const utxos: InputBox[] = await ergo.get_utxos();
    
    // Los inputs incluyen la caja del juego, todas las participaciones y las UTXOs del usuario para las tarifas.
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box)), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(outputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción de finalización de juego enviada con éxito. ID: ${txId}`);
    return txId;
}