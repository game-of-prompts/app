// Node-safe stub for SvelteKit's `$app/paths`, aliased in by mcp/build.mjs.
// `src/lib/ergo/utils.ts` imports `{ base }` (the app's base path) for building
// browser asset URLs. Headless there is no base path, so it is the empty string.
export const base = '';
export const assets = '';
