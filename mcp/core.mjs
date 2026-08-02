/**
 * Game of Prompts registry — THIN Node adapter over the library's own logic.
 *
 * There is NO re-implementation here. The read layer (Explorer box queries +
 * register parsing, the game/participation/reputation `fetch*` reads), the
 * CONTRACT compilation (the `contracts/*.es` suite + reputation_proof + digital
 * public good), the game-phase snapshot and the commitment helpers all live
 * ONCE in `src/lib/{ergo,common}/*` and are compiled to a single Node-loadable
 * ESM module — `_generated/lib.bundle.mjs` — by `mcp/build.mjs` (run
 * `npm run build:mcp`). This file only:
 *
 *   1. points the library's `explorer_uri` store at GOP_EXPLORER_API,
 *   2. re-exports the pure helpers + constants verbatim from the bundle, and
 *   3. wraps the chain reads to a clean, JSON-safe shape (Map → array, BigInt →
 *      string, and the inert `platform` field — an artifact of reusing the src
 *      read code, see _stubs/platform.mjs — stripped) while taking a gameId where
 *      the src signature takes a full game object.
 *
 * Reuse instead of duplication is the whole point: change a read or a contract in
 * `src/`, rebuild, and it flows through here, the stdio server and the HTTP
 * `.service` alike.
 */
import * as lib from './_generated/lib.bundle.mjs';

export const DEFAULT_EXPLORER_API =
  (typeof process !== 'undefined' && process.env && process.env.GOP_EXPLORER_API) ||
  'https://api.ergoplatform.com';

// Point the library's reactive `explorer_uri` store (used by every src read) at
// the configured endpoint. Done once at module load.
lib.explorer_uri.set(DEFAULT_EXPLORER_API);

// ── Type NFT ids + supply + constants (src/lib/ergo/reputation/types.ts,
//    src/lib/common/constants.ts, src/lib/ergo/envs.ts) ───────────────────────
export const JUDGE_TYPE_NFT_ID = lib.JUDGE;
export const GAME_TYPE_NFT_ID = lib.GAME;
export const PARTICIPATION_TYPE_NFT_ID = lib.PARTICIPATION;
export const PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID = lib.PARTICIPATION_UNAVAILABLE;
export const REPUTATION_PROOF_TOTAL_SUPPLY = lib.REPUTATION_PROOF_TOTAL_SUPPLY;
export const GAME_CONSTANTS = lib.getGameConstants();

// ── JSON-safe shaping ────────────────────────────────────────────────────────
// The src read code returns rich objects that may carry BigInt values and the
// inert `platform` placeholder (from _stubs/platform.mjs). MCP/REST payloads are
// JSON, so normalize: BigInt → decimal string, drop every `platform` key, and
// unwrap Maps to arrays of values.
function jsonSafe(value, seen = new WeakSet()) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Map) return [...value.values()].map((v) => jsonSafe(v, seen));
  if (value instanceof Set) return [...value].map((v) => jsonSafe(v, seen));
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'platform') continue; // inert ErgoPlatform stub — not serializable/useful
    out[k] = jsonSafe(v, seen);
  }
  return out;
}

// ── Contract directory (verbatim compilation from src/lib/ergo/contract.ts) ──
// Address + ErgoTree template hash (Explorer search key) + script hash for every
// game contract, plus reputation_proof + digital_public_good. These are the SAME
// getters the web app uses; verified byte-identical to the prior hand-port.
const CONTRACT_GETTERS = {
  game_active: [lib.getGopGameActiveAddress, lib.getGopGameActiveTemplateHash, lib.getGopGameActiveScriptHash],
  game_resolution: [lib.getGopGameResolutionAddress, lib.getGopGameResolutionTemplateHash, lib.getGopGameResolutionScriptHash],
  game_cancellation: [lib.getGopGameCancellationAddress, lib.getGopGameCancellationTemplateHash, lib.getGopGameCancellationScriptHash],
  end_game: [lib.getGopEndGameAddress, lib.getGopEndGameTemplateHash, lib.getGopEndGameScriptHash],
  judges_paid: [lib.getGopJudgesPaidAddress, lib.getGopJudgesPaidTemplateHash, lib.getGopJudgesPaidScriptHash],
  participation: [lib.getGopParticipationAddress, lib.getGopParticipationTemplateHash, lib.getGopParticipationScriptHash],
  participation_batch: [lib.getGopParticipationBatchAddress, lib.getGopParticipationBatchTemplateHash, lib.getGopParticipationBatchScriptHash],
  mint_idt: [lib.getGopMintIdtAddress, lib.getGopMintIdtTemplateHash, lib.getGopMintIdtScriptHash],
  false: [lib.getGopFalseAddress, lib.getGopFalseTemplateHash, lib.getGopFalseScriptHash],
  reputation_proof: [lib.getReputationProofAddress, lib.getReputationProofTemplateHash, lib.getReputationProofScriptHash],
  digital_public_good: [lib.getDigitalPublicGoodAddress, lib.getDigitalPublicGoodTemplateHash, lib.getDigitalPublicGoodScriptHash]
};

