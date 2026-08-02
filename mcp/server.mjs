#!/usr/bin/env node
/**
 * Game of Prompts MCP server — stdio transport, full surface.
 *
 * Exposes the operational READ surface of the Game of Prompts library (games,
 * participations, reputation, contracts, phase + commitment helpers) plus the
 * wired reputation-opinion WRITES over MCP stdio, so any MCP-aware client
 * (Claude, IDEs, agents) can drive it. Reads + pure helpers come from core.mjs;
 * writes go through writes.mjs with the env-configured Signer
 * (GOP_SIGNER_MODE=seed|unsigned — see lib.mjs). The tool registry is shared
 * with the HTTP `.service` via tools.mjs, so the two transports never drift.
 *
 * Run: `npm run mcp`  (from the mcp/ folder, after `npm install`).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, HANDLERS } from './tools.mjs';
import { wireContext } from './context.mjs';

// The reputation library logs verbosely via console.log; on stdio that stream
// IS the JSON-RPC channel, so route all console output to stderr to keep the
// protocol clean. (Harmless for the HTTP service, which doesn't do this.)
console.log = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
console.info = console.log;
console.warn = console.log;

const server = new Server(
  { name: 'game-of-prompts', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
wireContext(server);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    const data = await handler(args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Error in ${name}: ${err?.message || String(err)}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
