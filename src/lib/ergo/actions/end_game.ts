import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { getGopJudgesPaidErgoTreeHex } from '../contract';
import { parseBox, pkHexToBase58Address, hexToBytes } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { calculatePayouts } from '../utils/payout_calculator';
import { GAME_NFT_AMOUNT, GAME_TROPHY_AMOUNT } from '$lib/common/constants';
import { ErgoPlatform } from '../platform';
declare const ergo: any;

export async function end_game(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Participations: ${participations.length}`)
    console.log(`[end_game] Starting game finalization: ${game.boxId}`);

    const currentHeight = await (new ErgoPlatform()).get_current_height();
    const userAddress = await ergo.get_change_address();

    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 3. Signature verification ---
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

    // --- 4. Payout Calculation Logic (Shared) ---
    const {
        finalWinnerPrize,
        finalResolverPayout,
        finalDevPayout,
        finalJudgesPayout
    } = calculatePayouts(game, participations);

    // --- 5. Output Construction ---
    const outputs: OutputBuilder[] = [];

    // The game NFT is always at index 0 of the assets. One unit goes out as the trophy, the other is burned.
    const gameNft = { tokenId: game.box.assets[0].tokenId, amount: GAME_TROPHY_AMOUNT };
    const burnedNft = { tokenId: gameNft.tokenId, amount: GAME_NFT_AMOUNT - GAME_TROPHY_AMOUNT };

    // Helper to build boxes (Handles Token vs ERG)
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
        // If there's no winner, the resolver recovers the NFT
        const resolverOutput = buildOutput(finalResolverPayout, game.resolverScript_Hex, winnerParticipation === null ? [gameNft] : []);
        outputs.push(resolverOutput);
    }

    if (finalDevPayout > 0n) {
        outputs.push(buildOutput(finalDevPayout, game.devScript));
    }

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

    // --- 6. Transaction ---
    const utxos = await ergo.get_utxos();
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([parseBox(game.box), ...participations.map(p => parseBox(p.box))], { ensureInclusion: true })
        .and.from(utxos)
        .to(outputs)
        .burnTokens(burnedNft)
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