export function getContractsInfo() {
  const out = {};
  for (const [name, [addr, tpl, scr]] of Object.entries(CONTRACT_GETTERS)) {
    out[name] = {
      address: addr().toString(),
      ergoTreeTemplateHash: tpl(),
      scriptHash: scr()
    };
  }
  return out;
}

// ── Reads: games (src/lib/ergo/fetch.ts — Maps unwrapped to arrays) ──────────
export const fetchActiveGames = async () => jsonSafe(await lib.fetchActiveGames());
export const fetchResolutionGames = async () => jsonSafe(await lib.fetchResolutionGames());
export const fetchCancellationGames = async () => jsonSafe(await lib.fetchCancellationGames());

/** All games across active + resolution + cancellation (deduped by gameId). */
export async function fetchAllGames() {
  const [active, resolution, cancellation] = await Promise.all([
    lib.fetchActiveGames(),
    lib.fetchResolutionGames(),
    lib.fetchCancellationGames()
  ]);
  const map = new Map();
  for (const g of [...active.values(), ...resolution.values(), ...cancellation.values()]) {
    map.set(g.gameId, g);
  }
  return jsonSafe([...map.values()]);
}

export const fetchGame = async (gameId) => jsonSafe(await lib.fetchGame(gameId));
export const fetchGameHistory = async (gameId) => jsonSafe(await lib.fetchGameHistory(gameId));

/** Fetch a game and derive its live phase snapshot at the current/given height. */
export async function fetchGamePhase(gameId, currentHeight) {
  const game = await lib.fetchGame(gameId);
  const height = typeof currentHeight === 'number' ? currentHeight : await getCurrentHeight();
  return { game: jsonSafe(game), snapshot: jsonSafe(lib.deriveGamePhaseSnapshot(game, height)) };
}

// ── Reads: participations (src signature takes a full game object) ───────────
export async function fetchParticipations(gameId, participationTokenId) {
  const game = await lib.fetchGame(gameId);
  if (!game) return [];
  // participationTokenId is carried on the game object; the arg is accepted for
  // backward-compat with the tool schema but the src read derives it itself.
  void participationTokenId;
  return jsonSafe(await lib.fetchParticipations(game));
}

export async function fetchParticipationBatches(gameId) {
  const game = await lib.fetchGame(gameId);
  if (!game) return [];
  return jsonSafe(await lib.fetchParticipationBatches(game));
}

export const fetchSolverIdBox = async (solverId) => jsonSafe(await lib.fetchSolverIdBox(solverId));

// ── Reads: service sources (src/lib/ergo/utils.ts:fetchServiceDownloadUrl) ─────
// Resolve a Celaut service hash to a download URL via the source-application
// FILE_SOURCE registry. Returns "N/A" when no source box publishes the hash.
export const fetchServiceDownloadUrl = async (serviceId) => lib.fetchServiceDownloadUrl(serviceId);

// Convenience: fetch a game by id and resolve its competition game-service in one
// call. `serviceId` comes from the game box's R9 game-details JSON.
export async function getGameService(gameId) {
  const game = await lib.fetchGame(gameId);
  if (!game) return { gameId, serviceId: '', downloadUrl: 'N/A', title: null };
  const serviceId = game.content?.serviceId || '';
  const title = game.content?.title ?? null;
  if (!serviceId) return { gameId, serviceId: '', downloadUrl: 'N/A', title };
  return { gameId, serviceId, downloadUrl: await lib.fetchServiceDownloadUrl(serviceId), title };
}

// ── Reads: reputation / tokens / chain ──────────────────────────────────────
export const fetchOpinionsAbout = async (objectPointer, typeNftId) =>
  jsonSafe(await lib.fetchOpinionsAbout(objectPointer, typeNftId));

export const fetchTokenDetails = async (tokenId) => jsonSafe(await lib.fetch_token_details(tokenId));
export const tokenCreationHeight = (tokenId) => lib.tokenCreationHeight(tokenId);

/** Current Ergo mainnet block height (Explorer networkState). */
export async function getCurrentHeight() {
  const res = await fetch(`${DEFAULT_EXPLORER_API}/api/v1/networkState`);
  if (!res.ok) throw new Error(`networkState HTTP ${res.status}`);
  const data = await res.json();
  return data.height;
}

// ── Pure helpers (verbatim from the bundle) ──────────────────────────────────
export const deriveGamePhaseSnapshot = (game, currentHeight) => jsonSafe(lib.deriveGamePhaseSnapshot(game, currentHeight));

export const computeCommitmentHex = (solverIdHex, seedHex, score, hashLogsHex, ergoTreeHex, secretHex) =>
  lib.computeCommitmentHex(solverIdHex, seedHex, score, hashLogsHex, ergoTreeHex, secretHex);

export const findMatchingScoreForCommitment = (params) => jsonSafe(lib.findMatchingScoreForCommitment(params));
