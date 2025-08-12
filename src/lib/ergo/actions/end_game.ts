import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';

// --- Constantes del contrato ---
const DEV_ADDR = "9gGZp7HRAFxgGWSwvS4hCbxM2RpkYr6pHvwpU4GPrpvxY7Y2nQo"; 
const DEV_COMMISSION_PERCENTAGE = 5n;
const JUDGE_COMMISSION_PERCENTAGE = 5n;

/**
 * Construye y envía la transacción para finalizar un juego.
 * Los pagos que no alcanzan el mínimo seguro (polvo) se redirigen al desarrollador.
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

    // --- 2. Lógica de Cálculo de Pagos ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    let forfeitedToDev = 0n;

    // 2.1. Pago al Resolutor
    const resolverPotentialPayout = game.creatorStakeNanoErg + (prizePool * BigInt(game.resolverCommission)) / 100n;
    const finalResolverPayout = resolverPotentialPayout >= SAFE_MIN_BOX_VALUE ? resolverPotentialPayout : 0n;
    if (finalResolverPayout === 0n && resolverPotentialPayout > 0n) {
        forfeitedToDev += resolverPotentialPayout;
    }

    // 2.2. Comisión de los Jueces (se paga a la dirección del DEV)  <-- TODO
    const judgesPotentialCommission = (prizePool * JUDGE_COMMISSION_PERCENTAGE) / 100n;
    const finalJudgesCommission = judgesPotentialCommission >= SAFE_MIN_BOX_VALUE ? judgesPotentialCommission : 0n;
    if (finalJudgesCommission === 0n && judgesPotentialCommission > 0n) {
        forfeitedToDev += judgesPotentialCommission;
    }
    
    // 2.3. Premio del Ganador
    const baseDevCommission = (prizePool * DEV_COMMISSION_PERCENTAGE) / 100n;
    const totalPot = prizePool + game.creatorStakeNanoErg;
    const winnerPotentialPrize = totalPot - resolverPotentialPayout - judgesPotentialCommission - baseDevCommission;
    
    let finalWinnerPrize = 0n;
    if (winnerPotentialPrize >= SAFE_MIN_BOX_VALUE) {
        finalWinnerPrize = winnerPotentialPrize;
    } else if (winnerPotentialPrize > 0n) {
        forfeitedToDev += winnerPotentialPrize;
    }
    
    // 2.4. Pago total al Desarrollador
    const finalDevPayout = baseDevCommission + forfeitedToDev;
    
    console.log("--- Resumen de Pagos (nanoErgs) ---");
    console.log(`Pago Final Resolver: ${finalResolverPayout} (Potencial: ${resolverPotentialPayout})`);
    console.log(`Comisión Final Jueces (a DEV): ${finalJudgesCommission} (Potencial: ${judgesPotentialCommission})`);
    console.log(`Premio Final Ganador: ${finalWinnerPrize} (Potencial: ${winnerPotentialPrize})`);
    console.log(`Pago Final Dev (Base + Forfeited): ${finalDevPayout}`);
    console.log("------------------------------------");

    // --- 3. Construcción de Salidas ---
    const outputs: OutputBuilder[] = [];

    // 3.1. Salida para el Ganador (si aplica)
    if (finalWinnerPrize > 0n) {
        const gameNft = game.box.assets[0];
        const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        outputs.push(
            new OutputBuilder(finalWinnerPrize, winnerAddressString).addTokens([gameNft])
        );
    }

    // 3.2. Salida para el Resolutor (si aplica)
    if (finalResolverPayout > 0n) {
        const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
        outputs.push(
            new OutputBuilder(finalResolverPayout, resolverAddressString)
        );
    }

    // 3.3. Salida Unificada para el Desarrollador
    // Calculamos el monto total para la dirección del dev ANTES de crear el output.
    // Este monto incluye la comisión base, los fondos perdidos ("forfeited") y la comisión de los jueces.
    const totalDevAddressPayout = finalDevPayout + finalJudgesCommission;

    console.log(`Monto total a la dirección del DEV: ${totalDevAddressPayout} (Pago Dev: ${finalDevPayout} + Comisión Jueces: ${finalJudgesCommission})`);

    if (totalDevAddressPayout > 0n) {
        outputs.push(
            new OutputBuilder(totalDevAddressPayout, DEV_ADDR)
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

    console.log("Transacción EIP-12 sin firmar.");

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