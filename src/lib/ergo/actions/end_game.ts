import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { dev_addr_base58, dev_fee } from '../contract';

/**
 * Construye y envía la transacción para finalizar un juego.
 * Valida que el firmante es la parte autorizada (ganador o resolutor).
 * Los pagos que no alcanzan el mínimo (polvo) se redirigen al beneficiario principal.
 * @param game El objeto que representa la caja del juego a finalizar.
 * @param participations Un array con las cajas de participación resueltas.
 * @returns El ID de la transacción enviada.
 */
export async function end_game(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Iniciando finalización del juego: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Verificaciones preliminares ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("El período de resolución aún no ha terminado.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 2. Verificación del Firmante ---
    // Esta lógica se basa en los tests: solo el ganador o el resolutor pueden firmar.
    let requiredSignerAddress: string;

    if (winnerParticipation === null) {
        // Si no hay ganador, solo el RESOLUTOR puede firmar.
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex);
        console.log(`Caso: Sin ganador. Se requiere la firma del resolutor: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Firma inválida. Solo el resolutor (${requiredSignerAddress}) puede ejecutar esta transacción.`);
        }
    } else {
        // Si hay un ganador, solo el GANADOR puede firmar.
        requiredSignerAddress = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        console.log(`Caso: Con ganador. Se requiere la firma del ganador: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Firma inválida. Solo el ganador declarado (${requiredSignerAddress}) puede ejecutar esta transacción.`);
        }
    }
    console.log(`Verificación de firmante exitosa. Usuario conectado: ${userAddress}`);

    // --- 3. Lógica de Cálculo de Pagos ---
    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);

    let finalWinnerPrize = 0n;
    let finalResolverPayout = 0n;
    let finalDevPayout = 0n;

    if (winnerParticipation === null) {
        // --- CASO: NO HAY GANADOR ---
        const totalValue = prizePool + game.creatorStakeNanoErg;
        const devCommission = (prizePool * dev_fee) / 100n;
        const devForfeits = (devCommission > 0n && devCommission < SAFE_MIN_BOX_VALUE) ? devCommission : 0n;
        
        finalDevPayout = devCommission - devForfeits;
        finalResolverPayout = totalValue - finalDevPayout;

        console.log("--- Resumen de Pagos (Sin Ganador) ---");
        console.log(`Pago Final Resolver: ${finalResolverPayout} (incluye NFT)`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log("---------------------------------------");

    } else {
        // --- CASO: SÍ HAY GANADOR ---
        const creatorStake = game.creatorStakeNanoErg;
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;
        const devCommission = (prizePool * dev_fee) / 100n;
        const winnerBasePrize = prizePool - resolverCommission - devCommission;

        const winnerGetsBasePrize = winnerBasePrize >= SAFE_MIN_BOX_VALUE;

        const intermediateDevPayout = winnerGetsBasePrize ? devCommission : 0n;
        const intermediateResolverPayout = winnerGetsBasePrize ? (creatorStake + resolverCommission) : creatorStake;
        const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : (prizePool + creatorStake);

        const devForfeits = (intermediateDevPayout > 0n && intermediateDevPayout < SAFE_MIN_BOX_VALUE) ? intermediateDevPayout : 0n;
        const resolverForfeits = (intermediateResolverPayout > 0n && intermediateResolverPayout < SAFE_MIN_BOX_VALUE) ? intermediateResolverPayout : 0n;

        finalDevPayout = intermediateDevPayout - devForfeits;
        finalResolverPayout = intermediateResolverPayout - resolverForfeits;
        finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits;

        console.log("--- Resumen de Pagos (nanoErgs) ---");
        console.log(`Premio Final Ganador: ${finalWinnerPrize}`);
        console.log(`Pago Final Resolver: ${finalResolverPayout}`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log("------------------------------------");
    }

    // --- 4. Construcción de Salidas ---
    const outputs: OutputBuilder[] = [];
    const gameNft = game.box.assets[0];

    if (winnerParticipation !== null && finalWinnerPrize > 0n) {
        const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        outputs.push(
            new OutputBuilder(finalWinnerPrize, winnerAddressString).addTokens([gameNft])
        );
    }

    if (finalResolverPayout > 0n) {
        const resolverAddressString = pkHexToBase58Address(game.resolverPK_Hex);
        const resolverOutput = new OutputBuilder(finalResolverPayout, resolverAddressString);
        
        if (winnerParticipation === null) {
            resolverOutput.addTokens([gameNft]);
        }
        outputs.push(resolverOutput);
    }

    if (finalDevPayout > 0n) {
        outputs.push(
            new OutputBuilder(finalDevPayout, dev_addr_base58)
        );
    }

    // --- 5. Construcción y Envío de la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box))];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([...inputs, ...utxos])
        .to(outputs)
        .sendChangeTo(userAddress) // El cambio va al firmante autorizado
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
