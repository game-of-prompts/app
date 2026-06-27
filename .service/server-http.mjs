#!/usr/bin/env node
/**
 * Game of Prompts Celaut service — network-facing twin of mcp/server.mjs.
 *
 * A Celaut service is a sealed microVM reached over TCP, so stdio is unusable.
 * This process binds 0.0.0.0:8080 and exposes THREE surfaces over plain HTTP:
 *
 *   GET  /health           – liveness probe (not part of MCP).
 *   *    /mcp               – the FULL MCP tool surface (same TOOLS/HANDLERS as
 *                            the stdio server) over the SDK's Streamable HTTP
 *                            transport, stateless (one Server per request).
 *   *    /api/*             – a clean JSON REST mirror of every method: reads via
 *                            GET, writes via POST using the env-configured signer
 *                            (GOP_SIGNER_MODE=seed|unsigned — see lib.mjs).
 *
 * Reads + pure helpers come from core.mjs; writes from writes.mjs. Both the MCP
 * and REST layers call the SAME core/writes functions, so they never diverge.
 *
 * Data source: Ergo Explorer mainnet (override via GOP_EXPLORER_API).
 */
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, HANDLERS } from './tools.mjs';
import * as core from './core.mjs';
import * as writes from './writes.mjs';
import { signerMode, EXPLORER_API } from './lib.mjs';

// ── MCP server factory (stateless: one per request) ─────────────────────────
function makeServer() {
  const server = new Server({ name: 'game-of-prompts', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
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
const PORT = Number(process.env.PORT) || 8080;
const MCP_PATH = '/mcp';

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

// ── Bootstrap ───────────────────────────────────────────────────────────────
const httpServer = createServer(async (req, res) => {
  const [rawPath, rawQuery = ''] = (req.url || '').split('?');
  const path = rawPath || '/';
  const query = Object.fromEntries(new URLSearchParams(rawQuery));

  if (req.method === 'GET' && (path === '/health' || path === '/')) {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'game-of-prompts',
      transport: 'streamable-http',
      mcp: MCP_PATH,
      rest: '/api',
      signerMode: signerMode(),
      explorerUri: EXPLORER_API
    });
  }

  if (path === '/api' || path.startsWith('/api/')) {
    try {
      return await handleRest(req, res, path, query);
    } catch (err) {
      return sendJson(res, 500, { error: err?.message || String(err) });
    }
  }

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
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`game-of-prompts service on 0.0.0.0:${PORT} — MCP ${MCP_PATH}, REST /api, health /health`);
});
