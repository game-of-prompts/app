# Game of Prompts — MCP server (stdio)

A full-surface [Model Context Protocol](https://modelcontextprotocol.io) server
that lets an agent **read** the Game of Prompts on-chain competition registry and
**publish reputation opinions** to it — from one codebase, with a swappable
signer. It is the local/dev twin of the sealed Celaut microVM in
[`../.service`](../.service) (both share `core.mjs` / `lib.mjs` / `writes.mjs` /
`tools.mjs`, so the transports never drift).

Built following the template recipe in
`ergo-basics-template/MCP.md` and mirroring `source-application/mcp` +
`forum-application/mcp`. **Additive only** — no theme/UI/`src` files were touched.

## Run

```sh
npm install
npm run mcp        # stdio MCP server (node server.mjs)
```

Point any MCP client at `node mcp/server.mjs`.

## Signer modes (writes)

Reads need no signer. Writes pick one from the environment (default `unsigned`):

| `GOP_SIGNER_MODE` | Behaviour | Required env |
|---|---|---|
| `unsigned` (default) | Build the tx and return the **unsigned EIP-12** object for an external wallet (Nautilus/ErgoPay). No key. | `GOP_ADDRESS` (P2PK that funds the tx) |
| `seed` | Derive keys from a BIP-39 mnemonic, **sign + submit** autonomously. | `GOP_MNEMONIC` (+ optional `GOP_MNEMONIC_PASSWORD`, `GOP_NODE_URI`, `GOP_ADDRESS_INDEX`) |

`GOP_EXPLORER_API` overrides the Explorer (default `https://api.ergoplatform.com`).
SeedSigner derives with `@scure` (standard BIP-39/32), so it signs from the same
address Nautilus would — it is reused from `reputation-system/node`, never re-rolled.

## Tools (26)

**Info:** `get_gop_config`, `get_contracts_info` (every game/reputation contract's
address + ErgoTree template hash + script hash, compiled from `contracts/*.es`),
`list_browser_only_actions`.

**Game reads:** `fetch_active_games`, `fetch_resolution_games`,
`fetch_cancellation_games`, `fetch_all_games`, `fetch_game`, `load_game_by_id`,
`fetch_game_history`, `get_game_phase`.

**Participation reads:** `fetch_participations`, `fetch_participation_batches`,
`fetch_solver_id_box`.

**Reputation / token / chain reads:** `fetch_opinions_about`,
`fetch_token_details`, `token_creation_height`, `get_current_height`.

**Pure helpers:** `derive_game_phase_snapshot`, `compute_commitment`,
`find_matching_score_for_commitment`.

**Writes (reputation opinions; signer per `GOP_SIGNER_MODE`):**
`create_reputation_profile`, `create_opinion`, `submit_creator_opinion`,
`judge_invalidate_vote`, `judge_invalidate_unavailable_vote`.

## Wired vs browser-only writes (honest scope)

**Wired** (go through `create_opinion_with_signer` /
`create_profile_with_signer` in `reputation-system/node`, so they serve seed AND
unsigned modes):

- `create_reputation_profile` — mint a reputation PROFILE/JUDGE box.
- `create_opinion` — the generic opinion building block.
- `submit_creator_opinion` — `platform.ts:submitCreatorOpinion` (opinion against GAME).
- `judge_invalidate_vote` — the opinion half of `platform.ts:judgesInvalidateVote`.
- `judge_invalidate_unavailable_vote` — the opinion half of `judgesInvalidateUnavailableVote`.

**Browser-only** (NOT wired — `list_browser_only_actions` enumerates them with
reasons). The core game-lifecycle txs in `src/lib/ergo/actions/*` (`create_game`,
`resolve_game`, `submit_score`, `batch_participations`,
`include_omitted_participation`, `cancel_game`, `end_game`,
`distribute_judges_payout`, `claim_after_cancellation`, `reclaim_after_grace`,
`drain_cancelled_game_stake`, `contribute_to_ceremony`, the
`judges_invalidate` **execute** step) are multi-box / chained transaction
builders that read UTXOs, change address and height through the injected `ergo`
connector and assemble several custom outputs — they cannot be reduced to a
single `*_with_signer` call. Two adjacent reputation writes are also browser-only:
`accept_judge_nomination` (packs a custom `R9 = Coll[Coll[Byte]]` that
`create_opinion_with_signer`'s flat `R9 = Coll[Byte]` cannot express) and
`publish_solver_id` (a plain FALSE-contract box, not an opinion).

## Notes

- `core.mjs` is a Svelte-free port of the read surface of `src/lib/ergo/**` +
  `src/lib/common/**`. It compiles the same `contracts/*.es` with the same
  dependency-injection order as `src/lib/ergo/contract.ts`, and imports the
  reputation-proof + digital-public-good ErgoTrees pre-compiled from
  `reputation-system/node` (their derived hashes are identical to the app's).
- `reputation-system` is pinned to the canonical upstream
  `github:reputation-systems/reputation-system` (has the `./node` entry, the
  committed `dist/`, and the `@scure` derivation). Never a fork feature branch.
