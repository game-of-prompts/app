/**
 * Bundle ENTRY for the Game of Prompts MCP read surface.
 *
 * This file re-exports the Game of Prompts library's OWN TypeScript logic
 * straight from `src/lib/ergo/*` and `src/lib/common/*`. `mcp/build.mjs` runs
 * esbuild over this entry to emit a single Node-loadable ESM module
 * (`mcp/_generated/lib.bundle.mjs`) with the browser-only edges aliased away
 * (`$lib/ergo/platform`, `$lib/dev/dev-competitions`, the bare `reputation-system`
 * Svelte entry) and the `.es` contract sources inlined via a text loader.
 *
 * The point: the read + contract-compilation business logic lives ONCE, in
 * `src/`. Nothing here is a re-implementation — every symbol below is the REAL
 * `src` function/constant, the exact code the web app runs. The old 1k-line
 * `mcp/core.mjs` hand-port is gone; core.mjs is now a thin adapter over this
 * bundle.
 */

// ── Contract suite: compiled from `contracts/*.es` — src/lib/ergo/contract.ts ──
// Game contracts (addresses + ErgoTree-template hashes + script hashes) AND the
// reputation_proof / digital_public_good contracts, compiled the SAME way the app
// compiles them (dpg script-hash injected into reputation_proof, etc.).
export {
  getGopGameActiveAddress,
  getGopGameActiveTemplateHash,
  getGopGameActiveScriptHash,
  getGopGameActiveErgoTreeHex,
  getGopGameResolutionAddress,
  getGopGameResolutionTemplateHash,
  getGopGameResolutionScriptHash,
  getGopGameResolutionErgoTreeHex,
  getGopGameCancellationAddress,
  getGopGameCancellationTemplateHash,
  getGopGameCancellationScriptHash,
  getGopGameCancellationErgoTreeHex,
  getGopEndGameAddress,
  getGopEndGameTemplateHash,
  getGopEndGameScriptHash,
  getGopEndGameErgoTreeHex,
  getGopJudgesPaidAddress,
  getGopJudgesPaidTemplateHash,
  getGopJudgesPaidScriptHash,
  getGopJudgesPaidErgoTreeHex,
  getGopParticipationAddress,
  getGopParticipationTemplateHash,
  getGopParticipationScriptHash,
  getGopParticipationErgoTreeHex,
  getGopParticipationBatchAddress,
  getGopParticipationBatchTemplateHash,
  getGopParticipationBatchScriptHash,
  getGopParticipationBatchErgoTreeHex,
  getGopMintIdtAddress,
  getGopMintIdtTemplateHash,
  getGopMintIdtScriptHash,
  getGopMintIdtErgoTreeHex,
  getGopFalseAddress,
  getGopFalseTemplateHash,
  getGopFalseScriptHash,
  getGopFalseErgoTreeHex,
  getReputationProofAddress,
  getReputationProofTemplateHash,
  getReputationProofScriptHash,
  getReputationProofErgoTreeHex,
  getDigitalPublicGoodAddress,
  getDigitalPublicGoodTemplateHash,
  getDigitalPublicGoodScriptHash,
  getDigitalPublicGoodErgoTreeHex
} from '../src/lib/ergo/contract.ts';

// ── Chain reads (Explorer box queries + register parsing) — src/lib/ergo/fetch.ts.
// These read the configured endpoint from the `explorer_uri` store (core.mjs sets
// it from GOP_EXPLORER_API) and return Maps/objects of parsed game/participation
// records.
export {
  fetch_token_details,
  tokenCreationHeight,
  fetchActiveGames,
  fetchResolutionGames,
  fetchCancellationGames,
  fetchFinalizedGames,
  fetchGameHistory,
  fetchSolverIdBox,
  fetchParticipations,
  fetchParticipationBatches,
  fetchGoPGames,
  fetchGame
} from '../src/lib/ergo/fetch.ts';

// ── Reputation / judge reads — src/lib/ergo/reputation/fetch.ts ───────────────
export {
  fetchOpinionsAbout,
  fetchJudges,
  fetchTypeNfts
} from '../src/lib/ergo/reputation/fetch.ts';

// ── Pure game-phase snapshot — src/lib/common/game-phase.ts ───────────────────
export {
  deriveGamePhaseSnapshot,
  GAME_PHASE_DEFINITIONS,
  GameUiSubphase,
  GameContractPhase
} from '../src/lib/common/game-phase.ts';

// ── Pure commitment helpers — src/lib/common/commitment.ts ────────────────────
export { computeCommitmentHex, findMatchingScoreForCommitment } from '../src/lib/common/commitment.ts';

// ── Game lifecycle state + pure helpers — src/lib/common/game.ts ──────────────
export {
  GameState,
  resolve_participation_commitment,
  getPrizePool,
  calculateEffectiveScore
} from '../src/lib/common/game.ts';

// ── Constants — src/lib/common/constants.ts + src/lib/ergo/reputation/types.ts ─
export { getGameConstants, DefaultGameConstants } from '../src/lib/common/constants.ts';
export { JUDGE, GAME, PARTICIPATION, PARTICIPATION_UNAVAILABLE } from '../src/lib/ergo/reputation/types.ts';

// ── Explorer store + supply + dev toggle — src/lib/ergo/envs.ts ───────────────
export { explorer_uri, REPUTATION_PROOF_TOTAL_SUPPLY, isDevMode } from '../src/lib/ergo/envs.ts';

// ── Byte/hex + parsing helpers — src/lib/ergo/utils.ts ────────────────────────
export { hexToUtf8, hexToBytes, uint8ArrayToHex, parseCollByteToHex } from '../src/lib/ergo/utils.ts';

// ── Service source resolution — src/lib/ergo/utils.ts ─────────────────────────
// Resolves a Celaut service hash (a game's `serviceId`) to a download URL via the
// source-application FILE_SOURCE registry. Exported here so esbuild does not
// tree-shake it (it has no other caller in the bundled read graph); the
// `source-application` import it pulls in is aliased to the Node adapter in
// mcp/_stubs/sibling-apps.mjs by mcp/build.mjs.
export { fetchServiceDownloadUrl } from '../src/lib/ergo/utils.ts';
