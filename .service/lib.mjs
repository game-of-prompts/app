/**
 * Signer factory + reputation main-box helpers for the Game of Prompts MCP / `.service`.
 *
 * Game of Prompts' wireable writes are all reputation *opinions* (a creator
 * endorsement, a judge invalidation vote, etc.). Publishing them reuses the
 * reputation library's headless Node entry exactly like
 * `reputation-system/mcp/lib.mjs` and `source-application/mcp/lib.mjs`: a Signer
 * is built from the environment and passed to `create_opinion_with_signer` /
 * `create_profile_with_signer`.
 *
 * The three-signer structure (NautilusSigner stays in the browser app; the
 * MCP/service only ever needs seed | unsigned):
 *
 *   GOP_SIGNER_MODE=seed      – sign + submit autonomously with a mnemonic.
 *     GOP_MNEMONIC   (required)  BIP-39 mnemonic of the publishing wallet.
 *     GOP_MNEMONIC_PASSWORD     optional BIP-39 passphrase.
 *     GOP_NODE_URI              Ergo node for submission (default :9053).
 *     GOP_ADDRESS_INDEX         change-path index (default 0).
 *
 *   GOP_SIGNER_MODE=unsigned  – build only; return the unsigned EIP-12 tx for an
 *                               external wallet to sign. No key in the agent. (default)
 *     GOP_ADDRESS    (required)  the P2PK address whose UTXOs fund the tx.
 *
 * NOTE on derivation: SeedSigner derives with @scure (standard BIP-39/32) so it
 * signs from the SAME address Nautilus would for a given mnemonic. The reference
 * SeedSigner in `reputation-system/node` already does this correctly — it is
 * reused here, never re-rolled.
 */
import { SeedSigner, UnsignedSigner } from 'reputation-system/node';

export const EXPLORER_API = process.env.GOP_EXPLORER_API || 'https://api.ergoplatform.com';

export function signerMode() {
  return (process.env.GOP_SIGNER_MODE || 'unsigned').toLowerCase();
}

export function makeSigner() {
  const mode = signerMode();
  if (mode === 'seed') {
    const mnemonic = process.env.GOP_MNEMONIC;
    if (!mnemonic) throw new Error('GOP_SIGNER_MODE=seed requires GOP_MNEMONIC.');
    return new SeedSigner({
      mnemonic,
      password: process.env.GOP_MNEMONIC_PASSWORD,
      addressIndex: process.env.GOP_ADDRESS_INDEX ? Number(process.env.GOP_ADDRESS_INDEX) : 0,
      explorerUri: EXPLORER_API,
      nodeUri: process.env.GOP_NODE_URI
    });
  }
  if (mode === 'unsigned') {
    const address = process.env.GOP_ADDRESS;
    if (!address) throw new Error('GOP_SIGNER_MODE=unsigned requires GOP_ADDRESS.');
    return new UnsignedSigner({ address, explorerUri: EXPLORER_API });
  }
  throw new Error(`Unknown GOP_SIGNER_MODE: ${mode} (expected 'seed' or 'unsigned').`);
}

/**
 * Fetch a reputation-proof box by id and shape it into the RPBox `main_box` that
 * `create_opinion_with_signer` consumes. R4 (rendered) is its Type NFT id, which
 * the contract requires as a data input. For Game of Prompts writes this is the
 * author's reputation PROFILE box (the box holding their reputation tokens,
 * typically a JUDGE profile). Mirrors source-application/mcp/lib.mjs:fetchMainBox.
 */
export async function fetchMainBox(mainBoxId) {
  if (!/^[0-9a-fA-F]{64}$/.test(mainBoxId || '')) {
    throw new Error(`mainBoxId must be a 64-char hex box id (got: ${mainBoxId}).`);
  }
  const res = await fetch(`${EXPLORER_API}/api/v1/boxes/${mainBoxId}`);
  if (!res.ok) throw new Error(`Failed to fetch main box ${mainBoxId}: HTTP ${res.status}`);
  const box = await res.json();

  const reputationTokenId = box?.assets?.[0]?.tokenId;
  if (!reputationTokenId) {
    throw new Error(`Box ${mainBoxId} holds no reputation token; not a valid main box.`);
  }

  return {
    box: {
      boxId: box.boxId,
      value: box.value.toString(),
      assets: (box.assets ?? []).map((a) => ({ tokenId: a.tokenId, amount: a.amount.toString() })),
      ergoTree: box.ergoTree,
      creationHeight: box.creationHeight,
      additionalRegisters: Object.entries(box.additionalRegisters ?? {}).reduce((acc, [k, v]) => {
        acc[k] = v.serializedValue;
        return acc;
      }, {}),
      index: box.index ?? 0,
      transactionId: box.transactionId
    },
    box_id: box.boxId,
    type: { tokenId: box?.additionalRegisters?.R4?.renderedValue || '' },
    token_id: reputationTokenId,
    token_amount: Number(box.assets[0].amount),
    object_pointer: box?.additionalRegisters?.R5?.renderedValue || '',
    is_locked: box?.additionalRegisters?.R6?.renderedValue === 'true',
    polarization: box?.additionalRegisters?.R8?.renderedValue === 'true',
    content: {}
  };
}

/** Normalize a SignerResult into an MCP/REST-friendly payload. */
export function describeResult(result) {
  if (result.kind === 'submitted') {
    return { submitted: true, txId: result.txId };
  }
  return {
    submitted: false,
    unsignedTransaction: result.transaction,
    note: 'Transaction built but not signed. Sign + submit with an external wallet (Nautilus/ErgoPay).'
  };
}
