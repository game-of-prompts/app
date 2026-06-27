// Node-safe stub for `$lib/ergo/platform` (the SvelteKit ErgoPlatform), aliased
// in by mcp/build.mjs.
//
// The library's read code (`src/lib/ergo/fetch.ts`) attaches `platform: new
// ErgoPlatform()` to every game object, and `src/lib/common/game.ts` types its
// `platform` field as `ErgoPlatform`. The REAL ErgoPlatform (`src/lib/ergo/
// platform.ts`) wires the ENTIRE browser write surface — every `actions/*`
// transaction builder plus the Nautilus `ergo` dApp connector and the browser
// `reputation-system` entry (Svelte components). None of that is needed to READ
// the chain, and dragging it in would pull the giant browser tx-builder graph we
// keep external. So the headless surface substitutes this inert placeholder: the
// read functions still run unchanged, and the (unused) `platform` field is
// stripped from results by mcp/core.mjs before returning. The signer-backed
// WRITES live in mcp/writes.mjs (reputation opinions), not here.
export class ErgoPlatform {
  constructor() {
    this.id = 'ergo';
    this.main_token = 'ERG';
  }
}
export default ErgoPlatform;
