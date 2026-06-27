/**
 * Game of Prompts write surface for the headless Node signer path.
 *
 * HONEST SCOPE — two classes of writes:
 *
 * 1. WIRED (reputation opinions). The browser app emits these through the
 *    reputation library; here each goes through `create_opinion_with_signer` /
 *    `create_profile_with_signer` from `reputation-system/node` with the
 *    env-configured Signer (lib.mjs). They serve seed AND unsigned modes from
 *    one codebase:
 *      createReputationProfile  → create_profile (mint a JUDGE/profile rep box)
 *      createOpinion            → generic opinion (the building block)
 *      submitCreatorOpinion     → opinion(GAME, R5=gameId, +, locked)        [platform.ts:submitCreatorOpinion]
 *      judgeInvalidateVote      → opinion(PARTICIPATION, R5=commitment, −, locked)         [platform.ts:judgesInvalidateVote]
 *      judgeInvalidateUnavailableVote → opinion(PARTICIPATION_UNAVAILABLE, R5=commitment, −)  [platform.ts:judgesInvalidateUnavailableVote]
 *
 * 2. BROWSER-ONLY (not wired here). The core game-lifecycle txs in
 *    `src/lib/ergo/actions/*` (create_game, resolve_game, submit_score,
 *    participation/batch, cancel, end_game, distribute payout, claim/reclaim,
 *    contribute-to-ceremony, judges-invalidate EXECUTE) are multi-box / chained
 *    transaction builders that read UTXOs, change address and height through the
 *    injected `ergo` connector and assemble several custom outputs. They cannot
 *    be faithfully reduced to a single `*_with_signer` call, so they are NOT
 *    ported. Two adjacent reputation writes are also browser-only:
 *      - acceptJudgeNomination — packs a CUSTOM R9 = Coll[Coll[Byte]] =
 *        [commitment, preimage]; `create_opinion_with_signer` only writes
 *        R9 = Coll[Byte] from a flat content string, so the structure can't be
 *        expressed through it.
 *      - publishSolverId — builds a plain FALSE-contract box (R4=solverId), not
 *        a reputation opinion; it has no `*_with_signer` builder.
 *    `BROWSER_ONLY_ACTIONS` documents them; `tools.mjs` exposes a single
 *    `list_browser_only_actions` info tool rather than fake stubs.
 */
import {
  create_opinion_with_signer,
  create_profile_with_signer
} from 'reputation-system/node';

import {
  GAME_TYPE_NFT_ID,
  PARTICIPATION_TYPE_NFT_ID,
  PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID,
  JUDGE_TYPE_NFT_ID,
  REPUTATION_PROOF_TOTAL_SUPPLY
} from './core.mjs';

import { EXPLORER_API, makeSigner, fetchMainBox, describeResult } from './lib.mjs';

/**
 * Mint a reputation PROFILE box — the author identity that holds reputation
 * tokens (a judge identity by default). Mirrors create_profile in the library.
 */
export async function createReputationProfile(content = { name: 'Anon' }, typeNftId = JUDGE_TYPE_NFT_ID) {
  const signer = makeSigner();
  const result = await create_profile_with_signer(
    signer,
    EXPLORER_API,
    REPUTATION_PROOF_TOTAL_SUPPLY,
    typeNftId,
    content,
    0n
  );
  return describeResult(result);
}

/**
 * Generic reputation opinion (the building block behind every wired write).
 * Spends from the author PROFILE box `mainBoxId`.
 */
export async function createOpinion(mainBoxId, typeNftId, objectPointer, polarization, content = null, isLocked = false) {
  const signer = makeSigner();
  const main_box = await fetchMainBox(mainBoxId);
  const result = await create_opinion_with_signer(
    signer,
    EXPLORER_API,
    1,
    typeNftId,
    objectPointer,
    Boolean(polarization),
    content,
    Boolean(isLocked),
    main_box
  );
  return describeResult(result);
}

/**
 * Creator endorsement of a game — positive, locked opinion against the GAME
 * Type NFT (R5=gameId). Port of platform.ts:submitCreatorOpinion (the create
 * branch of createOrUpdateOpinion).
 */
