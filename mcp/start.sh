#!/bin/sh
# Celaut init entrypoint. The microVM init runs this script (declared in
# .service/service.json -> init.entry_path); Docker CMD/ENTRYPOINT are ignored by
# the packer. Starts the web (8080), REST (8081) and MCP Streamable HTTP (8082)
# servers, one per api slot. The declared envs (GOP_*, ERGO_*) reach this
# process as real environment variables; GOP_SIGNER_MODE defaults to 'unsigned'
# (no key in the VM).
export GOP_WEB_DIR=/app/web
exec node /app/mcp/server-http.mjs
