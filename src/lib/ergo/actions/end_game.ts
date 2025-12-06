import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { judges } from '$lib/common/store';
import { get } from 'svelte/store';

export async function end_game(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Participations: ${participations.length}`)

    console.log(`[end_game] Starting game finalization: ${game.boxId}`);
    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();
    
    // --- NUEVO: Detectar si es juego de tokens ---
    const isTokenGame = !!game.participationTokenId; 

    // --- 1. Preliminary checks ---
    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }
    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 2. Signer verification ---
    let requiredSignerAddress: string;

    if (winnerParticipation === null) {
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex);
        console.log(`Case: No winner. Resolver signature required: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Only the resolver (${requiredSignerAddress}) can execute this transaction.`);
        }
    } else {
        requiredSignerAddress = pkHexToBase58Address(winnerParticipation.playerPK_Hex);
        console.log(`Case: With winner. Winner signature required: ${requiredSignerAddress}`);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Only the declared winner (${requiredSignerAddress}) can execute this transaction.`);
        }
    }
    console.log(`Signer verification successful. Connected user: ${userAddress}`);

    // --- 3. Payment Calculation Logic ---
    const prizePool = BigInt(participations.reduce((acc, p) => acc + BigInt(p.value), 0n)) + game.value - game.creatorStakeAmount;

    const perJudgePctNumber = game.perJudgeComissionPercentage ?? 0;
    const perJudgePct = BigInt(perJudgePctNumber);

    const judge_count = BigInt((game.judges ?? []).length);

    const perJudgeCommission = (prizePool * perJudgePct) / 100n;
    const totalJudgeCommission = perJudgeCommission * judge_count;

    const dustLimit = isTokenGame ? 0n : SAFE_MIN_BOX_VALUE;

    const judgesForfeits = (perJudgeCommission > 0n && perJudgeCommission < dustLimit) ? totalJudgeCommission : 0n;
    const finalJudgesPayoutTent = totalJudgeCommission - judgesForfeits;

    const devCommission = (prizePool * BigInt(game.constants.DEV_COMMISSION_PERCENTAGE)) / 100n;
    const devForfeits = (devCommission > 0n && devCommission < dustLimit) ? devCommission : 0n;
    const finalDevPayoutTent = devCommission - devForfeits;

    let finalWinnerPrize = 0n;
    let finalResolverPayout = 0n;
    let finalDevPayout = 0n;
    let finalJudgesPayout = 0n;
    let finalPerJudge = 0n;

    if (winnerParticipation === null) {
        // --- CASE: NO WINNER ---
        const totalValue = prizePool + game.creatorStakeAmount;

        finalDevPayout = finalDevPayoutTent;
        finalJudgesPayout = finalJudgesPayoutTent;
        finalPerJudge = perJudgeCommission;

        finalResolverPayout = totalValue - finalDevPayout - finalJudgesPayout;

        console.log("--- Payment Summary (No Winner) ---");
        console.log(`Total prize: ${prizePool}`);
        console.log(`Final Resolver Payment: ${finalResolverPayout} (includes NFT if applicable)`);
        console.log(`Final Dev Payment: ${finalDevPayout}`);
        console.log(`Total Judges Payment (to distribute): ${finalJudgesPayout} (forfeits: ${judgesForfeits})`);
        console.log("---------------------------------------");

    } else {
        // --- CASE: THERE IS A WINNER ---
        const creatorStake = game.creatorStakeAmount;
        const resolverCommission = (prizePool * BigInt(game.resolverCommission)) / 100n;

        const tentativeWinnerPrize = prizePool - resolverCommission - finalJudgesPayoutTent - finalDevPayoutTent;

        const participationFee = game.participationFeeAmount

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

        console.log("--- Payment Summary (With Winner) ---");
        console.log(`Total prize: ${prizePool}`);
        console.log(`Final Winner Prize: ${finalWinnerPrize}`);
        console.log(`Final Resolver Payment: ${finalResolverPayout}`);
        console.log(`Final Dev Payment: ${finalDevPayout}`);
        console.log(`Total Judges Payment (to distribute): ${finalJudgesPayout} (forfeits: ${judgesForfeits})`);
        console.log("------------------------------------");
    }

    // --- 4. Output Construction ---
    const outputs: OutputBuilder[] = [];
    const gameNft = game.box.assets[0];
    
    const buildOutput = (amount: bigint, script: string) => {
        if (isTokenGame) {
            return new OutputBuilder(SAFE_MIN_BOX_VALUE, script)
                .addTokens({ tokenId: game.participationTokenId!, amount: amount });
        } else {
            return new OutputBuilder(amount, script);
        }
    };

    if (winnerParticipation !== null && finalWinnerPrize > 0n) {
        outputs.push(
            buildOutput(finalWinnerPrize, winnerParticipation.playerScript_Hex).addTokens([gameNft])
        );
    }

    if (finalResolverPayout > 0n) {
        const resolverOutput = buildOutput(finalResolverPayout, game.resolverScript_Hex);
        
        if (winnerParticipation === null) {
            resolverOutput.addTokens([gameNft]);
        }
        outputs.push(resolverOutput);
    }

    if (finalDevPayout > 0n) {
        outputs.push(
            buildOutput(finalDevPayout, game.constants.DEV_SCRIPT)
        );
    }

    const dataInputs: any[] = [];
    if (finalPerJudge > dustLimit && (game.judges ?? []).length > 0) {
        for (const tokenId of game.judges) {
            const js = get(judges).data.get(tokenId)
            if (!js) {
                console.warn(`[end_game] No judge information found for token ${tokenId}, skipping.`);
                throw new Error(`No judge information found for token ${tokenId}`);
            }
            const judgeErgoTree = js.owner_ergotree;
            const judgeDatabox = js.current_boxes && js.current_boxes[0];

            if (!judgeErgoTree) {
                console.warn(`[end_game] Empty judgeErgoTree for token ${tokenId}, skipping.`);
                throw new Error(`Empty judgeErgoTree for token ${tokenId}`);
            }

            outputs.push(
                buildOutput(finalPerJudge, judgeErgoTree)
            );

            if (judgeDatabox) {
                dataInputs.push(parseBox(judgeDatabox.box));
            }
            else {
                throw new Error('[end_game] Empty JudgeDatabox')
            }
        }
    } else {
        console.log("[end_game] No outputs created for judges.");
    }

    // --- 5. Transaction Construction and Submission ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box))];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([...inputs, ...utxos])
        .to(outputs)
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress) 
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    console.log("Unsigned EIP-12 transaction generated.");

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Success! Finalization transaction sent. ID: ${txId}`);
        return txId;
    } 
    catch (error) {
        console.error("Error signing or sending transaction:", error);
        throw error;
    }
}