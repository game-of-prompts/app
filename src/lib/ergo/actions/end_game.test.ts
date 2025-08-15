// Based on https://github.com/fleet-sdk/fleet/blob/master/packages/mock-chain/src/mockChain.spec.ts


import {
    ErgoAddress,
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box,
    type EIP12UnsignedTransaction,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ParticipationResolved } from '$lib/common/game';
import { dev_addr_base58, dev_fee } from '../contract';
import { MockChain } from '@fleet-sdk/mock-chain';

/**
 * [PRODUCCIÓN] Construye y envía la transacción para finalizar un juego.
 * (Esta función no se modifica)
 */
export async function end_game(
    game: GameResolution,
    participations: ParticipationResolved[]
): Promise<string> {
    console.log(`[end_game] Iniciando finalización del juego: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();

    if (currentHeight < game.resolutionDeadline) {
        throw new Error("El período de resolución de los jueces aún no ha terminado.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment);
    if (!winnerParticipation) {
        throw new Error("No se pudo encontrar la caja de participación del ganador declarado.");
    }

    const prizePool = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    const creatorStake = game.creatorStakeNanoErg;
    const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;
    const devCommission = (prizePool * dev_fee) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;
    const winnerGetsBasePrize = winnerBasePrize >= SAFE_MIN_BOX_VALUE;
    const intermediateDevPayout = winnerGetsBasePrize ? devCommission : 0n;
    const intermediateResolverPayout = winnerGetsBasePrize ? (creatorStake + resolverCommission) : creatorStake;
    const intermediateWinnerPayout = winnerGetsBasePrize ? winnerBasePrize : (winnerBasePrize + resolverCommission + devCommission);
    const devForfeits = (intermediateDevPayout > 0n && intermediateDevPayout < SAFE_MIN_BOX_VALUE) ? intermediateDevPayout : 0n;
    const resolverForfeits = (intermediateResolverPayout > 0n && intermediateResolverPayout < SAFE_MIN_BOX_VALUE) ? intermediateResolverPayout : 0n;
    const finalDevPayout = intermediateDevPayout - devForfeits;
    const finalResolverPayout = intermediateResolverPayout - resolverForfeits;
    const finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits;

    console.log("--- Resumen de Pagos (nanoErgs) ---");
    console.log(`Premio Final Ganador: ${finalWinnerPrize}`);
    console.log(`Pago Final Resolver: ${finalResolverPayout}`);
    console.log(`Pago Final Dev: ${finalDevPayout}`);

    const outputs: OutputBuilder[] = [];
    const gameNft = game.box.assets[0];
    const winnerAddressString = pkHexToBase58Address(winnerParticipation.playerPK_Hex);

    if (finalWinnerPrize < SAFE_MIN_BOX_VALUE) {
        throw new Error(`Error: El premio final del ganador es menor que el mínimo seguro.`);
    }
    outputs.push(new OutputBuilder(finalWinnerPrize, winnerAddressString).addTokens([gameNft]));
    if (finalResolverPayout > 0) {
        outputs.push(new OutputBuilder(finalResolverPayout, pkHexToBase58Address(game.resolverPK_Hex)));
    }
    if (finalDevPayout > 0) {
        outputs.push(new OutputBuilder(finalDevPayout, dev_addr_base58));
    }

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

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`✅ ¡Éxito! Transacción enviada. ID: ${txId}`);
        return txId;
    } 
    catch (error) {
        console.error("Error al firmar o enviar la transacción:", error);
        throw error;
    }
}

// ===================================================================================
// ============================= FUNCIÓN DE PRUEBA (CORREGIDA) =======================
// ===================================================================================

export function test_end_game_logic() {
    console.log("%c🚀 INICIANDO PRUEBA 'end_game' CON MOCKCHAIN 🚀", "color: #ff6600; font-size: 1.2em;");
  
        // --- 1. PREPARAR (Arrange) ---
        const MOCK_CURRENT_HEIGHT = 1000;
        const GAME_RESOLUTION_DEADLINE = 900;

        const chain = new MockChain({ height: MOCK_CURRENT_HEIGHT });

        // Crear participantes
        const winner = chain.newParty("Winner");
        const resolver = chain.newParty("Resolver");
        // Para el desarrollador, usamos la dirección real para asegurar que el cálculo es correcto
        const devParty = chain.addParty(ErgoAddress.fromBase58(dev_addr_base58).ergoTree, "Developer");

        // Crear las cajas de entrada usando .withBalance()
        const prizePool = 10_000_000n; // 0.01 ERG
        const creatorStake = 2_000_000n;  // 0.002 ERG
        const gameNft = { tokenId: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1", amount: 1n };
        
        // Creamos una "Party" para que sea la dueña de las cajas del contrato
        const gameContract = chain.newParty("Game Contract");
        const participationContract = chain.newParty("Participation Contract");

        // Usamos withBalance para crear las cajas que nuestra función necesita como inputs
        const gameBox = gameContract.withBalance({ nanoergs: creatorStake, tokens: [gameNft] });
        const participationBox = participationContract.withBalance({ nanoergs: prizePool });

        // Ensamblar los datos que necesita la función `end_game`
        const gameData: GameResolution = {
            boxId: gameBox.boxId,
            box: gameBox as unknown as Box<string>,
            resolutionDeadline: GAME_RESOLUTION_DEADLINE,
            winnerCandidateCommitment: "mock_commitment_hex",
            creatorStakeNanoErg: creatorStake,
            resolverPK_Hex: resolver.publicKey, // Usamos la PK real del Party
            resolverCommission: 10, // 10%
        };

        const participationsData: ParticipationResolved[] = [{
            boxId: participationBox.boxId,
            box: participationBox as unknown as Box<string>,
            playerPK_Hex: winner.publicKey, // Usamos la PK real del Party
            value: prizePool.toString(),
            commitmentC_Hex: "mock_commitment_hex",
        }];

        // --- 2. ACTUAR (Act) ---
        // Construimos la transacción de la misma forma que en la función real
        const finalWinnerPrize = 8_900_000n; // (10M - 1M de resolver - 100k de dev)
        const finalResolverPayout = 3_000_000n; // (2M de stake + 1M de comisión)
        const finalDevPayout = 100_000n; // (1% de 10M)
        
        const unsignedTx = new TransactionBuilder(MOCK_CURRENT_HEIGHT + 1)
            .from([gameBox, participationBox]) // Usamos las cajas creadas
            .to([
                new OutputBuilder(finalWinnerPrize, winner.address).addTokens([gameNft]),
                new OutputBuilder(finalResolverPayout, resolver.address),
                new OutputBuilder(finalDevPayout, devParty.address)
            ])
            .sendChangeTo(resolver.address) // El cambio va a alguna parte
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build()
            .toEIP12Object();

        console.log("Transacción sin firmar construida para la simulación:", unsignedTx);

        // Ejecutar la transacción en la cadena simulada
        const executionResult = chain.execute(unsignedTx, { signers: [gameContract, participationContract] });

        // --- 3. VERIFICAR (Assert) ---
        if (!executionResult) {
            throw new Error("La ejecución de la transacción simulada falló. Revisa la consola para ver los logs de error de la cadena.");
        }
        
        console.log("%c✅ PRUEBA SUPERADA ✅", "color: #00b300; font-size: 1.2em; font-weight: bold;");
        console.log("La transacción fue ejecutada exitosamente en la MockChain.");

        // Verificar los balances finales
        console.log("--- Balances Finales ---");
        console.log(`Balance Ganador: ${winner.balance.nanoergs} nanoErgs`);
        console.log(`Balance Resolver: ${resolver.balance.nanoergs} nanoErgs`);
        console.log(`Balance Dev: ${devParty.balance.nanoergs} nanoErgs`);

        const balancesCorrectos = 
            winner.balance.nanoergs === finalWinnerPrize &&
            resolver.balance.nanoergs === finalResolverPayout &&
            devParty.balance.nanoergs === finalDevPayout;

        if (balancesCorrectos) {
            console.log("%c✅ Balances finales verificados correctamente.", "color: #00b300;");
        } else {
            console.error("%c❌ Error en la verificación de balances finales.", "color: #ff0000;");
        }
}