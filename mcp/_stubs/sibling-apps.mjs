// Node adapter for the sibling Svelte packages `source-application` /
// `forum-application`, aliased in by mcp/build.mjs.
//
// The browser app imports these packages' Svelte entry (`dist/index.js`), which
// re-exports Svelte components and is NOT loadable in bare Node. The MCP read
// graph needs exactly ONE symbol from them: `source-application`'s
// `fetchFileSourcesByHash`, used by `src/lib/ergo/utils.ts:fetchServiceDownloadUrl`
// to resolve a Celaut service hash (a game's `serviceId`) to a download URL.
//
// Rather than pull the un-loadable Svelte bundle, this file ports that ONE read
// against the SAME on-chain primitives the rest of the headless surface uses:
// `searchBoxes` + `getTimestampFromBlockId` from `reputation-system/node` (kept
// external / resolved from node_modules by mcp/build.mjs, so no drift with the
// installed package the reads + writes already use). The logic mirrors
// `source-application/src/lib/ergo/sourceFetch.ts:fetchFileSourcesByHash` and
// `sourceObject.ts:deserializeSourceEntry`. The upstream `DOMPurify.sanitize`
// step is display-only (HTML safety for the web UI) and is intentionally omitted
// here — the MCP consumes the parsed `urlLink`, it does not render R9 as HTML.
//
// `forum-application` has no caller in the bundled read graph (only browser
// routes import it), so it stays inert.
import { searchBoxes, getTimestampFromBlockId } from 'reputation-system/node';

// source-application/src/lib/ergo/envs.ts — FILE_SOURCE box Type NFT id.
const FILE_SOURCE_TYPE_NFT_ID =
  '8299d98e15ebee7fa39ad716de7c8bb191790a1bf4b7c3f91af35a0e36187706';

function hexToUtf8(hex) {
  if (!hex || typeof hex !== 'string') return null;
  try {
    return Buffer.from(hex, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

// Port of source-application/src/lib/ergo/sourceObject.ts:deserializeSourceEntry.
// Parses a FILE_SOURCE box's R9 content into a single source entry, tolerating
// the tuple-array format, the legacy JSON-object format, and a bare URL string.
function deserializeSourceEntry(content) {
  const empty = { hashFunctionId: '', contentFormat: '', contentHash: '', rawFormat: '', urlLink: '' };
  if (!content || content.trim() === '') return empty;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const tuple = parsed[0];
      if (Array.isArray(tuple) && tuple.length >= 5) {
        return {
          hashFunctionId: tuple[0] || '',
          contentFormat: tuple[1] || '',
          contentHash: tuple[2] || '',
          rawFormat: tuple[3] || '',
          urlLink: tuple[4] || '',
          isChunked: tuple[5] === true
        };
      }
      if (typeof tuple === 'object' && tuple !== null && !Array.isArray(tuple)) {
        return {
          hashFunctionId: tuple.hashFunctionId || '',
          contentFormat: tuple.contentFormat || tuple.contentFormatNftId || '',
          contentHash: tuple.contentHash || '',
          rawFormat: tuple.rawFormat || tuple.rawFormatNftId || '',
          urlLink: tuple.urlLink || '',
          isChunked: tuple.isChunked === true
        };
      }
    }
  } catch {
    // Not JSON — fall through to the legacy plain-URL form.
  }
  return { hashFunctionId: '', contentFormat: '', contentHash: '', rawFormat: '', urlLink: content, isChunked: false };
}

async function collectBoxes(generator) {
  const boxes = [];
  for await (const batch of generator) boxes.push(...batch);
  return boxes;
}

/**
 * Fetch all FILE_SOURCE boxes for a file hash, newest first.
 * Port of source-application's read; each entry's `source.urlLink` is a download
 * URL published for the hash. `fetchServiceDownloadUrl` takes the first one.
 */
export async function fetchFileSourcesByHash(fileHash, explorerUri) {
  const generator = searchBoxes(
    explorerUri, undefined, FILE_SOURCE_TYPE_NFT_ID, fileHash,
    undefined, undefined, undefined, undefined, undefined, undefined
  );
  const boxes = await collectBoxes(generator);

  const sources = [];
  for (const box of boxes) {
    if (!box.assets?.length) continue;
    // R6 === "false" marks an unlocked/live FILE_SOURCE box (the app's invariant).
    if (box.additionalRegisters.R6?.renderedValue !== 'false') continue;
    if (!box.additionalRegisters.R9?.renderedValue) continue;

    const sourceEntry = deserializeSourceEntry(
      hexToUtf8(box.additionalRegisters.R9.renderedValue) ?? ''
    );

    sources.push({
      id: box.boxId,
      fileHash,
      hashFunctionId: sourceEntry.hashFunctionId || '',
      source: sourceEntry,
      ownerTokenId: box.assets[0].tokenId,
      reputationAmount: Number(box.assets[0].amount),
      timestamp: await getTimestampFromBlockId(explorerUri, box.blockId),
      isLocked: false,
      transactionId: box.transactionId
    });
  }

  sources.sort((a, b) => b.timestamp - a.timestamp);
  return sources;
}
