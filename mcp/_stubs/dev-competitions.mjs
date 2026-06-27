// Node-safe stub for `$lib/dev/dev-competitions`, aliased in by mcp/build.mjs.
//
// The library's `src/lib/ergo/fetch.ts` references the dev-competition helpers,
// but ONLY behind `isDevMode` guards (the in-browser developer toggle). The
// MCP / `.service` always runs in production mode (`isDevMode` is the default
// `false` writable, see envs.ts), so these code paths are never taken. The real
// module imports `$app/paths` and other browser-only bits, so we substitute
// inert no-ops to keep them out of the headless bundle. If a future surface
// needs dev competitions, drop this alias.
export const isDevCompetitionId = () => false;
export const buildDevCompetitionsMap = () => new Map();
export const getDevCompetition = () => null;
export const getDevCompetitionHistory = () => [];
export const getDevCompetitionParticipations = () => [];
