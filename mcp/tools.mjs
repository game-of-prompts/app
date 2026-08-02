/**
 * Shared MCP tool registry for Game of Prompts.
 *
 * A single TOOLS array + HANDLERS map, consumed by BOTH transports:
 *   - mcp/server.mjs            (stdio, local agents/IDEs)
 *   - .service/server-http.mjs  (Streamable HTTP + REST, the Celaut microVM)
 *
 * so the two never drift. Reads + pure helpers come from core.mjs; writes from
 * writes.mjs (env-configured signer, see lib.mjs). Write tools are no-ops on
 * keys in unsigned mode — they return an unsigned tx for an external wallet.
 */
import * as core from './core.mjs';
import * as writes from './writes.mjs';
import { signerMode, EXPLORER_API } from './lib.mjs';

export const TOOLS = [
  // ── Info ──────────────────────────────────────────────────────────────────
  {
    name: 'get_gop_config',
    description: 'Game of Prompts Type NFT ids, the configured Explorer, and the active signer mode (seed|unsigned).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_contracts_info',
    description: 'Every game/reputation contract compiled from source: address + ErgoTree template hash (Explorer search key) + script hash.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'list_browser_only_actions',
    description: 'The game-lifecycle / custom-R9 actions that are browser-only (ergo connector) and NOT wired for the Node signer, with the reason for each.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },

  // ── Reads: games ────────────────────────────────────────────────────────────
  {
    name: 'fetch_active_games',
    description: 'All games currently in the ACTIVE contract state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'fetch_resolution_games',
    description: 'All games currently in the RESOLUTION state (game_resolution + end_game boxes).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'fetch_cancellation_games',
    description: 'All games currently in the CANCELLED_DRAINING state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'fetch_all_games',
    description: 'All games across the active + resolution + cancellation states.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'fetch_game',
    description: 'A single game by NFT id, in any state (live box if active/resolution/cancelled, else a reconstructed Finalized snapshot).',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },
  {
    name: 'load_game_by_id',
    description: 'loadGameById port — fetch one game by id (alias of fetch_game; resolves the game regardless of lifecycle state).',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },
  {
    name: 'fetch_game_history',
    description: 'Full chronological contract-box history of a game NFT (every active/resolution/end-game/cancellation box it passed through).',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },
  {
    name: 'get_game_phase',
    description: 'Fetch a game and derive its live phase snapshot (contract phase + UI subphase + open ceremony / resolution flags) at the current or a given height.',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' }, currentHeight: { type: 'number' } }, required: ['gameId'], additionalProperties: false }
  },

  // ── Reads: participations ───────────────────────────────────────────────────
  {
    name: 'fetch_participations',
    description: 'Unspent participation boxes for a game (matched by game NFT in R6).',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' }, participationTokenId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },
  {
    name: 'fetch_participation_batches',
    description: 'Unspent participation-batch boxes for a game (matched by game NFT in R6).',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },
  {
    name: 'fetch_solver_id_box',
    description: 'The oldest on-chain box publishing a given solver id (searched across reputation-proof R5 and false-contract R4..R9).',
    inputSchema: { type: 'object', properties: { solverId: { type: 'string' } }, required: ['solverId'], additionalProperties: false }
  },

  // ── Reads: service sources ──────────────────────────────────────────────────
  {
    name: 'fetch_service_download_url',
    description: 'Resolve a Celaut service hash (a game\'s serviceId) to a download URL from its newest FILE_SOURCE box in the source-application registry. Returns "N/A" if no source publishes the hash.',
    inputSchema: { type: 'object', properties: { serviceId: { type: 'string' } }, required: ['serviceId'], additionalProperties: false }
  },
  {
    name: 'get_game_service',
    description: 'Fetch a game by NFT id and resolve its competition game-service in one call: returns { serviceId, downloadUrl, title }. Convenience over fetch_game + fetch_service_download_url — the agent needs no game service passed to it.',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' } }, required: ['gameId'], additionalProperties: false }
  },

  // ── Reads: reputation / tokens / chain ──────────────────────────────────────
  {
    name: 'fetch_opinions_about',
    description: 'Reputation-proof opinion boxes whose object pointer (R5) equals a target, optionally filtered to a Type NFT (R4).',
    inputSchema: { type: 'object', properties: { objectPointer: { type: 'string' }, typeNftId: { type: 'string' } }, required: ['objectPointer'], additionalProperties: false }
  },
  {
    name: 'fetch_token_details',
    description: 'EIP-4 token metadata (name/description/decimals/emission) for a token id.',
    inputSchema: { type: 'object', properties: { tokenId: { type: 'string' } }, required: ['tokenId'], additionalProperties: false }
  },
  {
    name: 'token_creation_height',
    description: 'Creation height of the box that minted a token id.',
    inputSchema: { type: 'object', properties: { tokenId: { type: 'string' } }, required: ['tokenId'], additionalProperties: false }
  },
  {
    name: 'get_current_height',
    description: 'Current Ergo mainnet block height (from the Explorer networkState).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },

  // ── Pure helpers ────────────────────────────────────────────────────────────
  {
    name: 'derive_game_phase_snapshot',
    description: 'Pure: derive the phase snapshot for a provided game object + height (no chain access).',
    inputSchema: { type: 'object', properties: { game: { type: 'object' }, currentHeight: { type: 'number' } }, required: ['game', 'currentHeight'], additionalProperties: false }
  },
  {
    name: 'compute_commitment',
    description: 'Pure: compute the blake2b256 participation commitment hex from (solverId, seed, score, hashLogs, ergoTree, secret) hex inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        solverIdHex: { type: 'string' },
        seedHex: { type: 'string' },
        score: { type: 'string', description: 'Score as a decimal string (parsed as a signed 64-bit Long).' },
        hashLogsHex: { type: 'string' },
        ergoTreeHex: { type: 'string' },
        secretHex: { type: 'string' }
      },
      required: ['solverIdHex', 'seedHex', 'score', 'hashLogsHex', 'ergoTreeHex', 'secretHex'],
      additionalProperties: false
    }
  },
  {
    name: 'find_matching_score_for_commitment',
    description: 'Pure: scan a score list and return whether any score reproduces a declared commitment (with the matched score).',
    inputSchema: {
      type: 'object',
      properties: {
        declaredCommitmentHex: { type: 'string' },
        solverIdHex: { type: 'string' },
        seedHex: { type: 'string' },
        scoreList: { type: 'array', items: { type: 'string' }, description: 'Scores as decimal strings.' },
        hashLogsHex: { type: 'string' },
        ergoTreeHex: { type: 'string' },
        secretHex: { type: 'string' }
      },
      required: ['declaredCommitmentHex', 'solverIdHex', 'seedHex', 'scoreList', 'hashLogsHex', 'ergoTreeHex', 'secretHex'],
      additionalProperties: false
    }
  },

  // ── Writes (reputation opinions; signer per GOP_SIGNER_MODE) ─────────────────
  {
    name: 'create_reputation_profile',
    description: 'Mint a reputation PROFILE box (author/judge identity holding rep tokens). Type NFT defaults to JUDGE. Signing per GOP_SIGNER_MODE (seed submits; unsigned returns the tx).',
    inputSchema: { type: 'object', properties: { content: { description: 'Optional profile content (string or JSON object).' }, typeNftId: { type: 'string', description: 'Type NFT id (defaults to the JUDGE type).' } }, additionalProperties: false }
  },
  {
    name: 'create_opinion',
    description: 'Generic reputation opinion against any Type NFT (R5=objectPointer, R8=polarization, R6=isLocked) spending from the author PROFILE box mainBoxId. Signing per GOP_SIGNER_MODE.',
    inputSchema: {
      type: 'object',
      properties: {
        mainBoxId: { type: 'string' },
        typeNftId: { type: 'string' },
        objectPointer: { type: 'string' },
        polarization: { type: 'boolean' },
        content: { description: 'Optional opinion content (string or JSON; serialized into a flat R9 = Coll[Byte]).' },
        isLocked: { type: 'boolean' }
      },
      required: ['mainBoxId', 'typeNftId', 'objectPointer', 'polarization'],
      additionalProperties: false
    }
  },
  {
    name: 'submit_creator_opinion',
    description: 'Creator endorsement of a game — positive, locked opinion against the GAME Type NFT (R5=gameId). Signing per GOP_SIGNER_MODE.',
    inputSchema: { type: 'object', properties: { mainBoxId: { type: 'string' }, gameId: { type: 'string' } }, required: ['mainBoxId', 'gameId'], additionalProperties: false }
  },
  {
    name: 'judge_invalidate_vote',
    description: 'Judge vote invalidating a participation — negative, locked opinion against the PARTICIPATION Type NFT (R5=commitmentC_Hex). The EXECUTE step that spends the participation box is browser-only. Signing per GOP_SIGNER_MODE.',
    inputSchema: { type: 'object', properties: { mainBoxId: { type: 'string' }, commitmentCHex: { type: 'string' } }, required: ['mainBoxId', 'commitmentCHex'], additionalProperties: false }
  },
  {
    name: 'judge_invalidate_unavailable_vote',
    description: 'Judge vote marking a participation unavailable — negative, unlocked opinion against the PARTICIPATION_UNAVAILABLE Type NFT (R5=commitmentC_Hex). Signing per GOP_SIGNER_MODE.',
    inputSchema: { type: 'object', properties: { mainBoxId: { type: 'string' }, commitmentCHex: { type: 'string' } }, required: ['mainBoxId', 'commitmentCHex'], additionalProperties: false }
  }
];

export const HANDLERS = {
  // info
  get_gop_config: async () => ({
    explorerUri: EXPLORER_API,
    signerMode: signerMode(),
    typeNfts: {
      JUDGE_TYPE_NFT_ID: core.JUDGE_TYPE_NFT_ID,
      GAME_TYPE_NFT_ID: core.GAME_TYPE_NFT_ID,
      PARTICIPATION_TYPE_NFT_ID: core.PARTICIPATION_TYPE_NFT_ID,
      PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID: core.PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID
    },
    reputationProofTotalSupply: core.REPUTATION_PROOF_TOTAL_SUPPLY,
    constants: core.GAME_CONSTANTS
  }),
  get_contracts_info: async () => core.getContractsInfo(),
  list_browser_only_actions: async () => ({ browserOnly: writes.BROWSER_ONLY_ACTIONS }),

  // reads: games
  fetch_active_games: async () => core.fetchActiveGames(),
  fetch_resolution_games: async () => core.fetchResolutionGames(),
  fetch_cancellation_games: async () => core.fetchCancellationGames(),
  fetch_all_games: async () => core.fetchAllGames(),
  fetch_game: async ({ gameId }) => core.fetchGame(gameId),
  load_game_by_id: async ({ gameId }) => core.fetchGame(gameId),
  fetch_game_history: async ({ gameId }) => core.fetchGameHistory(gameId),
  get_game_phase: async ({ gameId, currentHeight }) => core.fetchGamePhase(gameId, currentHeight),

  // reads: participations
  fetch_participations: async ({ gameId, participationTokenId }) => core.fetchParticipations(gameId, participationTokenId),
  fetch_participation_batches: async ({ gameId }) => core.fetchParticipationBatches(gameId),
  fetch_solver_id_box: async ({ solverId }) => core.fetchSolverIdBox(solverId),

  // reads: service sources
  fetch_service_download_url: async ({ serviceId }) => ({ serviceId, downloadUrl: await core.fetchServiceDownloadUrl(serviceId) }),
  get_game_service: async ({ gameId }) => core.getGameService(gameId),

  // reads: reputation / tokens / chain
  fetch_opinions_about: async ({ objectPointer, typeNftId }) => core.fetchOpinionsAbout(objectPointer, typeNftId),
  fetch_token_details: async ({ tokenId }) => core.fetchTokenDetails(tokenId),
  token_creation_height: async ({ tokenId }) => ({ tokenId, creationHeight: await core.tokenCreationHeight(tokenId) }),
  get_current_height: async () => ({ height: await core.getCurrentHeight() }),

  // pure helpers
  derive_game_phase_snapshot: async ({ game, currentHeight }) => core.deriveGamePhaseSnapshot(game, currentHeight),
  compute_commitment: async ({ solverIdHex, seedHex, score, hashLogsHex, ergoTreeHex, secretHex }) => {
    const commitment = core.computeCommitmentHex(solverIdHex, seedHex, BigInt(score), hashLogsHex, ergoTreeHex, secretHex);
    if (commitment === null) throw new Error('compute_commitment: one or more hex inputs were invalid.');
    return { commitmentHex: commitment };
  },
  find_matching_score_for_commitment: async ({ declaredCommitmentHex, solverIdHex, seedHex, scoreList, hashLogsHex, ergoTreeHex, secretHex }) =>
    core.findMatchingScoreForCommitment({
      declaredCommitmentHex,
      solverIdHex,
      seedHex,
      scoreList: (scoreList || []).map((s) => BigInt(s)),
      hashLogsHex,
      ergoTreeHex,
      secretHex
    }),

  // writes
  create_reputation_profile: async ({ content, typeNftId } = {}) => writes.createReputationProfile(content ?? { name: 'Anon' }, typeNftId ?? core.JUDGE_TYPE_NFT_ID),
  create_opinion: async ({ mainBoxId, typeNftId, objectPointer, polarization, content, isLocked = false }) =>
    writes.createOpinion(mainBoxId, typeNftId, objectPointer, polarization, content ?? null, isLocked),
  submit_creator_opinion: async ({ mainBoxId, gameId }) => writes.submitCreatorOpinion(mainBoxId, gameId),
  judge_invalidate_vote: async ({ mainBoxId, commitmentCHex }) => writes.judgeInvalidateVote(mainBoxId, commitmentCHex),
  judge_invalidate_unavailable_vote: async ({ mainBoxId, commitmentCHex }) => writes.judgeInvalidateUnavailableVote(mainBoxId, commitmentCHex)
};
