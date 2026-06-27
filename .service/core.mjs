/**
 * Game of Prompts — framework-agnostic READ core.
 *
 * A plain-Node port of the read surface of `src/lib/ergo/**` and
 * `src/lib/common/**`, with every Svelte / `$app` / store dependency stripped.
 * Reads are pure Ergo Explorer HTTP + register parsing, so they port cleanly.
 *
 * Covers:
 *   - the full game-contract suite compiled from `contracts/*.es` (addresses +
 *     ErgoTree-template hashes + script hashes), mirroring `src/lib/ergo/contract.ts`,
 *   - reputation-proof + digital-public-good contracts (imported pre-compiled
 *     from `reputation-system/node`, recompiled hashes verified identical),
 *   - game lifecycle fetches (active / resolution / cancellation / finalized /
 *     single / history) and participation reads,
 *   - reputation/judge reads (opinions about a target, judges),
 *   - token details, the game-phase snapshot, and the commitment helpers.
 *
 * Data source: Ergo Explorer mainnet (override with GOP_EXPLORER_API).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compile } from '@fleet-sdk/compiler';
import { ErgoTree, Network } from '@fleet-sdk/core';
import { sha256, blake2b256, hex } from '@fleet-sdk/crypto';
import {
  ergo_tree as REPUTATION_PROOF_ERGO_TREE_HEX,
  digital_public_good_ergo_tree as DIGITAL_PUBLIC_GOOD_ERGO_TREE_HEX
} from 'reputation-system/node';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const EXPLORER_API = process.env.GOP_EXPLORER_API || 'https://api.ergoplatform.com';
const NETWORK = Network.Mainnet;
const ERGO_TREE_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Constants — production values from src/lib/common/constants.ts (ProductionMode)
// and src/lib/ergo/reputation/types.ts. The MCP/service always runs in
// production mode (the app's dev mode is a browser-only store toggle).
// ─────────────────────────────────────────────────────────────────────────────
export const JUDGE_TYPE_NFT_ID = 'be145b4248aae2535d4e0c39355e5e7ef7be703a2a3831ce58f02130c503b389';
export const GAME_TYPE_NFT_ID = '8299d98e15ebee7fa39ad716de7c8bb191790a1bf4b7c3f91af35a0e36187706';
export const PARTICIPATION_TYPE_NFT_ID = 'f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8';
export const PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID = 'a6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d9';

export const REPUTATION_PROOF_TOTAL_SUPPLY = 100_000_000;

export const GAME_CONSTANTS = {
  JUDGE_PERIOD: 720,
  RESOLVER_OMISSION_NO_PENALTY_PERIOD: 5,
  MAX_SCORE_LIST: 10,
  STAKE_DENOMINATOR: 5,
  COOLDOWN_IN_BLOCKS: 30,
  END_GAME_AUTH_GRACE_PERIOD: 64800,
  PARTICIPATION_GRACE_PERIOD: 6480,
  PARTICIPATION_TIME_WINDOW: 2160,
  SEED_MARGIN: 20,
  MIN_TIME_WEIGHT_MARGIN: 720,
  COMMISSION_DENOMINATOR: 1000000,
  PARTICIPATION_TYPE_ID: PARTICIPATION_TYPE_NFT_ID,
  PARTICIPATION_UNAVAILABLE_TYPE_ID: PARTICIPATION_UNAVAILABLE_TYPE_NFT_ID,
  ACCEPT_GAME_INVITATION_TYPE_ID: GAME_TYPE_NFT_ID
};

// Game lifecycle states (mirrors GameState in src/lib/common/game.ts).
export const GameState = {
  Active: 'Active',
  Resolution: 'Resolution',
  Cancelled_Draining: 'Cancelled_Draining',
  Finalized: 'Finalized'
};

// ─────────────────────────────────────────────────────────────────────────────
// Contract compilation — a faithful, dependency-injected port of
// src/lib/ergo/contract.ts. The compile ORDER matters (transitive deps).
// templateHash = sha256(ergoTree.template) (Explorer search key)
// scriptHash   = blake2b256(ergoTree.bytes) (constant injected into other scripts)
// ─────────────────────────────────────────────────────────────────────────────
const readContract = (name) => readFileSync(join(__dirname, 'contracts', `${name}.es`), 'utf8');

const SRC = {
  game_active: readContract('game_active'),
  game_resolution: readContract('game_resolution'),
  judges_paid: readContract('judges_paid'),
  game_cancellation: readContract('game_cancellation'),
  participation: readContract('participation'),
  participation_batch: readContract('participation_batch'),
  end_game: readContract('end_game'),
  mint_idt: readContract('mint_idt'),
  false: readContract('false')
};

const _cache = {}; // name -> { ergoTree, templateHash, scriptHash }

function templateHashOf(tree) {
  return hex.encode(sha256(tree.template));
}
function scriptHashOf(tree) {
  return hex.encode(blake2b256(tree.bytes));
}

// --- Reputation proof + digital public good: imported pre-compiled from the
// reputation library's node entry. They are compiled there with the SAME dpg
// script-hash injection the app uses, so the derived hashes are identical
// (verified against `ergo_tree_hash`). Wrap the hex back into an ErgoTree so we
// can derive template/script hashes + address the same way.
const _reputationProofTree = new ErgoTree(REPUTATION_PROOF_ERGO_TREE_HEX);
const _digitalPublicGoodTree = new ErgoTree(DIGITAL_PUBLIC_GOOD_ERGO_TREE_HEX);

export const getReputationProofErgoTreeHex = () => REPUTATION_PROOF_ERGO_TREE_HEX;
export const getReputationProofTemplateHash = () => templateHashOf(_reputationProofTree);
export const getReputationProofScriptHash = () => scriptHashOf(_reputationProofTree);
export const getReputationProofAddress = () => _reputationProofTree.toAddress(NETWORK).toString();

export const getDigitalPublicGoodErgoTreeHex = () => DIGITAL_PUBLIC_GOOD_ERGO_TREE_HEX;
export const getDigitalPublicGoodTemplateHash = () => templateHashOf(_digitalPublicGoodTree);
export const getDigitalPublicGoodScriptHash = () => scriptHashOf(_digitalPublicGoodTree);
export const getDigitalPublicGoodAddress = () => _digitalPublicGoodTree.toAddress(NETWORK).toString();

function ensure(name) {
  if (_cache[name]?.ergoTree) return _cache[name];
  let ergoTree;
  const c = GAME_CONSTANTS;
  switch (name) {
    case 'false':
      ergoTree = compile(SRC.false, { version: ERGO_TREE_VERSION });
      break;
    case 'participation':
      ergoTree = compile(
        SRC.participation.replace(/`\+GRACE_PERIOD\+`/g, c.PARTICIPATION_GRACE_PERIOD.toString()),
        { version: ERGO_TREE_VERSION }
      );
      break;
    case 'judges_paid':
      ergoTree = compile(
        SRC.judges_paid.replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, getReputationProofScriptHash()),
        { version: ERGO_TREE_VERSION }
      );
      break;
    case 'game_cancellation':
      ergoTree = compile(
        SRC.game_cancellation.replace(/`\+COOLDOWN_IN_BLOCKS\+`/g, c.COOLDOWN_IN_BLOCKS.toString()),
        { version: ERGO_TREE_VERSION }
      );
      break;
    case 'participation_batch': {
      const participationHash = getScriptHash('participation');
      ergoTree = compile(
        SRC.participation_batch.replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, participationHash),
        { version: ERGO_TREE_VERSION }
      );
      break;
    }
    case 'end_game': {
      const source = SRC.end_game
        .replace(/`\+END_GAME_AUTH_GRACE_PERIOD\+`/g, c.END_GAME_AUTH_GRACE_PERIOD.toString())
        .replace(/`\+COMMISSION_DENOMINATOR\+`/g, c.COMMISSION_DENOMINATOR.toString())
        .replace(/`\+JUDGES_PAID_ERGOTREE\+`/g, getErgoTreeHex('judges_paid'))
        .replace(/`\+MAX_SCORE_LIST\+`/g, c.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, getScriptHash('participation'))
        .replace(/`\+PARTICIPATION_BATCH_SCRIPT_HASH\+`/g, getScriptHash('participation_batch'));
      ergoTree = compile(source, { version: ERGO_TREE_VERSION });
      break;
    }
    case 'game_resolution': {
      const source = SRC.game_resolution
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, getScriptHash('participation'))
        .replace(/`\+PARTICIPATION_BATCH_SCRIPT_HASH\+`/g, getScriptHash('participation_batch'))
        .replace(/`\+END_GAME_SCRIPT_HASH\+`/g, getScriptHash('end_game'))
        .replace(/`\+JUDGE_PERIOD\+`/g, c.JUDGE_PERIOD.toString())
        .replace(/`\+END_GAME_AUTH_GRACE_PERIOD\+`/g, c.END_GAME_AUTH_GRACE_PERIOD.toString())
        .replace(/`\+RESOLVER_OMISSION_NO_PENALTY_PERIOD\+`/g, c.RESOLVER_OMISSION_NO_PENALTY_PERIOD.toString())
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, getReputationProofScriptHash())
        .replace(/`\+PARTICIPATION_TYPE_ID\+`/g, c.PARTICIPATION_TYPE_ID)
        .replace(/`\+PARTICIPATION_UNAVAILABLE_TYPE_ID\+`/g, c.PARTICIPATION_UNAVAILABLE_TYPE_ID)
        .replace(/`\+MAX_SCORE_LIST\+`/g, c.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_TIME_WINDOW\+`/g, c.PARTICIPATION_TIME_WINDOW.toString())
        .replace(/`\+SEED_MARGIN\+`/g, c.SEED_MARGIN.toString())
        .replace(/`\+MIN_TIME_WEIGHT_MARGIN\+`/g, c.MIN_TIME_WEIGHT_MARGIN.toString())
        .replace(/`\+COMMISSION_DENOMINATOR\+`/g, c.COMMISSION_DENOMINATOR.toString())
        .replace(/`\+FALSE_SCRIPT_HASH\+`/g, getScriptHash('false'))
        .replace(/`\+JUDGES_PAID_ERGOTREE\+`/g, getErgoTreeHex('judges_paid'));
      ergoTree = compile(source, { version: ERGO_TREE_VERSION });
      break;
    }
    case 'game_active': {
      const source = SRC.game_active
        .replace(/`\+GAME_RESOLUTION_SCRIPT_HASH\+`/g, getScriptHash('game_resolution'))
        .replace(/`\+GAME_CANCELLATION_SCRIPT_HASH\+`/g, getScriptHash('game_cancellation'))
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, getReputationProofScriptHash())
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, getScriptHash('participation'))
        .replace(/`\+ACCEPT_GAME_INVITATION_TYPE_ID\+`/g, c.ACCEPT_GAME_INVITATION_TYPE_ID)
        .replace(/`\+STAKE_DENOMINATOR\+`/g, c.STAKE_DENOMINATOR.toString())
        .replace(/`\+COOLDOWN_IN_BLOCKS\+`/g, c.COOLDOWN_IN_BLOCKS.toString())
        .replace(/`\+JUDGE_PERIOD\+`/g, c.JUDGE_PERIOD.toString())
        .replace(/`\+MAX_SCORE_LIST\+`/g, c.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_TIME_WINDOW\+`/g, c.PARTICIPATION_TIME_WINDOW.toString())
        .replace(/`\+FALSE_SCRIPT_HASH\+`/g, getScriptHash('false'))
        .replace(/`\+SEED_MARGIN\+`/g, c.SEED_MARGIN.toString())
        .replace(/`\+GRACE_PERIOD\+`/g, c.PARTICIPATION_GRACE_PERIOD.toString());
      ergoTree = compile(source, { version: ERGO_TREE_VERSION });
      break;
    }
    case 'mint_idt': {
      const source = SRC.mint_idt.replace(/`\+contract_bytes_hash\+`/g, getScriptHash('game_active'));
      ergoTree = compile(source, { version: ERGO_TREE_VERSION });
      break;
    }
    default:
      throw new Error(`Unknown contract: ${name}`);
  }
  _cache[name] = {
    ergoTree,
    templateHash: templateHashOf(ergoTree),
    scriptHash: scriptHashOf(ergoTree)
  };
  return _cache[name];
}

export const getErgoTreeHex = (name) => ensure(name).ergoTree.toHex();
export const getTemplateHash = (name) => ensure(name).templateHash;
export const getScriptHash = (name) => ensure(name).scriptHash;
export const getAddress = (name) => ensure(name).ergoTree.toAddress(NETWORK).toString();

/** Full contract directory: address + template hash + script hash for every contract. */
export function getContractsInfo() {
  const gameNames = [
    'game_active',
    'game_resolution',
    'game_cancellation',
    'end_game',
    'judges_paid',
    'participation',
    'participation_batch',
    'mint_idt',
    'false'
  ];
  const out = {};
  for (const name of gameNames) {
    out[name] = {
      address: getAddress(name),
      ergoTreeTemplateHash: getTemplateHash(name),
      scriptHash: getScriptHash(name)
    };
  }
  out.reputation_proof = {
    address: getReputationProofAddress(),
    ergoTreeTemplateHash: getReputationProofTemplateHash(),
    scriptHash: getReputationProofScriptHash()
  };
  out.digital_public_good = {
    address: getDigitalPublicGoodAddress(),
    ergoTreeTemplateHash: getDigitalPublicGoodTemplateHash(),
    scriptHash: getDigitalPublicGoodScriptHash()
  };
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing helpers (ported from src/lib/ergo/utils.ts, Svelte-free).
// ─────────────────────────────────────────────────────────────────────────────
export function hexToBytes(hexString) {
  if (!hexString || typeof hexString !== 'string' || !/^[0-9a-fA-F]*$/.test(hexString)) return null;
  if (hexString.length % 2 !== 0) return null;
  const out = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

export function uint8ArrayToHex(arr) {
  return [...new Uint8Array(arr)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function hexToUtf8(hexString) {
  try {
    if (!hexString || hexString.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hexString.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

export function parseCollByteToHex(renderedValue) {
  if (renderedValue === null || renderedValue === undefined) return null;
  if (Array.isArray(renderedValue) && renderedValue.every((i) => typeof i === 'number' && i >= 0 && i <= 255)) {
    try {
      return uint8ArrayToHex(new Uint8Array(renderedValue));
    } catch {
      return null;
    }
  }
  if (typeof renderedValue === 'string') {
    const cleaned = renderedValue.startsWith('0x') ? renderedValue.substring(2) : renderedValue;
    if (/^[0-9a-fA-F]*$/.test(cleaned) && cleaned.length % 2 === 0) return cleaned;
  }
  return null;
}

export function getArrayFromValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && !trimmed.includes('"')) {
      const inner = trimmed.substring(1, trimmed.length - 1);
      return inner === '' ? [] : inner.split(',');
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

export function parseLongColl(rendered) {
  if (!Array.isArray(rendered)) return null;
  try {
    return rendered.map((item) => {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'bigint') return BigInt(item);
      throw new Error(`Cannot convert '${item}' to BigInt.`);
    });
  } catch {
    return null;
  }
}

export function parseGameContent(rawJsonDetails, gameBoxId, nft) {
  const defaultTitle = nft?.name || `Game ${(gameBoxId || '').slice(0, 8)}`;
  const defaultDescription = nft?.description || 'No description provided.';
  let content = {
    rawJsonString: rawJsonDetails || '{}',
    title: defaultTitle,
    description: defaultDescription,
    serviceId: '',
    imageURL: '',
    soundtrackURL: ''
  };
  if (rawJsonDetails) {
    try {
      const parsed = JSON.parse(rawJsonDetails);
      const imageUrl =
        typeof parsed.imageURL === 'string' && parsed.imageURL && !/^[0-9a-fA-F]{64}$/.test(parsed.imageURL)
          ? parsed.imageURL
          : '';
      content = {
        ...content,
        title: parsed.title || defaultTitle,
        description: parsed.description || defaultDescription,
        serviceId: parsed.serviceId || '',
        image: parsed.image || undefined,
        imageURL: imageUrl,
        creatorTokenId: parsed.creatorTokenId || undefined,
        paper: parsed.paper || undefined,
        soundtrack: parsed.soundtrack || undefined,
        soundtrackURL: '',
        indetermismIndex: parsed.indetermismIndex || undefined
      };
    } catch {
      /* keep defaults */
    }
  }
  return content;
}

// Convert an Explorer box's additionalRegisters to a {Rx: serializedValue} map.
function serializedRegisters(box) {
  return Object.entries(box.additionalRegisters ?? {}).reduce((acc, [k, v]) => {
    acc[k] = v.serializedValue;
    return acc;
  }, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
async function searchUnspentByTemplate(templateHash, registers, useUnspent = true) {
  const base = useUnspent ? '/api/v1/boxes/unspent/search' : '/api/v1/boxes/search';
  const all = [];
  let offset = 0;
  const limit = 100;
  let more = true;
  while (more) {
    const res = await fetch(`${EXPLORER_API}${base}?offset=${offset}&limit=${limit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registers ? { ergoTreeTemplateHash: templateHash, registers } : { ergoTreeTemplateHash: templateHash })
    });
    if (!res.ok) break;
    const data = await res.json();
    const items = data.items || [];
    all.push(...items);
    offset += items.length;
    more = items.length === limit;
  }
  return all;
}

async function fetchBoxById(boxId) {
  const res = await fetch(`${EXPLORER_API}/api/v1/boxes/${boxId}`);
  if (!res.ok) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Token details (ported from fetch.ts:fetch_token_details / tokenCreationHeight)
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchTokenDetails(id) {
  if (!/^[0-9a-fA-F]{64}$/.test(id || '')) throw new Error('token id must be a 64-char hex string');
  const res = await fetch(`${EXPLORER_API}/api/v1/tokens/${id}`);
  if (res.ok) {
    const j = await res.json();
    if (j.type === 'EIP-004') {
      return { name: j.name, description: j.description, decimals: j.decimals, emissionAmount: j.emissionAmount };
    }
    if (j.type == null) {
      return { name: id.slice(0, 6), description: '', decimals: 0, emissionAmount: j.emissionAmount ?? null };
    }
  }
  return { name: 'token', description: '', decimals: 0, emissionAmount: null };
}

export async function tokenCreationHeight(tokenId) {
  try {
    const res = await fetch(`${EXPLORER_API}/api/v1/tokens/${tokenId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const boxId = data?.boxId;
    if (!boxId) return null;
    const box = await fetchBoxById(boxId);
    return box?.creationHeight ?? null;
  } catch {
    return null;
  }
}

/**
 * Validity check ported from fetch.ts:fetch_conditions — the game NFT must have
 * been minted in the mint_idt contract and (optionally) match createdAt/deadline.
 */
export async function fetchConditions(tokenId, createdAt, deadline) {
  try {
    const res = await fetch(`${EXPLORER_API}/api/v1/tokens/${tokenId}`);
    if (!res.ok) return false;
    const data = await res.json();
    const boxId = data?.boxId;
    if (!boxId) return false;
    const box = await fetchBoxById(boxId);
    if (!box) return false;

    const creationHeight = box?.creationHeight;
    if (createdAt !== undefined) {
      if (creationHeight === undefined || createdAt < creationHeight - 5 || createdAt > creationHeight + 5) return false;
    }
    if (deadline !== undefined) {
      const minDeadline = GAME_CONSTANTS.PARTICIPATION_TIME_WINDOW + GAME_CONSTANTS.SEED_MARGIN;
      if (deadline < minDeadline) return false;
    }
    if (box?.ergoTree !== getErgoTreeHex('mint_idt')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentHeight() {
  const res = await fetch(`${EXPLORER_API}/api/v1/networkState`);
  if (!res.ok) throw new Error(`networkState HTTP ${res.status}`);
  const data = await res.json();
  return data.height;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reputation / judge reads (ported from reputation/fetch.ts via the Explorer)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * All reputation-proof opinion boxes whose R5 (object pointer) equals
 * `objectPointer`, optionally filtered to a Type NFT (R4). Mirrors
 * fetchOpinionsAbout. Returns lightly-parsed opinion records.
 */
export async function fetchOpinionsAbout(objectPointer, typeNftId) {
  if (!objectPointer) return [];
  const registers = { R5: objectPointer };
  if (typeNftId) registers.R4 = typeNftId;
  const boxes = await searchUnspentByTemplate(getReputationProofTemplateHash(), registers, false);
  return boxes.map((b) => parseOpinionBox(b)).filter(Boolean);
}

function parseOpinionBox(box) {
  try {
    const r = box.additionalRegisters || {};
    const tokenId = box.assets?.[0]?.tokenId || null;
    return {
      boxId: box.boxId,
      creationHeight: box.creationHeight,
      token_id: tokenId,
      token_amount: Number(box.assets?.[0]?.amount || 0),
      type: { tokenId: r.R4?.renderedValue ? parseCollByteToHex(r.R4.renderedValue) : '' },
      object_pointer: r.R5?.renderedValue ? parseCollByteToHex(r.R5.renderedValue) || r.R5.renderedValue : '',
      is_locked: r.R6?.renderedValue === 'true',
      polarization: r.R8?.renderedValue === 'true',
      transactionId: box.transactionId
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game lifecycle reads (ported from fetch.ts). Parsing is async only because of
// the fetchConditions validity check, kept for fidelity with the app.
// ─────────────────────────────────────────────────────────────────────────────
async function parseGameActiveBox(box) {
  try {
    if (box.ergoTree !== getErgoTreeHex('game_active')) return null;
    if (!box.assets || box.assets.length === 0) return null;
    const gameId = box.assets[0].tokenId;
    const r = box.additionalRegisters;

    const gameState = parseInt(r.R4?.renderedValue, 10);
    if (gameState !== 0) return null;
    const seed = parseCollByteToHex(r.R5?.renderedValue);
    const secretHash = parseCollByteToHex(r.R6?.renderedValue);
    if (!seed || !secretHash) return null;

    const judges = (r.R7?.renderedValue || '')
      .replace(/[\[\]\s]/g, '')
      .split(',')
      .filter((e) => e.length === 64);

    const numericalParams = parseLongColl(getArrayFromValue(r.R8?.renderedValue));
    if (!numericalParams || numericalParams.length < 9) return null;
    const [createdAt, timeWeight, deadlineBlock, resolverStakeAmount, participationFeeAmount, perJudgeCommission, resolverCommission, devCommission, creatorSlashRatio] = numericalParams;

    if (!(await fetchConditions(gameId, Number(createdAt), Number(deadlineBlock)))) return null;

    const r9 = getArrayFromValue(r.R9?.renderedValue);
    if (!Array.isArray(r9) || r9.length < 3) return null;
    const participationTokenId = parseCollByteToHex(r9[1]) || '';
    const devScript = parseCollByteToHex(r9[2]);
    const content = parseGameContent(hexToUtf8(parseCollByteToHex(r9[0]) || ''), box.boxId, box.assets[0]);

    return {
      boxId: box.boxId,
      status: GameState.Active,
      gameId,
      resolverCommission: Number(resolverCommission),
      devCommission: Number(devCommission),
      devScript,
      secretHash,
      judges,
      deadlineBlock: Number(deadlineBlock),
      resolverStakeAmount: resolverStakeAmount.toString(),
      participationFeeAmount: participationFeeAmount.toString(),
      participationTokenId,
      content,
      value: (box.assets.find((a) => a.tokenId === participationTokenId)?.amount ?? 0).toString(),
      perJudgeCommission: perJudgeCommission.toString(),
      timeWeight: timeWeight.toString(),
      createdAt: Number(createdAt),
      seed,
      ceremonyDeadline: Number(deadlineBlock) - GAME_CONSTANTS.PARTICIPATION_TIME_WINDOW,
      creatorSlashRatio: Number(creatorSlashRatio),
      reputationOpinions: await fetchOpinionsAbout(gameId, GAME_TYPE_NFT_ID),
      constants: GAME_CONSTANTS
    };
  } catch {
    return null;
  }
}

async function parseGameResolutionBox(box) {
  try {
    const isEndGame = box.ergoTree === getErgoTreeHex('end_game');
    if (box.ergoTree !== getErgoTreeHex('game_resolution') && !isEndGame) return null;
    if (!box.assets || box.assets.length === 0) return null;
    const gameId = box.assets[0].tokenId;
    const r = box.additionalRegisters;

    const gameState = parseInt(r.R4?.renderedValue, 10);
    if (gameState !== 1) return null;
    const seed = parseCollByteToHex(r.R5?.renderedValue);
    if (!seed) return null;

    const r6 = getArrayFromValue(r.R6?.renderedValue);
    if (!r6 || r6.length < 2) return null;
    const revealedS_Hex = parseCollByteToHex(r6[0]);
    const winnerCandidateCommitment = parseCollByteToHex(r6[1]);
    if (!revealedS_Hex) return null;

    const judges = (getArrayFromValue(r.R7?.renderedValue) || []).map(parseCollByteToHex).filter(Boolean);

    const numericalParams = parseLongColl(getArrayFromValue(r.R8?.renderedValue));
    if (!numericalParams || numericalParams.length < 10) return null;
    const [createdAt, timeWeight, deadlineBlock, resolverStakeAmount, participationFeeAmount, perJudgeCommission, resolverCommission, devCommission, creatorSlashRatio, resolutionDeadline] = numericalParams;

    if (!(await fetchConditions(gameId, Number(createdAt), Number(deadlineBlock)))) return null;

    const r9 = getArrayFromValue(r.R9?.renderedValue);
    if (!r9 || r9.length !== 4) return null;
    const gameDetailsHex = r9[0];
    const participationTokenId = parseCollByteToHex(r9[1]) || '';
    const devScript = parseCollByteToHex(r9[2]);
    const resolverScript_Hex = parseCollByteToHex(r9[3]);
    if (!gameDetailsHex || !resolverScript_Hex || !devScript) return null;

    const content = parseGameContent(hexToUtf8(gameDetailsHex), box.boxId, box.assets[0]);
    const resolverPK_Hex = resolverScript_Hex.slice(0, 6) === '0008cd' ? resolverScript_Hex.slice(6) : null;

    return {
      boxId: box.boxId,
      status: GameState.Resolution,
      gameId,
      resolutionDeadline: Number(resolutionDeadline),
      revealedS_Hex,
      winnerCandidateCommitment: winnerCandidateCommitment || null,
      judges,
      deadlineBlock: Number(deadlineBlock),
      resolverStakeAmount: resolverStakeAmount.toString(),
      participationFeeAmount: participationFeeAmount.toString(),
      participationTokenId,
      resolverPK_Hex,
      resolverScript_Hex,
      content,
      value: (box.assets.find((a) => a.tokenId === participationTokenId)?.amount ?? 0).toString(),
      perJudgeCommission: perJudgeCommission.toString(),
      timeWeight: timeWeight.toString(),
      resolverCommission: Number(resolverCommission),
      devCommission: Number(devCommission),
      creatorSlashRatio: Number(creatorSlashRatio),
      devScript,
      seed,
      isEndGame,
      createdAt: Number(createdAt),
      reputationOpinions: await fetchOpinionsAbout(gameId, GAME_TYPE_NFT_ID),
      constants: GAME_CONSTANTS
    };
  } catch {
    return null;
  }
}

async function parseGameCancellationBox(box) {
  try {
    if (box.ergoTree !== getErgoTreeHex('game_cancellation')) return null;
    if (!box.assets || box.assets.length === 0) return null;
    const gameId = box.assets[0].tokenId;
    const r = box.additionalRegisters;

    const gameState = parseInt(r.R4?.renderedValue, 10);
    if (Number.isNaN(gameState) || gameState !== 2) return null;
    const unlockHeight = parseInt(r.R5?.renderedValue, 10);
    const revealedS_Hex = parseCollByteToHex(r.R6?.renderedValue);
    const portionToClaim = BigInt(r.R7?.renderedValue || 0);

    let originalDeadline = 0;
    let createdAt;
    const r8 = r.R8?.renderedValue;
    if (r8) {
      const parsedR8 = getArrayFromValue(r8);
      if (Array.isArray(parsedR8)) {
        const np = parseLongColl(parsedR8);
        if (np && np.length >= 1) {
          createdAt = Number(np[0]);
          originalDeadline = np.length > 2 ? Number(np[2]) : Number(np[0]);
        }
      } else {
        originalDeadline = parseInt(r8, 10);
      }
    }

    const r9 = getArrayFromValue(r.R9?.renderedValue);
    if (!Array.isArray(r9) || r9.length < 2) return null;
    const participationTokenId = parseCollByteToHex(r9[1]) || '';
    const content = parseGameContent(hexToUtf8(parseCollByteToHex(r9[0]) || ''), box.boxId, box.assets[0]);

    if (Number.isNaN(unlockHeight) || !revealedS_Hex) return null;
    if (!(await fetchConditions(gameId, createdAt !== undefined ? Number(createdAt) : undefined, Number(originalDeadline)))) return null;

    return {
      boxId: box.boxId,
      status: GameState.Cancelled_Draining,
      gameId,
      unlockHeight,
      revealedS_Hex,
      portionToClaim: portionToClaim.toString(),
      content,
      participationFeeAmount: '0',
      participationTokenId,
      value: (box.assets.find((a) => a.tokenId === participationTokenId)?.amount ?? 0).toString(),
      judges: [],
      deadlineBlock: originalDeadline,
      createdAt,
      reputationOpinions: await fetchOpinionsAbout(gameId, GAME_TYPE_NFT_ID),
      constants: GAME_CONSTANTS
    };
  } catch {
    return null;
  }
}

export async function fetchActiveGames() {
  const boxes = await searchUnspentByTemplate(getTemplateHash('game_active'));
  const games = [];
  for (const box of boxes) {
    const g = await parseGameActiveBox(box);
    if (g) games.push(g);
  }
  return games;
}

export async function fetchResolutionGames() {
  const games = [];
  for (const template of [getTemplateHash('game_resolution'), getTemplateHash('end_game')]) {
    const boxes = await searchUnspentByTemplate(template);
    for (const box of boxes) {
      const g = await parseGameResolutionBox(box);
      if (g) games.push(g);
    }
  }
  return games;
}

export async function fetchCancellationGames() {
  const boxes = await searchUnspentByTemplate(getTemplateHash('game_cancellation'));
  const games = [];
  for (const box of boxes) {
    const g = await parseGameCancellationBox(box);
    if (g) games.push(g);
  }
  return games;
}

/**
 * fetchGame — single game by NFT id, any state. Ported from fetch.ts:fetchGame
 * (store lookup removed). Returns Active/Resolution/Cancellation from the live
 * unspent box, else reconstructs a Finalized snapshot from historical boxes.
 */
export async function fetchGame(id) {
  if (!/^[0-9a-fA-F]{64}$/.test(id || '')) throw new Error('game id must be a 64-char hex token id');

  // 1) current unspent box for the token
  let currentBox = null;
  try {
    const res = await fetch(`${EXPLORER_API}/api/v1/boxes/unspent/byTokenId/${id}?limit=1`);
    if (res.ok) {
      const data = await res.json();
      if (data.items && data.items.length > 0) currentBox = data.items[0];
    }
  } catch {
    /* ignore */
  }

  if (currentBox) {
    if (currentBox.ergoTree === getErgoTreeHex('game_active')) {
      const g = await parseGameActiveBox(currentBox);
      if (g) return g;
    } else if (currentBox.ergoTree === getErgoTreeHex('game_resolution') || currentBox.ergoTree === getErgoTreeHex('end_game')) {
      const g = await parseGameResolutionBox(currentBox);
      if (g) return g;
    } else if (currentBox.ergoTree === getErgoTreeHex('game_cancellation')) {
      const g = await parseGameCancellationBox(currentBox);
      if (g) return g;
    }
  }

  // 2) reconstruct from historical contract boxes
  const histBoxes = await fetchGameHistory(id);
  if (histBoxes.length > 0) {
    const sorted = [...histBoxes].sort((a, b) => b._creationHeight - a._creationHeight);
    const lastBox = sorted[0];
    const resolutionBoxes = sorted.filter((b) => b.status === GameState.Resolution);
    const lastResolutionBox = resolutionBoxes[0] || null;
    const judgeFinalizationBlock = lastResolutionBox?.resolutionDeadline || 0;

    const maxHistValue = histBoxes.reduce((max, b) => (BigInt(b.value ?? 0) > max ? BigInt(b.value ?? 0) : max), 0n);
    const finalPrizeValue = lastResolutionBox ? lastResolutionBox.value : maxHistValue > 0n ? maxHistValue.toString() : lastBox.value;

    return {
      boxId: currentBox ? currentBox.boxId : lastBox.boxId,
      status: GameState.Finalized,
      deadlineBlock: lastBox.deadlineBlock,
      gameId: id,
      content: lastBox.content,
      value: finalPrizeValue,
      participationFeeAmount: (lastBox.participationFeeAmount || 0).toString(),
      participationTokenId: lastBox.participationTokenId,
      judges: lastBox.judges || [],
      judgeFinalizationBlock,
      winnerFinalizationDeadline: judgeFinalizationBlock + GAME_CONSTANTS.END_GAME_AUTH_GRACE_PERIOD,
      seed: lastResolutionBox?.seed || '',
      revealedS_Hex: lastResolutionBox?.revealedS_Hex || '',
      winnerCandidateCommitment: lastResolutionBox?.winnerCandidateCommitment || null,
      resolverStakeAmount: (lastResolutionBox?.resolverStakeAmount || 0).toString(),
      perJudgeCommission: (lastResolutionBox?.perJudgeCommission || 0).toString(),
      timeWeight: (lastResolutionBox?.timeWeight || 0).toString(),
      resolverPK_Hex: lastResolutionBox?.resolverPK_Hex || null,
      resolverScript_Hex: lastResolutionBox?.resolverScript_Hex || '',
      resolverCommission: lastResolutionBox?.resolverCommission || 0,
      devCommission: lastResolutionBox?.devCommission || 0,
      createdAt: lastResolutionBox?.createdAt || lastBox.createdAt || 0,
      reputationOpinions: await fetchOpinionsAbout(id, GAME_TYPE_NFT_ID),
      constants: GAME_CONSTANTS
    };
  }

  return null;
}

/**
 * Full chronological contract-box history of a game NFT. Ported from
 * fetch.ts:fetchGameHistory. Each entry carries `_creationHeight` for ordering.
 */
export async function fetchGameHistory(gameId) {
  if (!/^[0-9a-fA-F]{64}$/.test(gameId || '')) throw new Error('game id must be a 64-char hex token id');
  const history = [];
  let offset = 0;
  const limit = 100;
  let more = true;
  while (more) {
    const res = await fetch(`${EXPLORER_API}/api/v1/boxes/byTokenId/${gameId}?offset=${offset}&limit=${limit}`);
    if (!res.ok) break;
    const data = await res.json();
    const items = data.items || [];
    for (const box of items) {
      let g = null;
      if (box.ergoTree === getErgoTreeHex('game_active')) g = await parseGameActiveBox(box);
      else if (box.ergoTree === getErgoTreeHex('game_resolution') || box.ergoTree === getErgoTreeHex('end_game')) g = await parseGameResolutionBox(box);
      else if (box.ergoTree === getErgoTreeHex('game_cancellation')) g = await parseGameCancellationBox(box);
      if (g) {
        g._creationHeight = box.creationHeight;
        history.push(g);
      }
    }
    offset += items.length;
    more = items.length === limit;
  }
  history.sort((a, b) => a._creationHeight - b._creationHeight);
  return history;
}

/** All games across every lifecycle state (active + resolution + cancellation). */
export async function fetchAllGames() {
  const [active, resolution, cancellation] = await Promise.all([
    fetchActiveGames(),
    fetchResolutionGames(),
    fetchCancellationGames()
  ]);
  const map = new Map();
  for (const g of [...active, ...resolution, ...cancellation]) map.set(g.gameId, g);
  return [...map.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Participation reads (ported from fetch.ts:_parseParticipationBox / fetchParticipations)
// ─────────────────────────────────────────────────────────────────────────────
function parseParticipationBox(box, participationTokenId) {
  try {
    const r = box.additionalRegisters;
    const playerScript_Hex = r.R4?.renderedValue;
    const commitmentC_Hex = r.R5?.renderedValue;
    const gameNftId = r.R6?.renderedValue;
    const solverId_RawBytesHex = r.R7?.renderedValue;
    const hashLogs_Hex = r.R8?.renderedValue;
    let scoreList = [];
    try {
      scoreList = JSON.parse(r.R9?.renderedValue) ?? [];
    } catch {
      scoreList = [];
    }
    if (!playerScript_Hex || !commitmentC_Hex || !gameNftId || !solverId_RawBytesHex || !hashLogs_Hex) return null;
    const playerPK_Hex = playerScript_Hex.slice(0, 6) === '0008cd' ? playerScript_Hex.slice(6) : null;
    return {
      boxId: box.boxId,
      transactionId: box.transactionId,
      creationHeight: box.creationHeight,
      value: (box.assets?.find((a) => a.tokenId === participationTokenId)?.amount ?? 0).toString(),
      gameNftId,
      playerPK_Hex,
      playerScript_Hex,
      commitmentC_Hex,
      solverId_RawBytesHex,
      hashLogs_Hex,
      scoreList,
      spent: !!box.spentTransactionId
    };
  } catch {
    return null;
  }
}

/**
 * Participations for a game (by game NFT in R6). Lightweight port of
 * fetchParticipations: returns the parsed participation boxes (the heavy
 * commitment/solver malformity classification is browser/UI-side and depends on
 * full game objects + chained solver-box reads).
 */
export async function fetchParticipations(gameId, participationTokenId) {
  if (!/^[0-9a-fA-F]{64}$/.test(gameId || '')) throw new Error('game id must be a 64-char hex token id');
  const boxes = await searchUnspentByTemplate(getTemplateHash('participation'), { R6: gameId }, false);
  const out = [];
  for (const box of boxes) {
    if (box.ergoTree !== getErgoTreeHex('participation')) continue;
    const p = parseParticipationBox(box, participationTokenId || '');
    if (p) out.push(p);
  }
  return out;
}

/** Unspent participation batch boxes for a game (by R6). */
export async function fetchParticipationBatches(gameId) {
  if (!/^[0-9a-fA-F]{64}$/.test(gameId || '')) throw new Error('game id must be a 64-char hex token id');
  const boxes = await searchUnspentByTemplate(getTemplateHash('participation_batch'), { R6: gameId });
  return boxes
    .filter((b) => b.additionalRegisters?.R6?.renderedValue === gameId)
    .map((b) => ({ boxId: b.boxId, value: b.value.toString(), creationHeight: b.creationHeight, assets: b.assets, additionalRegisters: serializedRegisters(b) }));
}

/**
 * Solver-id box lookup (ported from fetch.ts:fetchSolverIdBox). Searches both
 * the reputation-proof (R5) and the false-contract (R4..R9) registers for the
 * solver id and returns the oldest matching box.
 */
export async function fetchSolverIdBox(solverId) {
  const id = (solverId || '').trim();
  if (!id) return null;
  const url = `${EXPLORER_API}/api/v1/boxes/search`;
  const unique = new Map();
  try {
    const repRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ergoTreeTemplateHash: getReputationProofTemplateHash(), registers: { R5: id } })
    });
    if (repRes.ok) for (const it of (await repRes.json()).items || []) unique.set(it.boxId, it);

    const registerKeys = ['R4', 'R5', 'R6', 'R7', 'R8', 'R9'];
    const falseTemplate = getTemplateHash('false');
    await Promise.all(
      registerKeys.map(async (rk) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ergoTreeTemplateHash: falseTemplate, registers: { [rk]: id } })
        });
        if (res.ok) for (const it of (await res.json()).items || []) unique.set(it.boxId, it);
      })
    );
    const boxes = [...unique.values()];
    if (boxes.length === 0) return null;
    return boxes.reduce((oldest, cur) => ((cur.creationHeight ?? Infinity) < (oldest.creationHeight ?? Infinity) ? cur : oldest));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Game phase snapshot (pure — ported from common/game-phase.ts deriveGamePhaseSnapshot)
// ─────────────────────────────────────────────────────────────────────────────
const GameUiSubphase = {
  STRATEGY_UPLOAD: 'strategy_upload',
  SEED_LOCKDOWN: 'seed_lockdown',
  PLAYING: 'playing',
  AWAITING_RESOLUTION: 'awaiting_resolution',
  SUSPENDED: 'suspended',
  JUDGING: 'judging',
  READY_TO_FINALIZE: 'ready_to_finalize',
  CANCELLED_LOCKED: 'cancelled_locked',
  CANCELLED_DRAINING: 'cancelled_draining',
  FINALIZED: 'finalized',
  UNKNOWN: 'unknown'
};

const PHASE_DEFINITIONS = {
  [GameUiSubphase.STRATEGY_UPLOAD]: { contractPhase: 'active', contractLabel: 'ACTIVE', label: 'Strategy & Upload', title: 'Strategy & Upload', description: 'The contract is still ACTIVE. Players can register or upload solver services, and anyone can continue adding randomness to the seed.' },
  [GameUiSubphase.SEED_LOCKDOWN]: { contractPhase: 'active', contractLabel: 'ACTIVE', label: 'Seed Lockdown', title: 'Seed Lockdown', description: 'The contract is still ACTIVE. Bot uploads are closed, but the ceremony is still open so anyone can make the seed more random before play begins.' },
  [GameUiSubphase.PLAYING]: { contractPhase: 'active', contractLabel: 'ACTIVE', label: 'Playing', title: 'Playing', description: 'The contract is still ACTIVE. The seed is fixed, and players can execute their bots and submit participations until the deadline.' },
  [GameUiSubphase.AWAITING_RESOLUTION]: { contractPhase: 'active', contractLabel: 'ACTIVE', label: 'Awaiting Resolution', title: 'Awaiting Resolution', description: 'The contract is still ACTIVE. Participation is closed and the creator must reveal the secret before the grace period expires to enter RESOLUTION.' },
  [GameUiSubphase.SUSPENDED]: { contractPhase: 'active', contractLabel: 'ACTIVE', label: 'Suspended', title: 'Suspended', description: 'The contract is still ACTIVE, but the creator missed the resolution window. Players can recover their funds and the game can no longer enter RESOLUTION.' },
  [GameUiSubphase.JUDGING]: { contractPhase: 'resolution', contractLabel: 'RESOLUTION', label: 'Judging', title: 'Judging', description: 'The contract is in RESOLUTION. The secret is revealed, scores are verifiable, and judges can validate or challenge the current winner candidate.' },
  [GameUiSubphase.READY_TO_FINALIZE]: { contractPhase: 'resolution', contractLabel: 'RESOLUTION', label: 'Ready to Finalize', title: 'Ready to Finalize', description: 'The contract is in RESOLUTION. The judge window is over and the game can be finalized so payouts are distributed.' },
  [GameUiSubphase.CANCELLED_LOCKED]: { contractPhase: 'cancelled', contractLabel: 'CANCELLED_DRAINING', label: 'Cancelled / Cooldown', title: 'Cancelled / Cooldown', description: 'The contract is in CANCELLED_DRAINING because the secret was revealed too early. Players can refund immediately and the next stake drain is still cooling down.' },
  [GameUiSubphase.CANCELLED_DRAINING]: { contractPhase: 'cancelled', contractLabel: 'CANCELLED_DRAINING', label: 'Cancelled / Draining', title: 'Cancelled / Draining', description: 'The contract is in CANCELLED_DRAINING because the secret was revealed too early. Players can refund immediately and the next stake drain is unlocked.' },
  [GameUiSubphase.FINALIZED]: { contractPhase: 'finalized', contractLabel: 'FINALIZED (derived)', label: 'Finalized', title: 'Finalized', description: 'The game lifecycle ended and payouts were already distributed. FINALIZED is a derived frontend state, not a fourth on-chain contract state.' },
  [GameUiSubphase.UNKNOWN]: { contractPhase: 'unknown', contractLabel: 'UNKNOWN', label: 'Unknown', title: 'Unknown', description: 'The current contract phase could not be derived.' }
};

export function deriveGamePhaseSnapshot(game, currentHeight) {
  if (!game) {
    return { currentHeight, openCeremony: false, openSolverSubmit: false, participationIsEnded: false, resolutionAllowed: false, gameSuspended: false, subphase: GameUiSubphase.UNKNOWN, ...PHASE_DEFINITIONS[GameUiSubphase.UNKNOWN] };
  }
  const c = GAME_CONSTANTS;
  const activeGame = game.status === GameState.Active ? game : null;
  const openCeremony = !!activeGame && currentHeight < activeGame.ceremonyDeadline;
  const openSolverSubmit = !!activeGame && currentHeight < activeGame.ceremonyDeadline - c.SEED_MARGIN;
  const participationIsEnded = game.status !== GameState.Active || currentHeight >= game.deadlineBlock;
  const resolutionAllowed = game.status === GameState.Active && currentHeight >= game.deadlineBlock && currentHeight < game.deadlineBlock + c.PARTICIPATION_GRACE_PERIOD;
  const gameSuspended = game.status === GameState.Active && currentHeight >= game.deadlineBlock + c.PARTICIPATION_GRACE_PERIOD;

  let subphase = GameUiSubphase.UNKNOWN;
  if (game.status === GameState.Finalized) subphase = GameUiSubphase.FINALIZED;
  else if (game.status === GameState.Cancelled_Draining) subphase = currentHeight >= game.unlockHeight ? GameUiSubphase.CANCELLED_DRAINING : GameUiSubphase.CANCELLED_LOCKED;
  else if (game.status === GameState.Resolution) subphase = currentHeight >= game.resolutionDeadline ? GameUiSubphase.READY_TO_FINALIZE : GameUiSubphase.JUDGING;
  else if (game.status === GameState.Active) {
    if (gameSuspended) subphase = GameUiSubphase.SUSPENDED;
    else if (participationIsEnded) subphase = GameUiSubphase.AWAITING_RESOLUTION;
    else if (openCeremony && openSolverSubmit) subphase = GameUiSubphase.STRATEGY_UPLOAD;
    else if (openCeremony) subphase = GameUiSubphase.SEED_LOCKDOWN;
    else subphase = GameUiSubphase.PLAYING;
  }
  return { currentHeight, openCeremony, openSolverSubmit, participationIsEnded, resolutionAllowed, gameSuspended, subphase, ...PHASE_DEFINITIONS[subphase] };
}

/** Convenience: fetch a game by id and return its live phase snapshot. */
export async function fetchGamePhase(gameId, currentHeight) {
  const game = await fetchGame(gameId);
  const height = typeof currentHeight === 'number' ? currentHeight : await getCurrentHeight();
  return { game, snapshot: deriveGamePhaseSnapshot(game, height) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Commitment helpers (pure — ported from common/commitment.ts)
// ─────────────────────────────────────────────────────────────────────────────
function bigintToLongByteArray(value) {
  const MIN = -(2n ** 63n);
  const MAX = 2n ** 63n - 1n;
  if (value < MIN || value > MAX) throw new Error(`Value ${value} out of range for signed 64-bit Long.`);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, value, false);
  return new Uint8Array(buf);
}

export function computeCommitmentHex(solverIdHex, seedHex, score, hashLogsHex, ergoTreeHex, secretHex) {
  const solverIdBytes = hexToBytes(solverIdHex);
  const seedBytes = hexToBytes(seedHex);
  const hashLogsBytes = hexToBytes(hashLogsHex);
  const ergoTreeBytes = hexToBytes(ergoTreeHex);
  const secretBytes = hexToBytes(secretHex);
  if (!solverIdBytes || !seedBytes || !hashLogsBytes || !ergoTreeBytes || !secretBytes) return null;
  const scoreBytes = bigintToLongByteArray(BigInt(score));
  const data = new Uint8Array([...solverIdBytes, ...seedBytes, ...scoreBytes, ...hashLogsBytes, ...ergoTreeBytes, ...secretBytes]);
  return uint8ArrayToHex(blake2b256(data));
}

export function findMatchingScoreForCommitment(params) {
  const { declaredCommitmentHex, solverIdHex, seedHex, scoreList, hashLogsHex, ergoTreeHex, secretHex } = params;
  if (!declaredCommitmentHex) return { isValid: false, matchedScore: null, expectedCommitmentHex: null, computedCommitmentHex: null, reason: 'missing_declared_commitment' };
  if (!solverIdHex || !seedHex || !hashLogsHex || !ergoTreeHex || !secretHex) return { isValid: false, matchedScore: null, expectedCommitmentHex: declaredCommitmentHex, computedCommitmentHex: null, reason: 'incomplete' };
  if (!scoreList || !Array.isArray(scoreList) || scoreList.length === 0) return { isValid: false, matchedScore: null, expectedCommitmentHex: declaredCommitmentHex, computedCommitmentHex: null, reason: 'empty_scores' };
  const expected = declaredCommitmentHex.toLowerCase();
  for (const score of scoreList) {
    const computed = computeCommitmentHex(solverIdHex, seedHex, BigInt(score), hashLogsHex, ergoTreeHex, secretHex);
    if (computed === null) return { isValid: false, matchedScore: null, expectedCommitmentHex: declaredCommitmentHex, computedCommitmentHex: null, reason: 'invalid_hex' };
    if (computed.toLowerCase() === expected) return { isValid: true, matchedScore: score.toString(), expectedCommitmentHex: declaredCommitmentHex, computedCommitmentHex: computed, reason: 'matched' };
  }
  return { isValid: false, matchedScore: null, expectedCommitmentHex: declaredCommitmentHex, computedCommitmentHex: null, reason: 'no_match' };
}
