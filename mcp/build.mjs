#!/usr/bin/env node
/**
 * Bundle the Game of Prompts READ + CONTRACT surface from the library's own
 * TypeScript source (`src/lib/ergo/*`, `src/lib/common/*`) into ONE
 * Node-loadable ESM module:
 *
 *     mcp/_generated/lib.bundle.mjs
 *
 * Run: `npm run build:mcp`  (or `node mcp/build.mjs`).
 *
 * Why a build step instead of a hand-port: the reads + the contract compilation
 * live in SvelteKit `.ts` files that import `.es?raw` contract sources, the
 * browser `ErgoPlatform`, dev-mode helpers, svelte stores, and the Svelte entry
 * of `reputation-system`. esbuild compiles the TS, INLINES the `.es` sources via
 * a text loader and our pure deps (@fleet-sdk/*, @scure/*, svelte/store), and
 * rewrites the browser-only edges so the SAME `src` logic runs headless — no
 * second copy of the read/contract logic to drift (the old 1k-line
 * mcp/core.mjs hand-port is gone).
 *
 * Aliases / externals:
 *   - `reputation-system`        → _stubs/reputation-system.mjs, which re-exports
 *                                  the read helpers from `reputation-system/node`
 *                                  (kept EXTERNAL, same package writes.mjs uses),
 *                                  plus `calculate_reputation` and the two
 *                                  ErgoScript SOURCE strings `contract.ts` compiles.
 *   - `reputation-system/node`   → EXTERNAL (resolved from node_modules at runtime).
 *   - `$lib/ergo/platform`       → _stubs/platform.mjs (inert ErgoPlatform; the
 *                                  browser write graph is not needed to read).
 *   - `$lib/dev/dev-competitions`→ _stubs/dev-competitions.mjs (no-ops; prod mode
 *                                  never takes the dev paths).
 *   - `$lib/*`                   → ../src/lib/* (the SvelteKit path alias).
 *   - `*.es?raw` / `*.es`        → text loader (the contract sources inline into
 *                                  the bundle, so no contracts/ copy is needed in
 *                                  mcp/ or .service/).
 *   Everything else (our src, @fleet-sdk/*, @scure/*, svelte/store) is inlined,
 *   so the bundle is self-contained apart from `reputation-system/node`.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const r = (p) => resolve(here, p);

// Resolve the browser-only edges with EXACT-match onResolve hooks rather than
// esbuild's `alias` map: `alias` remaps every subpath of a package, which would
// also rewrite the stub's OWN deep imports (e.g. `reputation-system/dist/...`).
// Exact filters touch only the bare specifier and leave subpaths alone.
//
//   - `reputation-system`       (bare) → _stubs/reputation-system.mjs
//   - `reputation-system/node`         → EXTERNAL (resolved at runtime; the SAME
//                                        package writes.mjs / lib.mjs use — no drift)
//   - `$lib/ergo/platform`             → _stubs/platform.mjs (inert ErgoPlatform)
//   - `$lib/dev/dev-competitions`      → _stubs/dev-competitions.mjs (no-ops)
const browserEdges = {
  name: 'gop-browser-edges',
  setup(b) {
    b.onResolve({ filter: /^reputation-system\/node$/ }, () => ({
      path: 'reputation-system/node',
      external: true
    }));
    b.onResolve({ filter: /^reputation-system$/ }, () => ({
      path: r('_stubs/reputation-system.mjs')
    }));
    b.onResolve({ filter: /^\$lib\/ergo\/platform$/ }, () => ({
      path: r('_stubs/platform.mjs')
    }));
    // fetch.ts reaches the same module by RELATIVE path (`./platform`); redirect
    // it too, but only when imported from inside src/lib/ergo/ (so the distinct
    // `$lib/common/platform` interface is untouched).
    b.onResolve({ filter: /^\.\/platform$/ }, (args) =>
      args.importer.replace(/\\/g, '/').includes('/src/lib/ergo/')
        ? { path: r('_stubs/platform.mjs') }
        : undefined
    );
    b.onResolve({ filter: /^\$lib\/dev\/dev-competitions$/ }, () => ({
      path: r('_stubs/dev-competitions.mjs')
    }));
    b.onResolve({ filter: /^(source|forum)-application$/ }, () => ({
      path: r('_stubs/sibling-apps.mjs')
    }));
    b.onResolve({ filter: /^\$app\/paths$/ }, () => ({
      path: r('_stubs/app-paths.mjs')
    }));
    // The stub deep-imports `reputation-system/dist/*` (the pure
    // calculate_reputation util + the two `.es.js` ErgoScript source strings).
    // The package's `exports` map only exposes `.` and `./node`, so resolve those
    // deep paths to absolute files under node_modules to bypass the restriction.
    // (Registered AFTER the `/node` + bare hooks so they take precedence.)
    b.onResolve({ filter: /^reputation-system\// }, (args) => ({
      path: r(`node_modules/${args.path}`)
    }));
  }
};

// Inline the `.es` ErgoScript contract sources as text. `contract.ts` imports
// them with Vite's `?raw` suffix (e.g. `../../../contracts/game_active.es?raw`);
// esbuild does not understand `?raw`, so strip it, resolve the real path, and
// hand the file to the `text` loader. This is also why no `contracts/` copy is
// needed in mcp/ or .service/ — the sources are baked into the bundle.
const esRawLoader = {
  name: 'es-raw-loader',
  setup(b) {
    b.onResolve({ filter: /\.es\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
      namespace: 'es-text'
    }));
    b.onLoad({ filter: /.*/, namespace: 'es-text' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text'
    }));
  }
};

await build({
  entryPoints: [r('_entry.mjs')],
  outfile: r('_generated/lib.bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  legalComments: 'none',
  loader: { '.es': 'text' },
  // Keep the @fleet-sdk family EXTERNAL (resolved from node_modules at runtime):
  //   - @fleet-sdk/compiler is the full ErgoScript compiler — inlining it both
  //     bloats the bundle to tens of MB AND breaks under ESM (it does a dynamic
  //     `require("crypto")`). External, it loads as a normal Node module.
  //   - core/crypto/serializer are the SAME packages reputation-system/node uses
  //     at runtime, so keeping them external means one shared instance (no drift),
  //     mirroring how `reputation-system/node` itself is kept external.
  // They are declared as runtime deps in mcp/package.json and .service/package.json.
  external: ['@fleet-sdk/*'],
  banner: {
    js: '// AUTO-GENERATED by mcp/build.mjs from src/lib/{ergo,common}/*. Do not edit by hand.\n// Regenerate with: npm run build:mcp'
  },
  alias: {
    $lib: r('../src/lib')
  },
  plugins: [browserEdges, esRawLoader]
});

console.log('Built mcp/_generated/lib.bundle.mjs');
