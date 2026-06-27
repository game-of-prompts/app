# Celaut builds this image only to export its filesystem (docker buildx
# --output type=tar); the container is never run directly. CMD/ENTRYPOINT,
# EXPOSE and runtime ENV are intentionally omitted — the entrypoint, ports and
# envs are declared in service.json. Relative ./ COPY paths are auto-adjusted
# to service/... by the packer when this Dockerfile is moved into .service/.
FROM node:20-slim

WORKDIR /app

# Production deps only (better layer caching: deps before source).
COPY ./package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund

# Application: HTTP+REST MCP server + shared registry core/lib/writes/tools +
# the compiled-from-source game contracts + init wrapper.
COPY ./server-http.mjs /app/server-http.mjs
COPY ./core.mjs /app/core.mjs
COPY ./lib.mjs /app/lib.mjs
COPY ./writes.mjs /app/writes.mjs
COPY ./tools.mjs /app/tools.mjs
COPY ./contracts /app/contracts
COPY ./start.sh /app/start.sh
RUN chmod +x /app/start.sh
