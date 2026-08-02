/**
 * Conceptual surface of the MCP server: the GoP whitepaper as a RESOURCE and
 * role-oriented workflow PROMPTS.
 *
 * The tools tell an agent *what it can call*; nothing told it *what Game of
 * Prompts is*. This module fills that gap.
 *
 * The whitepaper is NOT vendored here. It is fetched live from the org profile
 * README (game-of-prompts/.github), which is the canonical text — so improving
 * it there is immediately reflected by every MCP client, with no copy-paste
 * step and no risk of the two drifting. Override the source with
 * GOP_OVERVIEW_URL; results are cached in-process for GOP_OVERVIEW_TTL_MS.
 *
 * Wired into BOTH transports via wireContext(), next to the shared TOOLS /
 * HANDLERS registry, so stdio and the HTTP .service never diverge.
 */
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

export const OVERVIEW_URI = 'gop://whitepaper';

const OVERVIEW_URL = process.env.GOP_OVERVIEW_URL
  || 'https://raw.githubusercontent.com/game-of-prompts/.github/main/profile/README.md';

const TTL_MS = Number(process.env.GOP_OVERVIEW_TTL_MS) || 10 * 60 * 1000;

let cache = null; // { text, at }

/** Canonical GoP text, fetched live and cached. Throws with the URL on failure. */
export async function fetchOverview() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;
  let res;
  try {
    res = await fetch(OVERVIEW_URL);
  } catch (err) {
    throw new Error(
      `Could not fetch the GoP whitepaper from ${OVERVIEW_URL} (${err?.message || err}). `
      + `It is served live rather than vendored; read it directly at that URL.`
    );
  }
  if (!res.ok) {
    throw new Error(`Could not fetch the GoP whitepaper from ${OVERVIEW_URL} (HTTP ${res.status}).`);
  }
  const text = await res.text();
  cache = { text, at: Date.now() };
  return text;
}

// ── Resources ───────────────────────────────────────────────────────────────

export const RESOURCES = [
  {
    uri: OVERVIEW_URI,
    name: 'gop_whitepaper',
    title: 'Game of Prompts — concept, protocol and FAQ',
    description:
      'The canonical description of Game of Prompts, served live from the org profile README: what the platform is '
      + '(blockchain-audited bot competitions), the Celaut/Ergo foundations, role FAQs (participant, creator, judge), '
      + 'the full lifecycle flows, the protocol specification (game states R4=0/1/2, box registers, block-based '
      + 'constants), and the trust model with its known limitations. Read this to interpret what the tools return — '
      + 'e.g. why a game has judges, what the Ceremony Phase is for, or how the time-weighted winner is computed.',
    mimeType: 'text/markdown'
  }
];

