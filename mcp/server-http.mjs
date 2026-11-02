#!/usr/bin/env node
/**
 * Game of Prompts Celaut service — network-facing twin of mcp/server.mjs.
 *
 * A Celaut service is a sealed microVM reached over TCP, so stdio is unusable.
 * This process exposes THREE interfaces over plain HTTP, each on its own port so
 * that each is its own api slot (one protocol stack per slot) in service.json:
 *
 *   :8080  web   – the Game of Prompts web app (static SvelteKit build, SPA
 *                  fallback to index.html). Chain access happens in the
 *                  viewer's browser, not here.
 *   :8081  rest  – /api/*: a clean JSON REST mirror of every method: reads via
 *                  GET, writes via POST using the env-configured signer
 *                  (GOP_SIGNER_MODE=seed|unsigned — see lib.mjs).
 *   :8082  mcp   – /mcp: the FULL MCP tool surface (same TOOLS/HANDLERS as the
 *                  stdio server) over the SDK's Streamable HTTP transport,
 *                  stateless (one Server per request).
 *
 * Every port also answers GET /health (liveness, not part of MCP or REST).
 *
 * Reads + pure helpers come from core.mjs; writes from writes.mjs. Both the MCP
 * and REST layers call the SAME core/writes functions, so they never diverge.
 *
 * It lives next to server.mjs and shares mcp/package.json, so the stdio and
 * HTTP servers run on the same registry and the same installed deps. The Celaut
 * packaging (.service/) copies this directory to /app/mcp along with the prebuilt
 * _generated/lib.bundle.mjs (the reused src reads + contract compilation) — no
 * build toolchain needed in the VM. celaut.mjs wires the networks the node
 * resolved in `__config__` (see .service/service.json).
 *
 * Data source: Ergo Explorer mainnet (override via GOP_EXPLORER_API).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, HANDLERS } from './tools.mjs';
import { wireContext } from './context.mjs';
import * as core from './core.mjs';
import * as writes from './writes.mjs';
import { signerMode, EXPLORER_API } from './lib.mjs';
import { installCelautNetwork } from './celaut.mjs';

const celaut = installCelautNetwork();

// ── MCP server factory (stateless: one per request) ─────────────────────────
function makeServer() {
  const server = new Server(
    { name: 'game-of-prompts', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  wireContext(server);
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const handler = HANDLERS[name];
    if (!handler) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    try {
      const data = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Error in ${name}: ${err?.message || String(err)}` }] };
    }
  });
  return server;
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
// Ports must match the api slots in .service/service.json.
const WEB_PORT = Number(process.env.GOP_WEB_PORT) || 8080;
const REST_PORT = Number(process.env.GOP_REST_PORT) || 8081;
const MCP_PORT = Number(process.env.GOP_MCP_PORT) || 8082;
const MCP_PATH = '/mcp';

// The static SvelteKit build: /app/web in the image, ../build in a checkout.
const WEB_DIR = [process.env.GOP_WEB_DIR, fileURLToPath(new URL('../build', import.meta.url))]
  .find((dir) => dir && existsSync(join(dir, 'index.html')));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

// ── REST API (clean JSON mirror of every method) ────────────────────────────
//
// Reads (GET):
//   GET  /api/config
//   GET  /api/contracts
//   GET  /api/browser-only-actions
//   GET  /api/height
//   GET  /api/games                              (fetch_all_games)
//   GET  /api/games/active
//   GET  /api/games/resolution
//   GET  /api/games/cancellation
//   GET  /api/games/:gameId                      (fetch_game)
//   GET  /api/games/:gameId/history
//   GET  /api/games/:gameId/phase?height=N
//   GET  /api/games/:gameId/participations?participationTokenId=ID
//   GET  /api/games/:gameId/batches
//   GET  /api/solver/:solverId
//   GET  /api/opinions?objectPointer=PTR&typeNftId=ID
//   GET  /api/tokens/:tokenId
//   GET  /api/tokens/:tokenId/creation-height
// Writes (POST, signer per GOP_SIGNER_MODE):
//   POST /api/profile                            {content?, typeNftId?}
//   POST /api/opinions                           {mainBoxId, typeNftId, objectPointer, polarization, content?, isLocked?}
//   POST /api/opinions/creator                   {mainBoxId, gameId}
//   POST /api/opinions/invalidate                {mainBoxId, commitmentCHex}
//   POST /api/opinions/invalidate-unavailable    {mainBoxId, commitmentCHex}

async function handleRest(req, res, url, query) {
  const method = req.method;
  const path = url.replace(/\/+$/, '') || '/';

  if (method === 'GET') {
    if (path === '/api/config') {
      return sendJson(res, 200, await HANDLERS.get_gop_config({}));
    }
    if (path === '/api/contracts') return sendJson(res, 200, core.getContractsInfo());
    if (path === '/api/browser-only-actions') return sendJson(res, 200, { browserOnly: writes.BROWSER_ONLY_ACTIONS });
    if (path === '/api/height') return sendJson(res, 200, { height: await core.getCurrentHeight() });
    if (path === '/api/games') return sendJson(res, 200, await core.fetchAllGames());
    if (path === '/api/games/active') return sendJson(res, 200, await core.fetchActiveGames());
    if (path === '/api/games/resolution') return sendJson(res, 200, await core.fetchResolutionGames());
    if (path === '/api/games/cancellation') return sendJson(res, 200, await core.fetchCancellationGames());
    if (path === '/api/opinions') {
      const { objectPointer, typeNftId } = query;
      if (!objectPointer) return sendJson(res, 400, { error: 'objectPointer query param is required' });
      return sendJson(res, 200, await core.fetchOpinionsAbout(objectPointer, typeNftId));
    }

    let m = path.match(/^\/api\/games\/([0-9a-fA-F]{64})\/history$/);
    if (m) return sendJson(res, 200, await core.fetchGameHistory(m[1]));
    m = path.match(/^\/api\/games\/([0-9a-fA-F]{64})\/phase$/);
    if (m) return sendJson(res, 200, await core.fetchGamePhase(m[1], query.height ? Number(query.height) : undefined));
    m = path.match(/^\/api\/games\/([0-9a-fA-F]{64})\/participations$/);
    if (m) return sendJson(res, 200, await core.fetchParticipations(m[1], query.participationTokenId));
    m = path.match(/^\/api\/games\/([0-9a-fA-F]{64})\/batches$/);
    if (m) return sendJson(res, 200, await core.fetchParticipationBatches(m[1]));
    m = path.match(/^\/api\/games\/([0-9a-fA-F]{64})$/);
    if (m) return sendJson(res, 200, await core.fetchGame(m[1]));
    m = path.match(/^\/api\/solver\/(.+)$/);
    if (m) return sendJson(res, 200, await core.fetchSolverIdBox(decodeURIComponent(m[1])));
    m = path.match(/^\/api\/tokens\/([0-9a-fA-F]{64})\/creation-height$/);
    if (m) return sendJson(res, 200, { tokenId: m[1], creationHeight: await core.tokenCreationHeight(m[1]) });
    m = path.match(/^\/api\/tokens\/([0-9a-fA-F]{64})$/);
    if (m) return sendJson(res, 200, await core.fetchTokenDetails(m[1]));
    return sendJson(res, 404, { error: `No GET route: ${path}` });
  }

  if (method === 'POST') {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
    try {
      if (path === '/api/profile') return sendJson(res, 200, await writes.createReputationProfile(body.content ?? { name: 'Anon' }, body.typeNftId ?? core.JUDGE_TYPE_NFT_ID));
      if (path === '/api/opinions') return sendJson(res, 200, await writes.createOpinion(body.mainBoxId, body.typeNftId, body.objectPointer, body.polarization, body.content ?? null, body.isLocked ?? false));
      if (path === '/api/opinions/creator') return sendJson(res, 200, await writes.submitCreatorOpinion(body.mainBoxId, body.gameId));
      if (path === '/api/opinions/invalidate') return sendJson(res, 200, await writes.judgeInvalidateVote(body.mainBoxId, body.commitmentCHex));
      if (path === '/api/opinions/invalidate-unavailable') return sendJson(res, 200, await writes.judgeInvalidateUnavailableVote(body.mainBoxId, body.commitmentCHex));
      return sendJson(res, 404, { error: `No POST route: ${path}` });
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || String(err) });
    }
  }

  return sendJson(res, 405, { error: `Method not allowed: ${method}` });
}

// ── Web app (the static SvelteKit build) ────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

async function handleWeb(req, res, path) {
  if (!WEB_DIR) return sendJson(res, 503, { error: 'Web app not built (set GOP_WEB_DIR or run `BASE_PATH= npm run build`).' });
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: `Method not allowed: ${req.method}` });
  let rel;
  try {
    rel = normalize(decodeURIComponent(path)).replace(/^(\.\.(\/|$))+/, '');
  } catch {
    return sendJson(res, 400, { error: 'Bad path' });
  }
  let file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  // SPA fallback (adapter-static `fallback: 'index.html'`): client-side routes.
  if (!info?.isFile()) {
    file = join(WEB_DIR, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) return sendJson(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': file.includes('/_app/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// ── MCP (Streamable HTTP, stateless) ────────────────────────────────────────
async function handleMcp(req, res, path) {
  if (path !== MCP_PATH) {
    return sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32601, message: 'Not found' }, id: null });
  }
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    let body;
    if (req.method === 'POST') body = await readBody(req);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: `Internal error: ${err?.message || String(err)}` }, id: null });
    }
  }
}

// ── Bootstrap: one port per interface (= one api slot in service.json) ─────
function health(res, iface) {
  return sendJson(res, 200, {
    status: 'ok',
    service: 'game-of-prompts',
    interface: iface,
    ports: { web: WEB_PORT, rest: REST_PORT, mcp: MCP_PORT },
    mcp: MCP_PATH,
    rest: '/api',
    web: Boolean(WEB_DIR),
    signerMode: signerMode(),
    explorerUri: EXPLORER_API,
    celaut
  });
}

function listen(port, iface, handle) {
  createServer(async (req, res) => {
    const [rawPath, rawQuery = ''] = (req.url || '').split('?');
    const path = rawPath || '/';
    if (req.method === 'GET' && (path === '/health' || (path === '/' && iface !== 'web'))) return health(res, iface);
    try {
      return await handle(req, res, path, Object.fromEntries(new URLSearchParams(rawQuery)));
    } catch (err) {
      if (!res.headersSent) return sendJson(res, 500, { error: err?.message || String(err) });
    }
  }).listen(port, '0.0.0.0', () => console.log(`game-of-prompts ${iface} on 0.0.0.0:${port}`));
}

listen(WEB_PORT, 'web', handleWeb);
listen(REST_PORT, 'rest', (req, res, path, query) =>
  path === '/api' || path.startsWith('/api/') ? handleRest(req, res, path, query) : sendJson(res, 404, { error: `No route: ${path}` }));
listen(MCP_PORT, 'mcp', handleMcp);
