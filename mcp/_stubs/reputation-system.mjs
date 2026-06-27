// Node-safe shim for the bare `reputation-system` import, aliased in by
// mcp/build.mjs.
//
// In the browser app, `import ... from "reputation-system"` resolves to the
// package's Svelte entry (`dist/index.js`), which re-exports Svelte components
// and is NOT loadable in bare Node. The headless surface needs only four kinds
// of symbol from it, so this shim sources each from a Node-safe path:
//
//   1. The on-chain read helpers (searchBoxes / fetchAllProfiles / fetchTypeNfts
//      / convertToRPBox) — re-exported from `reputation-system/node`, which is
//      kept EXTERNAL by mcp/build.mjs so reads resolve the SAME installed package
//      that writes.mjs/lib.mjs use at runtime (no drift).
//   2. `calculate_reputation` — the pure opinion-weight reducer the app uses to
//      annotate `game.reputation`; lives in the package's `dist/utils.js`, which
//      is a plain ESM module (inlined into the bundle).
//   3. The two ErgoScript SOURCE strings the app's `contract.ts` compiles
//      (`reputation_proof_contract`, `digital_public_good`) — shipped as plain
//      `dist/contracts/*.es.js` (`export default "<ergoscript>"`), inlined.
//
// Everything else the read graph references from `reputation-system` is a TYPE
// (RPBox / ReputationProof / TypeNFT / ApiBox), erased at compile time.
export {
  searchBoxes,
  fetchAllProfiles,
  fetchTypeNfts,
  convertToRPBox
} from 'reputation-system/node';

export { calculate_reputation } from 'reputation-system/dist/utils.js';

export { default as reputation_proof_contract } from 'reputation-system/dist/contracts/reputation_proof.es.js';
export { default as digital_public_good } from 'reputation-system/dist/contracts/digital_public_good.es.js';
