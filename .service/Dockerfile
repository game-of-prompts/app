# Celaut builds this image only to export its filesystem (buildctl --output
# type=tar); the container is never run. CMD/ENTRYPOINT, EXPOSE and runtime ENV
# are intentionally omitted — the entrypoint, ports, envs and networks are
# declared in service.json.
#
# Build context is .service/, with the project files (pack_config.json
# `include`) under service/. The packer rewrites every COPY source that starts
# with `.` to `service/...`, so project paths MUST be written `./mcp/...`; a bare
# `mcp/...` is not rewritten and does not exist in the context (nodo
# docs/PACKING.md, "COPY Path Adjustment").
#
# Layout in the image:
#   /app/mcp/...        server-http.mjs + the shared registry + prebuilt bundle
#   /app/node_modules   production deps of mcp/package.json (lockfile)
#   /app/web            the static web app (SvelteKit adapter-static build)

# ── Web app: static build served at the root (BASE_PATH empty) ───────────────
FROM node:22-alpine AS web
RUN apk add --no-cache git
WORKDIR /build
COPY ./package.json ./package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ./svelte.config.js ./vite.config.ts ./tsconfig.json ./tailwind.config.ts ./postcss.config.js ./components.json ./
COPY ./src ./src
COPY ./static ./static
COPY ./contracts ./contracts
# The default 4 GB heap is not enough for this build.
RUN BASE_PATH= NODE_OPTIONS=--max-old-space-size=6144 npx vite build

# ── Dependencies: needs git for the github: dep (reputation-system) ─────────
FROM node:22-alpine AS deps
RUN apk add --no-cache git
WORKDIR /build
COPY ./mcp/package.json ./mcp/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime filesystem: node + deps + the service, no git/npm cache ─────────
FROM node:22-alpine
WORKDIR /app
COPY --from=deps /build/node_modules /app/node_modules
COPY --from=web /build/build /app/web

# The prebuilt _generated/lib.bundle.mjs inlines the contracts/*.es sources, so
# no contracts/ copy and no build toolchain are needed. build.mjs, _entry.mjs,
# _stubs and server.mjs (stdio) are build/dev-only and stay out.
COPY ./mcp/_generated /app/mcp/_generated
COPY ./mcp/core.mjs ./mcp/lib.mjs ./mcp/writes.mjs ./mcp/tools.mjs ./mcp/context.mjs /app/mcp/
COPY ./mcp/celaut.mjs ./mcp/server-http.mjs ./mcp/start.sh /app/mcp/
RUN chmod +x /app/mcp/start.sh
