import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type Participation } from '$lib/common/game';
import { dev_addr_base58, dev_fee } from '../contract';

/**
 * Construye y envía la transacción para finalizar un juego.
 * Los pagos que no alcanzan el mínimo (polvo) se redirigen al beneficiario principal.
 * @param game El objeto que representa la caja del juego a finalizar.
 * @param participations Un array con las cajas de participación resueltas.
 * @returns El ID de la transacción enviada.
 */
export async function end_game(
    game: GameResolution,
    participations: Participation[]
): Promise<string> {

    console.log(`[end_game] Iniciando finalización del juego: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();

    // --- 1. Verificaciones preliminares ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("El período de resolución de los jueces aún no ha terminado.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 2. Lógica de Cálculo de Pagos ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);

    // Variables para almacenar los pagos finales
    let finalWinnerPrize = 0n;
    let finalResolverPayout = 0n;
    let finalDevPayout = 0n;

    if (winnerParticipation === null) {
        // --- CASO: NO HAY GANADOR ---
        console.log("No hay ganador declarado. El premio se distribuye entre el resolutor y el desarrollador.");

        // El resolutor reclama la apuesta del creador (creatorStake) y todo el pozo de premios.
        const totalValue = prizePool + game.creatorStakeNanoErg;

        // La comisión del desarrollador se calcula sobre el pozo de premios.
        const devCommission = (prizePool * dev_fee) / 100n;

        // Si la comisión del dev es "polvo", se confisca y se entrega al resolutor.
        const devForfeits = (devCommission > 0n && devCommission < SAFE_MIN_BOX_VALUE) ? devCommission : 0n;
        
        finalDevPayout = devCommission - devForfeits;
        // El resolutor recibe el valor total menos la comisión del dev (y se queda con la parte confiscada).
        finalResolverPayout = totalValue - finalDevPayout;

        console.log("--- Resumen de Pagos (Sin Ganador) ---");
        console.log(`Pago Final Resolver: ${finalResolverPayout} (incluye NFT)`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log("---------------------------------------");

    } else {
        // --- CASO: SÍ HAY GANADOR ---
        console.log(`Ganador declarado: ${winnerParticipation.playerPK_Hex}`);

        const creatorStake = game.creatorStakeNanoErg;
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;
        const devCommission = (prizePool * dev_fee) / 100n;
        const winnerBasePrize = prizePool - resolverCommission - devCommission;

        // Determinar si el premio base del ganador es suficiente para crear una caja.
        const winnerGetsBasePrize = winnerBasePrize >= SAFE_MIN_BOX_VALUE;

        // Si el premio del ganador es "polvo", las comisiones no se pagan y van al ganador.
        const intermediateDevPayout = winnerGetsBasePrize ? devCommission : 0n;
        const intermediateResolverPayout = winnerGetsBasePrize ? (creatorStake + resolverCommission) : creatorStake;
        const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : (prizePool + creatorStake);

        // Redistribuir pagos intermedios si son "polvo".
        const devForfeits = (intermediateDevPayout > 0n && intermediateDevPayout < SAFE_MIN_BOX_VALUE) ? intermediateDevPayout : 0n;
        const resolverForfeits = (intermediateResolverPayout > 0n && intermediateResolverPayout < SAFE_MIN_BOX_VALUE) ? intermediateResolverPayout : 0n;

        // Asignar los pagos finales. El ganador recibe cualquier cantidad confiscada.
        finalDevPayout = intermediateDevPayout - devForfeits;
        finalResolverPayout = intermediateResolverPayout - resolverForfeits;
        finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits;

        console.log("--- Resumen de Pagos (nanoErgs) ---");
        console.log(`Premio Final Ganador: ${finalWinnerPrize}`);
        console.log(`Pago Final Resolver: ${finalResolverPayout}`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log("------------------------------------");
    }

    // --- 3. Construcción de Salidas ---
    const outputs: OutputBuilder[] = [];
    const gameNft = game.box.assets[0];

    // 3.1. Salida para el Ganador (si existe)
    if (winnerParticipation !== null) {
        const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        // La transacción fallará a nivel de protocolo si finalWinnerPrize < SAFE_MIN_BOX_VALUE,
        // lo cual es el comportamiento deseado.
        outputs.push(
            new OutputBuilder(finalWinnerPrize, winnerAddressString).addTokens([gameNft])
        );
    }

    // 3.2. Salida para el Resolutor (si su pago no es cero)
    if (finalResolverPayout > 0n) {
        const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
        const resolverOutput = new OutputBuilder(finalResolverPayout, resolverAddressString);
        
        // Si no hubo ganador, el resolutor recibe el NFT del juego.
        if (winnerParticipation === null) {
            resolverOutput.addTokens([gameNft]);
        }
        outputs.push(resolverOutput);
    }

    // 3.3. Salida para el Desarrollador (si su pago no es cero)
    if (finalDevPayout > 0n) {
        outputs.push(
            new OutputBuilder(finalDevPayout, dev_addr_base58)
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