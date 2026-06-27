// Node-safe stub for the sibling Svelte packages `source-application` /
// `forum-application`, aliased in by mcp/build.mjs.
//
// `src/lib/ergo/utils.ts` imports `fetchFileSourcesByHash` from
// `source-application` solely for `fetchServiceDownloadUrl()` — a helper that is
// NOT reachable from the MCP's 26-tool read surface (no caller in the bundled
// graph), so esbuild tree-shakes it away. The two packages only ship a Svelte
// entry (not bare-Node loadable), so this inert stub lets the import resolve
// before that dead code is dropped. If a future tool needs cross-registry source
// lookups, replace this with the packages' own `/node` entry.
export const fetchFileSourcesByHash = async () => [];