export async function readResource(uri) {
  if (uri !== OVERVIEW_URI) throw new Error(`Unknown resource: ${uri}`);
  return { contents: [{ uri, mimeType: 'text/markdown', text: await fetchOverview() }] };
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const GAME_ID_ARG = { name: 'gameId', description: 'Game NFT id. Optional — omit to discover games first.', required: false };

export const PROMPTS = [
  {
    name: 'explain_gop',
    description: 'Explain what Game of Prompts is, from the canonical whitepaper (embedded in the reply). Optionally focused on one role.',
    arguments: [
      { name: 'role', description: 'Focus the explanation: participant | creator | judge | protocol. Optional.', required: false }
    ]
  },
  {
    name: 'participate_in_game',
    description: 'Walk through entering a competition as a player: pick a game, obtain and verify its game-service, build a solver, submit a participation.',
    arguments: [GAME_ID_ARG]
  },
  {
    name: 'create_game',
    description: 'Walk through publishing a competition as a creator: game-service and paper references, the secret S and its hash, judges, parameters and stake.',
    arguments: []
  },
  {
    name: 'judge_game',
    description: 'Walk through acting as a nominated judge: accept the nomination, verify a winner candidate, and vote to invalidate when warranted.',
    arguments: [GAME_ID_ARG]
  },
  {
    name: 'inspect_game',
    description: 'Audit one game end to end: lifecycle history, current phase, participations and the reputation signals of its creator and judges.',
    arguments: [{ ...GAME_ID_ARG, required: true }]
  }
];

const ROLE_FOCUS = {
  participant: 'Focus on section 1.2 (Participant FAQ) and section 3 (Player\'s Flow).',
  creator: 'Focus on section 1.3 (Creator FAQ) and section 2 (Creator\'s Flow).',
  judge: 'Focus on section 1.4 (Judge FAQ) and section 4 (Resolution and Rewards).',
  protocol: 'Focus on section 6 (Protocol Specification): entities, game states R4, box registers and block-based constants.'
};

/** Steer the agent to the whitepaper rather than to its own assumptions. */
const READ_FIRST =
  `Read the ${OVERVIEW_URI} resource before answering — it is the canonical description of the platform and is `
  + `served live, so it supersedes anything you may recall about Game of Prompts.`;

const WORKFLOWS = {
  participate_in_game: (gameId) => [
    gameId
      ? `Help the user participate in Game of Prompts competition ${gameId}.`
      : `Help the user participate in a Game of Prompts competition.`,
    READ_FIRST,
    ``,
    `Steps:`,
    gameId
      ? `1. Read the game: get_game_phase for ${gameId} tells you the current contract phase and whether the ceremony and solver submission windows are still open.`
      : `1. Discover the games: fetch_active_games for live ones, fetch_all_games for every state. Confirm with the user which one they mean, then get_game_phase for the phase.`,
    `2. Check the timing before anything else. Participation is only possible while the relevant window is open, and the winner is decided by a TIME-WEIGHTED score, so submitting earlier is worth more. If the deadline has passed, say so and stop.`,
    `3. Get the game-service: get_game_service returns the game's serviceId and a download URL. The serviceId is a content hash — after downloading, the user must verify it matches (\`nodo inspect <service-tag>\`) to be sure the bytes are authentic.`,
    `4. Read the game's paper: the game content carries a \`paper\` hash with the rules of that specific challenge. fetch_service_download_url resolves any hash registered in the FILE_SOURCE registry, including that one.`,
    `5. Explain what running it needs: a Celaut node (their own, ideally — a third-party node can run a modified game-service or copy their solver) and an Ergo wallet with ERG for the participation fee and tx fees.`,
    `6. Help them build the solver-service against the paper's interface.`,
    `7. Warn them not to publish the solver publicly before the deadline (it could be copied and submitted by others), but to make it downloadable right after it — an unavailable solver lets judges invalidate a winning candidate.`,
    ``,
    `Publishing a participation is a browser-only action (see list_browser_only_actions): it needs the Ergo connector in the web app. Take the user up to that boundary and be explicit that the final transaction happens there.`
  ],

  create_game: () => [
    `Help the user publish a Game of Prompts competition as a creator.`,
    READ_FIRST,
    ``,
    `Cover, in this order:`,
    `1. The game-service: what it must evaluate, and that it is referenced on-chain by its content hash, with a public link or mirror so anyone can fetch and verify it.`,
    `2. The paper: the document describing the rules and the solver interface, referenced the same way.`,
    `3. The secret S and its hash: only hashS is published while the game is ACTIVE. Stress the consequences — revealing S early lets ANYONE move the game to CANCELLED_DRAINING, refunding players and draining the creator's stake in portions over time; never revealing it strands the game until the grace period lets participants refund themselves.`,
    `4. The judges to nominate, and why their reputation matters to participants deciding whether to enter.`,
    `5. The numeric parameters: deadline, resolver stake, participation fee, and the commission split. get_gop_config gives the protocol constants these live within (JUDGE_PERIOD, PARTICIPATION_TIME_WINDOW, STAKE_DENOMINATOR and the rest), all denominated in blocks.`,
    `6. Designing against trivial or hardcodeable solutions — the whitepaper's Creator FAQ covers this.`,
    ``,
    `Creating the game is a browser-only action (list_browser_only_actions): it is a multi-box transaction built through the Ergo connector. Prepare everything, then hand off to the web app explicitly.`
  ],

  judge_game: (gameId) => [
    gameId
      ? `Help the user act as a nominated judge for Game of Prompts competition ${gameId}.`
      : `Help the user act as a nominated judge in a Game of Prompts competition.`,
    READ_FIRST,
    ``,
    `Steps:`,
    gameId
      ? `1. get_game_phase for ${gameId}: judges act during the resolution period, so establish where the game stands.`
      : `1. Identify the game (fetch_all_games), then get_game_phase for where it stands. Judges act during the resolution period.`,
    `2. Explain what accepting a nomination entails: publishing test commitments that the contract later verifies when the creator reveals S. If those are wrong, the creator cannot resolve the game at all.`,
    `3. For verification: fetch_participations and fetch_participation_batches give the participations; compute_commitment and find_matching_score_for_commitment let them re-execute and check a winner candidate's claim mechanically.`,
    `4. Be precise about the two invalidation paths — judge_invalidate_vote for a participation that fails verification, and judge_invalidate_unavailable_vote for a winner candidate whose solver cannot be downloaded. Both are wired for the Node signer.`,
    `5. Remind them their reputation is at stake and publicly verifiable: invalidating an honest player is mechanically provable and destroys it.`,
    ``,
    `Note that accept_judge_nomination itself is browser-only (its R9 layout is not expressible through the generic opinion builder) — see list_browser_only_actions.`
  ],

  inspect_game: (gameId) => [
    `Audit Game of Prompts competition ${gameId} end to end and report what you find.`,
    READ_FIRST,
    ``,
    `Gather:`,
    `1. fetch_game_history — every contract box the game NFT passed through, which reveals the real lifecycle: active, resolution, cancellation, or finalized.`,
    `2. get_game_phase — the current phase and its open/closed windows at the present height.`,
    `3. get_game_service — the game-service id and download URL.`,
    `4. fetch_participations and fetch_participation_batches — who entered and with what.`,
    `5. fetch_opinions_about — the reputation signals on the creator and on each judge. Under the trust model, a participant must trust either the creator or at least half the judges, so these signals are the point of the audit, not a footnote.`,
    ``,
    `Then state plainly: what phase the game is in, whether it resolved normally, and what a prospective participant would be trusting. Distinguish what you verified on-chain from what you are inferring.`
  ]
};

export async function getPrompt(name, args = {}) {
  if (name === 'explain_gop') {
    const role = String(args.role || '').toLowerCase();
    const focus = ROLE_FOCUS[role];
    const intro = focus
      ? `Explain Game of Prompts to the user, from the whitepaper below. ${focus}`
      : `Explain Game of Prompts to the user, from the whitepaper below: what it is, how a competition works end to end, and what the participant, creator and judge roles do.`;
    return {
      description: 'The canonical Game of Prompts whitepaper, with an explanation brief.',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${intro}\n\nGround the explanation in this text rather than in prior assumptions, and say so if it does not cover something asked.`
          }
        },
        {
          role: 'user',
          content: {
            type: 'resource',
            resource: { uri: OVERVIEW_URI, mimeType: 'text/markdown', text: await fetchOverview() }
          }
        }
      ]
    };
  }

  const build = WORKFLOWS[name];
  if (!build) throw new Error(`Unknown prompt: ${name}`);

  const spec = PROMPTS.find((p) => p.name === name);
  if (spec?.arguments?.some((a) => a.required && !args[a.name])) {
    const missing = spec.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
    throw new Error(`Prompt ${name} requires: ${missing.join(', ')}`);
  }

  const gameId = args.gameId ? String(args.gameId) : '';
  return {
    description: spec?.description,
    messages: [{ role: 'user', content: { type: 'text', text: build(gameId).join('\n') } }]
  };
}

// ── Wiring (shared by both transports) ──────────────────────────────────────

/** Register the resource + prompt handlers on an MCP Server instance. */
export function wireContext(server) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => readResource(req.params.uri));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => getPrompt(req.params.name, req.params.arguments || {}));
}
