import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';

// --- Constantes ---
const DEV_ADDR = "9gGZp7HRAFxgGWSwvS4hCbxM2RpkYr6pHvwpU4GPrpvxY7Y2nQo"; 
const DEV_COMMISSION_PERCENTAGE = 5n;

/**
 * Construye y envía la transacción para finalizar un juego.
 * Los pagos que no alcanzan el mínimo (polvo) se redirigen al ganador.
 * @param game El objeto que representa la caja del juego a finalizar.
 * @param participations Un array con las cajas de participación resueltas.
 * @returns El ID de la transacción enviada.
 */
export async function end_game(
    game: GameResolution,
    participations: ParticipationResolved[]
): Promise<string> {

    console.log(`[end_game] Iniciando finalización del juego: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();

    // --- 1. Verificaciones preliminares ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("El período de resolución de los jueces aún no ha terminado.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment);
    if (!winnerParticipation) {
        throw new Error("No se pudo encontrar la caja de participación del ganador declarado.");
    }

    // --- 2. Lógica de Cálculo de Pagos (NUEVA POLÍTICA) ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    
    // 2.1. Calcular los componentes base del pago
    const creatorStake = game.creatorStakeNanoErg;
    const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;
    const devCommission = (prizePool * DEV_COMMISSION_PERCENTAGE) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;

    // 2.2. Determinar los pagos intermedios según si el premio del ganador es "polvo"
    const winnerGetsBasePrize = winnerBasePrize >= SAFE_MIN_BOX_VALUE;

    const intermediateDevPayout = winnerGetsBasePrize ? devCommission : 0n;
    const intermediateResolverPayout = winnerGetsBasePrize ? (creatorStake + resolverCommission) : creatorStake;
    const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : (winnerBasePrize + resolverCommission + devCommission);

    // 2.3. Calcular qué cantidades se confiscan por ser "polvo" y redistribuirlas al ganador
    const devForfeits = (intermediateDevPayout > 0n && intermediateDevPayout < SAFE_MIN_BOX_VALUE) ? intermediateDevPayout : 0n;
    const resolverForfeits = (intermediateResolverPayout > 0n && intermediateResolverPayout < SAFE_MIN_BOX_VALUE) ? intermediateResolverPayout : 0n;

    // 2.4. Asignar los pagos finales
    const finalDevPayout = intermediateDevPayout - devForfeits;
    const finalResolverPayout = intermediateResolverPayout - resolverForfeits;
    const finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits;

    console.log("--- Resumen de Pagos (nanoErgs) ---");
    console.log(`Premio Final Ganador: ${finalWinnerPrize}`);
    console.log(`Pago Final Resolver: ${finalResolverPayout}`);
    console.log(`Pago Final Dev: ${finalDevPayout}`);
    console.log("------------------------------------");

    // --- 3. Construcción de Salidas ---
    const outputs: OutputBuilder[] = [];
    const gameNft = game.box.assets[0];
    const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);

    // 3.1. Salida para el Ganador (siempre se crea, contiene el NFT)
    // La transacción fallará a nivel de protocolo si finalWinnerPrize < SAFE_MIN_BOX_VALUE,
    // lo cual es el comportamiento deseado.
    outputs.push(
        new OutputBuilder(finalWinnerPrize, winnerAddressString).addTokens([gameNft])
    );

    // 3.2. Salida para el Resolutor (si aplica)
    if (finalResolverPayout > 0n) {
        const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
        outputs.push(
            new OutputBuilder(finalResolverPayout, resolverAddressString)
        );
    }

    // 3.3. Salida para el Desarrollador (si aplica)
    if (finalDevPayout > 0n) {
        outputs.push(
            new OutputBuilder(finalDevPayout, DEV_ADDR)
        );
    }

    // --- 4. Construcción y Envío de la Transacción ---
    const userAddress = await ergo.get_change_address();
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box))];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([...inputs, ...utxos])
        .to(outputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    console.log("Transacción EIP-12 sin firmar generada.");

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`✅ ¡Éxito! Transacción de finalización enviada. ID: ${txId}`);
        return txId;
    } 
    catch (error) {
        console.error("Error al firmar o enviar la transacción:", error);
        throw error;
    }
}