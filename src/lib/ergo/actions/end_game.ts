import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { dev_addr_base58, dev_fee } from '../contract';
import { judges } from '$lib/common/store';
import { get } from 'svelte/store';

export async function end_game(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Participaciones: ${participations.length}`)

    console.log(`[end_game] Iniciando finalización del juego: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Verificaciones preliminares ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("El período de resolución aún no ha terminado.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 2. Verificación del Firmante ---
    let requiredSignerAddress: string;

    if (winnerParticipation === null) {
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex);
        console.log(`Caso: Sin ganador. Se requiere la firma del resolutor: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Firma inválida. Solo el resolutor (${requiredSignerAddress}) puede ejecutar esta transacción.`);
        }
    } else {
        requiredSignerAddress = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        console.log(`Caso: Con ganador. Se requiere la firma del ganador: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Firma inválida. Solo el ganador declarado (${requiredSignerAddress}) puede ejecutar esta transacción.`);
        }
    }
    console.log(`Verificación de firmante exitosa. Usuario conectado: ${userAddress}`);

    // --- 3. Lógica de Cálculo de Pagos ---
    const prizePool = BigInt(participations.reduce((acc, p) => acc + BigInt(p.value), 0n)) + BigInt(game.box.value) - game.creatorStakeNanoErg;

    const perJudgePctNumber = game.perJudgeComissionPercentage ?? 0;
    const perJudgePct = BigInt(perJudgePctNumber);

    const judge_count = BigInt((game.judges ?? []).length);

    const perJudgeCommission = (prizePool * perJudgePct) / 100n;
    const totalJudgeCommission = perJudgeCommission * judge_count;

    const judgesForfeits = (perJudgeCommission > 0n && perJudgeCommission < SAFE_MIN_BOX_VALUE) ? totalJudgeCommission : 0n;
    const finalJudgesPayoutTent = totalJudgeCommission - judgesForfeits;

    const devCommission = (prizePool * dev_fee) / 100n;
    const devForfeits = (devCommission > 0n && devCommission < SAFE_MIN_BOX_VALUE) ? devCommission : 0n;
    const finalDevPayoutTent = devCommission - devForfeits;

    let finalWinnerPrize = 0n;
    let finalResolverPayout = 0n;
    let finalDevPayout = 0n;
    let finalJudgesPayout = 0n;
    let finalPerJudge = 0n;

    if (winnerParticipation === null) {
        // --- CASO: NO HAY GANADOR ---
        const totalValue = prizePool + game.creatorStakeNanoErg;

        finalDevPayout = finalDevPayoutTent;
        finalJudgesPayout = finalJudgesPayoutTent;
        finalPerJudge = perJudgeCommission;

        finalResolverPayout = totalValue - finalDevPayout - finalJudgesPayout;

        console.log("--- Resumen de Pagos (Sin Ganador) ---");
        console.log(`Premio total: ${prizePool}`);
        console.log(`Pago Final Resolver: ${finalResolverPayout} (incluye NFT si aplica)`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log(`Pago Total Jueces (a repartir): ${finalJudgesPayout} (forfeits: ${judgesForfeits})`);
        console.log("---------------------------------------");

    } else {
        // --- CASO: SÍ HAY GANADOR ---
        const creatorStake = game.creatorStakeNanoErg;
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;

        const tentativeWinnerPrize = prizePool - resolverCommission - finalJudgesPayoutTent - finalDevPayoutTent;

        const participationFee = game.participationFeeNanoErg

        let adjustedWinnerPrize: bigint;
        let adjustedResolverComm: bigint;
        let adjustedDevPayout: bigint;
        let adjustedJudgesPayout: bigint;
        let adjustedPerJudge: bigint;

        if (tentativeWinnerPrize < participationFee) {
            adjustedWinnerPrize = prizePool;
            adjustedResolverComm = 0n;
            adjustedDevPayout = 0n;
            adjustedJudgesPayout = 0n;
            adjustedPerJudge = 0n;
        } else {
            adjustedWinnerPrize = tentativeWinnerPrize;
            adjustedResolverComm = resolverCommission;
            adjustedDevPayout = finalDevPayoutTent;
            adjustedJudgesPayout = finalJudgesPayoutTent;
            adjustedPerJudge = perJudgeCommission;
        }

        finalResolverPayout = creatorStake + adjustedResolverComm;
        finalWinnerPrize = adjustedWinnerPrize;
        finalDevPayout = adjustedDevPayout;
        finalJudgesPayout = adjustedJudgesPayout;
        finalPerJudge = adjustedPerJudge;

        console.log("--- Resumen de Pagos (Con Ganador) ---");
        console.log(`Premio total: ${prizePool}`);
        console.log(`Premio Final Ganador: ${finalWinnerPrize}`);
        console.log(`Pago Final Resolver: ${finalResolverPayout}`);
        console.log(`Pago Final Dev: ${finalDevPayout}`);
        console.log(`Pago Total Jueces (a repartir): ${finalJudgesPayout} (forfeits: ${judgesForfeits})`);
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

    const dataInputs: any[] = [];
    if (finalPerJudge >= SAFE_MIN_BOX_VALUE && (game.judges ?? []).length > 0) {
        for (const tokenId of game.judges) {
            const js = get(judges).data.get(tokenId)
            if (!js) {
                console.warn(`[end_game] No se encontró información de juez para token ${tokenId}, se omite.`);
                throw new Error(`No se encontró información de juez para token ${tokenId}`);
            }
            const judgeErgoTree = js.owner_ergotree;
            const judgeDatabox = js.current_boxes && js.current_boxes[0];

            if (!judgeErgoTree) {
                console.warn(`[end_game] judgeErgoTree vacío para token ${tokenId}, se omite.`);
                throw new Error(`judgeErgoTree vacío para token ${tokenId}`);
            }

            // Añadir output por juez con la comisión por juez
            outputs.push(
                new OutputBuilder(finalPerJudge, judgeErgoTree)
            );

            // Si hay datainput, lo parseamos y lo añadimos a datainputs
            if (judgeDatabox) {
                dataInputs.push(parseBox(judgeDatabox.box));
            }
            else {
                throw new Error('[end_game] JudgeDatabox vacío')
            }
        }
    } else {
        console.log("[end_game] No se crean salidas para jueces (comisión por juez es 0 o polvo o no hay jueces).");
    }

    // --- 5. Construcción y Envío de la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box))];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([...inputs, ...utxos])
        .to(outputs)
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress) // El cambio va al firmante autorizado
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    console.log("Transacción EIP-12 sin firmar generada.");

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`¡Éxito! Transacción de finalización enviada. ID: ${txId}`);
        return txId;
    } 
    catch (error) {
        console.error("Error al firmar o enviar la transacción:", error);
        throw error;
    }
}
