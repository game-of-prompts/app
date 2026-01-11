import { type GameResolution, type ValidParticipation } from '$lib/common/game';

export interface PayoutResult {
    finalWinnerPrize: bigint;
    finalResolverPayout: bigint;
    finalDevPayout: bigint;
    finalJudgesPayout: bigint;
    finalPerJudge: bigint;
    winnerParticipation: ValidParticipation | null;
}

export function calculatePayouts(
    game: GameResolution,
    participations: ValidParticipation[]
): PayoutResult {
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

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

    const perJudgeCommission = (prizePool * perJudgePct) / BigInt(game.constants.COMMISSION_DENOMINATOR);
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
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / BigInt(game.constants.COMMISSION_DENOMINATOR);

        // Premio tentativo restando comisiones
        const tentativeWinnerPrize = prizePool - resolverCommission - totalJudgeCommission - devCommission;
        const participationFee = game.participationFeeAmount;

        console.log("--- WINNER SCENARIO DEBUG ---");
        console.log(`Participation Fee (Entry Cost): ${participationFee}`);
        console.log(`Prize Pool: ${prizePool}`);
        console.log(`Tentative Winner Prize (After Comms): ${tentativeWinnerPrize}`);
        console.log(`Resolver Commission Tentative: ${resolverCommission}`);
        console.log(`Total Judge Commission Tentative: ${totalJudgeCommission}`);
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

    return {
        finalWinnerPrize,
        finalResolverPayout,
        finalDevPayout,
        finalJudgesPayout,
        finalPerJudge,
        winnerParticipation
    };
}