export async function submitCreatorOpinion(mainBoxId, gameId) {
  return createOpinion(mainBoxId, GAME_TYPE_NFT_ID, gameId, true, null, true);
}

/**
 * Judge vote to invalidate a participation — negative, locked opinion against
 * the PARTICIPATION Type NFT (R5=commitmentC_Hex). Port of
 * platform.ts:judgesInvalidateVote (the opinion half; the EXECUTE half that
 * spends the participation box is browser-only).
 */
export async function judgeInvalidateVote(mainBoxId, commitmentCHex) {
  return createOpinion(mainBoxId, PARTICIPATION_TYPE_NFT_ID, commitmentCHex, false, null, true);
}

/**
 * Judge vote marking a participation unavailable — negative, unlocked opinion
 * against the PARTICIPATION_UNAVAILABLE Type NFT (R5=commitmentC_Hex). Port of
 * platform.ts:judgesInvalidateUnavailableVote (the opinion half).
 */
export async function judgeInvalidateUnavailableVote(mainBoxId, commitmentCHex) {
  return createOpinion(mainBoxId, PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID, commitmentCHex, false, null, false);
}

/** Documented browser-only actions (see module header for why each is excluded). */
export const BROWSER_ONLY_ACTIONS = [
  { action: 'create_game', file: 'src/lib/ergo/actions/create_game.ts', reason: 'Multi-output mint+game-box tx via the ergo connector; not a single *_with_signer call.' },
  { action: 'resolve_game', file: 'src/lib/ergo/actions/resolve_game.ts', reason: 'Game-state transition tx spending the active box; ergo-connector multi-box builder.' },
  { action: 'submit_score', file: 'src/lib/ergo/actions/submit_score.ts', reason: 'Participation tx with custom registers + fee token; ergo-connector builder.' },
  { action: 'batch_participations', file: 'src/lib/ergo/actions/batch_participations.ts', reason: 'Chained multi-box batching tx; ergo-connector builder.' },
  { action: 'include_omitted_participation', file: 'src/lib/ergo/actions/include_omitted_participation.ts', reason: 'Resolution-box respend with reordered participations; ergo-connector builder.' },
  { action: 'cancel_game', file: 'src/lib/ergo/actions/cancel_game.ts', reason: 'Cancellation-state transition tx; ergo-connector builder.' },
  { action: 'end_game', file: 'src/lib/ergo/actions/end_game.ts', reason: 'Finalization/payout tx with judges-paid outputs; ergo-connector builder.' },
  { action: 'distribute_judges_payout', file: 'src/lib/ergo/actions/distribute_judges_payout.ts', reason: 'Multi-recipient payout tx; ergo-connector builder.' },
  { action: 'claim_after_cancellation', file: 'src/lib/ergo/actions/claim_after_cancellation.ts', reason: 'Refund tx spending the cancellation box; ergo-connector builder.' },
  { action: 'reclaim_after_grace', file: 'src/lib/ergo/actions/reclaim_after_grace.ts', reason: 'Grace-period refund tx; ergo-connector builder.' },
  { action: 'drain_cancelled_game_stake', file: 'src/lib/ergo/actions/drain_cancelled_game_stake.ts', reason: 'Stake-drain tx on cooldown; ergo-connector builder.' },
  { action: 'contribute_to_ceremony', file: 'src/lib/ergo/actions/ceremony.ts', reason: 'Re-spends the active game box to add seed entropy; ergo-connector builder.' },
  { action: 'judges_invalidate_execute', file: 'src/lib/ergo/actions/judges_invalidate.ts', reason: 'Spends the participation box using judge-vote data inputs; ergo-connector multi-box builder (the VOTE half IS wired as judge_invalidate_vote).' },
  { action: 'accept_judge_nomination', file: 'src/lib/ergo/actions/accept_judge_nomination.ts', reason: 'Packs a custom R9 = Coll[Coll[Byte]] [commitment, preimage]; create_opinion_with_signer only writes a flat R9 = Coll[Byte].' },
  { action: 'publish_solver_id', file: 'src/lib/ergo/actions/publish_solver_id.ts', reason: 'Builds a plain FALSE-contract box (R4=solverId), not a reputation opinion; no *_with_signer builder exists.' }
];
