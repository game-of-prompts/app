# Game of Prompts — MCP server (stdio)

A full-surface [Model Context Protocol](https://modelcontextprotocol.io) server
that lets an agent **read** the Game of Prompts on-chain competition registry and
**publish reputation opinions** to it — from one codebase, with a swappable
signer. `server.mjs` is the stdio transport; `server-http.mjs` is the
Streamable HTTP + REST transport that the sealed Celaut microVM in
[`../.service`](../.service) runs (see [Celaut service](#celaut-service)). Both
share `core.mjs` / `lib.mjs` / `writes.mjs` / `tools.mjs`, so the transports never
drift.

Mirrors `source-application/mcp` + `forum-application/mcp`. **DRY** — the read +
contract-compilation logic is **not** re-implemented here; it is the library's own
`src/lib/{ergo,common}/*`, bundled once by `npm run build:mcp` (see Build).
**Additive only** — no theme/UI/`src` files were touched.

## Build

The reads + the `contracts/*.es` compilation live ONCE in `src/`. `mcp/build.mjs`
runs esbuild over `_entry.mjs` (which re-exports the real `src` symbols) and emits
a single Node-loadable ESM module, **`mcp/_generated/lib.bundle.mjs`** (committed):

```sh
npm install
npm run build:mcp   # regenerate _generated/lib.bundle.mjs from src/
```

Re-run after changing any read/contract code under `src/lib/{ergo,common}/`.
`core.mjs` is a thin adapter over the bundle. esbuild:

- inlines the `.es` ErgoScript sources via a `text` loader (so no `contracts/`
  copy is needed in `mcp/` or `.service/`);
- keeps `reputation-system/node` and the `@fleet-sdk/*` packages **external**, so
  reads resolve the SAME installed packages the writes use at runtime (no drift,
  no multi-MB compiler inlined);
- aliases the browser-only edges to inert `_stubs/*` (`$lib/ergo/platform`,
  `$lib/dev/dev-competitions`, the bare `reputation-system` Svelte entry,
  `$app/paths`, the sibling `source-application`/`forum-application` packages).

## Run

```sh
npm install
npm run mcp        # stdio MCP server (node server.mjs)
```

Point any MCP client at `node mcp/server.mjs`. (`_generated/lib.bundle.mjs` is
committed, so a fresh clone runs without a build step; rebuild only when `src/`
read/contract code changes.)

## Signer modes (writes)

Reads need no signer. Writes pick one from the environment (default `unsigned`):

| `GOP_SIGNER_MODE` | Behaviour | Required env |
|---|---|---|
| `unsigned` (default) | Build the tx and return the **unsigned EIP-12** object for an external wallet (Nautilus/ErgoPay). No key. | `GOP_ADDRESS` (P2PK that funds the tx) |
| `seed` | Derive keys from a BIP-39 mnemonic, **sign + submit** autonomously. | `GOP_MNEMONIC` (+ optional `GOP_MNEMONIC_PASSWORD`, `GOP_NODE_URI`, `GOP_ADDRESS_INDEX`) |

`GOP_EXPLORER_API` overrides the Explorer (default `https://api.ergoplatform.com`).
SeedSigner derives with `@scure` (standard BIP-39/32), so it signs from the same
address Nautilus would — it is reused from `reputation-system/node`, never re-rolled.

## Celaut service

`../.service/` packs `server-http.mjs` into a Celaut service following nodo's
[`docs/PACKING.md`](https://github.com/celaut-project/nodo/blob/dev/docs/PACKING.md).
Each interface is its own port, so each is its own api slot with its own
protocol stack (a slot has one stack, bottom layer first):

| Port | `protocol_stack` | Serves |
|---|---|---|
| 8080 | `http` / `web` | The web app (static SvelteKit build, SPA fallback to `index.html`) |
| 8081 | `http` / `rest` | `/api/*` |
| 8082 | `http` / `mcp` | `/mcp` (Streamable HTTP, stateless) |

Every port also answers `GET /health`. `pack_config.json` includes `mcp/` and
the web sources; the Dockerfile copies them with `./...` paths (the packer
rewrites only `./` sources) in a multi-stage `node:22-alpine` build: one stage
builds the web app with `BASE_PATH=`, one installs the production deps of this
directory's lockfile, and the final filesystem holds only node, those deps,
`/app/web` and `/app/mcp`. `service.json` starts `app/mcp/start.sh`.

**Networks — no open egress.** The guest is granted addresses, never DNS
([`docs/NETWORKS.md`](https://github.com/celaut-project/nodo/blob/dev/docs/NETWORKS.md)):

| Network | Used for |
|---|---|
| `api.ergoplatform.com` (443) | Every read, and the UTXOs/height of a write. |
| `raw.githubusercontent.com` (443) | The `gop://whitepaper` resource. |
| `pow:ergo` + `ergo-rest`, `pow.block_id=${ERGO_BLOCK_ID}`, `pow.min_cumulative_difficulty=${ERGO_MIN_CUMULATIVE_DIFFICULTY}` | An Ergo node to submit to in `seed` mode. The reads cannot use it: they need the Explorer API (`/api/v1/boxes/unspent/search`, …), which a node does not serve. |

`celaut.mjs` reads `network_resolution` from `__config__`, answers `dns.lookup`
for the two hostnames from the IPs the node granted (TLS still checks the real
names), and sets `GOP_NODE_URI` to the first `ergo-rest` address when it is not
given. Outside an instance (no `__config__`) it does nothing. Because only those
hosts are reachable, `GOP_EXPLORER_API`, `GOP_OVERVIEW_URL` and `GOP_NODE_URI` are
not declared as envs; the declared ones are `GOP_SIGNER_MODE`, `GOP_ADDRESS`,
`GOP_MNEMONIC`, `GOP_MNEMONIC_PASSWORD`, `GOP_ADDRESS_INDEX`,
`GOP_OVERVIEW_TTL_MS`, `ERGO_BLOCK_ID` and `ERGO_MIN_CUMULATIVE_DIFFICULTY`.
Without both `ERGO_*` the node skips `pow:ergo` and the service runs reads and
unsigned writes only.

```sh
npm run start:http             # local run, normal DNS; web from ../build if built (BASE_PATH= npm run build)
nodo ggconf ..                 # writes ../__config__ for a run against the node
nodo pack ..                   # only once the local run works
nodo service_envs <service id> --json
nodo execute --no-input -e GOP_ADDRESS <P2PK> <service id>
```

## Tools (29)

**Info:** `get_gop_config`, `get_contracts_info` (every game/reputation contract's
address + ErgoTree template hash + script hash, compiled from `contracts/*.es`),
`list_browser_only_actions`.

**Game reads:** `fetch_active_games`, `fetch_resolution_games`,
`fetch_cancellation_games`, `fetch_finalized_games`, `fetch_all_games`,
`fetch_game`, `load_game_by_id`, `fetch_game_history`, `get_game_phase`.

**Participation reads:** `fetch_participations`, `fetch_participation_batches`,
`fetch_solver_id_box`.

**Service sources:** `fetch_service_download_url` (resolve a Celaut service hash —
a game's `serviceId` — to a download URL via the source-application FILE_SOURCE
registry), `get_game_service` (fetch a game by id and resolve its
`{ serviceId, downloadUrl }` in one call, so an agent can obtain a competition's
game service without being handed it).

**Reputation / token / chain reads:** `fetch_opinions_about`,
`fetch_token_details`, `token_creation_height`, `get_current_height`.

**Pure helpers:** `derive_game_phase_snapshot`, `compute_commitment`,
`find_matching_score_for_commitment`.

**Writes (reputation opinions; signer per `GOP_SIGNER_MODE`):**
`create_reputation_profile`, `create_opinion`, `submit_creator_opinion`,
`judge_invalidate_vote`, `judge_invalidate_unavailable_vote`.

## Resource — the whitepaper (`context.mjs`)

The tools say what an agent can *call*; they never said what Game of Prompts
*is*. `gop://whitepaper` closes that gap: the concept, the Celaut/Ergo
foundations, the role FAQs, the lifecycle flows, the protocol spec (`R4` states,
box registers, block constants) and the trust model.

It is **not vendored**. Each read fetches the org profile README
([`game-of-prompts/.github`](https://github.com/game-of-prompts/.github/blob/main/profile/README.md)),
which is the canonical text — improve it there and every MCP client sees it
immediately, with no copy-paste step and no chance of the two drifting.
In-process cache, `GOP_OVERVIEW_TTL_MS` (default 10 min);
`GOP_OVERVIEW_URL` overrides the source.

## Prompts (5)

Role-oriented workflows that chain the tools in the right order and point at the
whitepaper for the reasoning behind them:

| Prompt | Arguments | Purpose |
|---|---|---|
| `explain_gop` | `role?` (participant/creator/judge/protocol) | Explain the platform. Embeds the whitepaper in the reply. |
| `participate_in_game` | `gameId?` | Enter a competition: pick a game, verify its game-service, build a solver, submit. |
| `create_game` | — | Publish a competition: service + paper refs, secret `S`, judges, parameters, stake. |
| `judge_game` | `gameId?` | Accept a nomination, verify a winner candidate, vote to invalidate. |
| `inspect_game` | `gameId` (required) | Audit one game: history, phase, participations, reputation signals. |

The workflow prompts name the browser-only boundary explicitly, so an agent
takes the user up to it instead of pretending it can publish the transaction.

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

- `core.mjs` is a **thin adapter** over `_generated/lib.bundle.mjs` — it points
  the library's `explorer_uri` store at `GOP_EXPLORER_API`, re-exports the pure
  helpers/constants, and shapes the rich `src` results to JSON (Map → array,
  BigInt → string, the inert `platform` stub stripped). There is no second copy
  of the read or contract logic: `get_contracts_info` calls the SAME
  `src/lib/ergo/contract.ts` getters the web app uses (verified byte-identical
  addresses/hashes for all 11 contracts, incl. reputation-proof + dpg).
- `reputation-system` is pinned to the canonical upstream
  `github:reputation-systems/reputation-system` (has the `./node` entry, the
  committed `dist/`, and the `@scure` derivation). Never a fork feature branch.
