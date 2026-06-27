#!/bin/sh
# Celaut init entrypoint. The microVM init runs this script (declared in
# service.json -> init.entry_path); Docker CMD/ENTRYPOINT are ignored by the
# packer. Bind the MCP (Streamable HTTP) + REST server on 0.0.0.0:8080 (PORT
# defaults to 8080 inside server-http.mjs). GOP_EXPLORER_API defaults to Ergo
# mainnet; GOP_SIGNER_MODE defaults to 'unsigned' (no key in the VM).
exec node /app/server-http.mjs
