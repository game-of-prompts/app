import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { getGopJudgesPaidErgoTreeHex } from '../contract';
import { parseBox, pkHexToBase58Address, hexToBytes } from '$lib/ergo/utils';
import { type GameEndGame, type ValidParticipation } from '$lib/common/game';
import { judges } from '$lib/common/store';
import { get } from 'svelte/store';
declare const ergo: any;

export async function end_game(
    game: GameEndGame,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Participations: ${participations.length}`)
    console.log(`[end_game] Starting game finalization: ${game.boxId}`);

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    // --- 1. Detectar tipo de juego ---
    const isTokenGame = true;

    // --- 2. Validaciones Previas ---
    // --- 2. Validaciones Previas ---
    // En EndGame, ya estamos después del resolutionDeadline (o en él), pero el script end_game.es
    // tiene un periodo de gracia para la autorización (END_GAME_AUTH_GRACE_PERIOD).
    // Sin embargo, la lógica de "resolution period has not yet ended" ya no aplica igual
    // porque ya estamos en el script de fin de juego.
    // El script end_game.es permite gastar inmediatamente si se cumplen las condiciones de firma.

    // if (currentHeight < game.resolutionDeadline) {
    //    throw new Error("The resolution period has not yet ended.");
    // }
    // Comentamos esto porque al estar en EndGame, ya pasamos la deadline de resolución (implícitamente,
    // porque game_resolution.es solo permite pasar a EndGame después de resolutionDeadline).
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 3. Verificación de firma ---
    let requiredSignerAddress: string;

    if (winnerParticipation === null) {
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex || undefined);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Resolver (${requiredSignerAddress}) required.`);
        }
    } else {
        requiredSignerAddress = pkHexToBase58Address(winnerParticipation.playerPK_Hex || undefined);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Winner (${requiredSignerAddress}) required.`);
        }
    }

    // --- 4. Lógica de Cálculo de Pagos ---

    // A. Balance del Contrato (Token o ERG)
    const asset = game.box.assets.find(a => a.tokenId == game.participationTokenId);
    const contractBalance = asset ? BigInt(asset.amount) : 0n;

    // B. Cálculo del Prize Pool
    const totalParticipations = participations.reduce((acc, p) => acc + BigInt(p.value), 0n);
    // prizePool = Lo que pusieron los jugadores + Lo que había en el contrato - Lo que puso el creador (Stake)
    const prizePool = totalParticipations + contractBalance - game.creatorStakeAmount;

    console.log("--- DEBUG CALCULATION START ---");
    console.log(`Total Participations: ${totalParticipations}`);
    console.log(`Contract Balance: ${contractBalance}`);
    console.log(`Creator Stake: ${game.creatorStakeAmount}`);
    console.log(`Calculated Prize Pool: ${prizePool}`);

    // C. Comisiones Base
    const perJudgePctNumber = game.perJudgeComissionPercentage ?? 0;
    const perJudgePct = BigInt(perJudgePctNumber);
    const judge_count = BigInt((game.judges ?? []).length);

    const perJudgeCommission = (prizePool * perJudgePct) / 100n;
    const totalJudgeCommission = perJudgeCommission * judge_count;

    // Comisiones Dev
    const devCommission = (prizePool * BigInt(game.constants.DEV_COMMISSION_PERCENTAGE)) / 100n;

    let finalWinnerPrize = 0n;
    let finalResolverPayout = 0n;
    let finalDevPayout = 0n;
    let finalJudgesPayout = 0n;
    let finalPerJudge = 0n;

    if (winnerParticipation === null) {
        // --- CASO: NO HAY GANADOR ---
        const totalValue = prizePool + game.creatorStakeAmount;

        finalDevPayout = devCommission;
        finalJudgesPayout = totalJudgeCommission;
        finalPerJudge = perJudgeCommission;
        finalResolverPayout = totalValue - finalDevPayout - finalJudgesPayout;

    } else {
        // --- CASO: HAY GANADOR ---
        const creatorStake = game.creatorStakeAmount;
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;

        // Premio tentativo restando comisiones
        const tentativeWinnerPrize = prizePool - resolverCommission - totalJudgeCommission - devCommission;
        const participationFee = game.participationFeeAmount;

        console.log("--- WINNER SCENARIO DEBUG ---");
        console.log(`Participation Fee (Entry Cost): ${participationFee}`);
        console.log(`Tentative Winner Prize (After Comms): ${tentativeWinnerPrize}`);
        console.log(`Resolver Commission Tentative: ${resolverCommission}`);
        console.log(`Dev Commission Tentative: ${devCommission}`);

        let adjustedWinnerPrize: bigint;
        let adjustedResolverComm: bigint;
        let adjustedDevPayout: bigint;
        let adjustedJudgesPayout: bigint;
        let adjustedPerJudge: bigint;

        // --- LÓGICA DE PROTECCIÓN AL GANADOR ---
        if (tentativeWinnerPrize < participationFee) {
            console.warn("!!! WINNER PROTECTION TRIGGERED !!!");
            console.warn(`Reason: Tentative Prize (${tentativeWinnerPrize}) < Fee (${participationFee})`);
            console.warn("Action: Setting ALL commissions to 0. Winner gets full Prize Pool.");

            adjustedWinnerPrize = prizePool;
            adjustedResolverComm = 0n;
            adjustedDevPayout = 0n;
            adjustedJudgesPayout = 0n;
            adjustedPerJudge = 0n;
        } else {
            console.log("Normal payout: Prize covers fee.");
            adjustedWinnerPrize = tentativeWinnerPrize;
            adjustedResolverComm = resolverCommission;
            adjustedDevPayout = devCommission;
            adjustedJudgesPayout = totalJudgeCommission;
            adjustedPerJudge = perJudgeCommission;
        }

        finalResolverPayout = creatorStake + adjustedResolverComm;
        finalWinnerPrize = adjustedWinnerPrize;
        finalDevPayout = adjustedDevPayout;
        finalJudgesPayout = adjustedJudgesPayout;
        finalPerJudge = adjustedPerJudge;
    }

    console.log("--- FINAL PAYOUTS ---");
    console.log(`Final Winner: ${finalWinnerPrize}`);
    console.log(`Final Resolver: ${finalResolverPayout} (Stake: ${game.creatorStakeAmount} + Comm: ${finalResolverPayout - game.creatorStakeAmount})`);
    console.log(`Final Dev: ${finalDevPayout}`);
    console.log("---------------------");

    // --- 5. Construcción de Outputs ---
    const outputs: OutputBuilder[] = [];

    // El NFT del juego siempre se encuentra en el indice 0 de los assets
    const gameNft = game.box.assets[0];

    // Helper para construir cajas (Maneja Token vs ERG)
    const buildOutput = (amount: bigint, script: string, other_tokens: any[] = []) => {
        // Token Game: Min ERG + Tokens
        return new OutputBuilder(SAFE_MIN_BOX_VALUE, script)
            .addTokens([...other_tokens, { tokenId: game.participationTokenId!, amount: amount }]);
    };

    if (winnerParticipation !== null && finalWinnerPrize > 0n) {
        const out = buildOutput(finalWinnerPrize, winnerParticipation.playerScript_Hex, [gameNft]);
        outputs.push(out);
    }

    if (finalResolverPayout > 0n) {
        // Si no hay ganador, el resolver recupera el NFT
        const resolverOutput = buildOutput(finalResolverPayout, game.resolverScript_Hex, winnerParticipation === null ? [gameNft] : []);
        outputs.push(resolverOutput);
    }

    if (finalDevPayout > 0n) {
        outputs.push(buildOutput(finalDevPayout, game.constants.DEV_SCRIPT));
    }

    const dataInputs: any[] = [];
    if (finalJudgesPayout > 0n && (game.judges ?? []).length > 0) {
        const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();

        const judgesTokenIdsBytes = game.judges.map(hexToBytes).filter(b => b !== null) as Uint8Array[];
        const tokenBytes = hexToBytes(game.participationTokenId) || new Uint8Array(0);

        const judgesPaidOutput = buildOutput(finalJudgesPayout, judgesPaidErgoTree)
            .setAdditionalRegisters({
                R4: SColl(SColl(SByte), judgesTokenIdsBytes).toHex(),
                R5: SColl(SByte, tokenBytes).toHex()
            });

        outputs.push(judgesPaidOutput);
    }

    // --- 6. Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box)), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(outputs)
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`Success! Tx ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.error("Tx Error:", error);
        throw error;
    }
}