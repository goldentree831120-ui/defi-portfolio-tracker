# syntax=docker/dockerfile:1
# Server image: indexer + REST API, compiled to plain JavaScript, production dependencies
# only, running as the unprivileged `node` user. The `chain` target is a separate dev-only
# image (local Hardhat node + deploy script) used by compose.local.yaml.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run typecheck && npm run build

# Dev-only: a local Hardhat chain, and the script that deploys the contracts to it.
FROM deps AS chain
COPY . .
EXPOSE 8545
CMD ["node_modules/.bin/hardhat", "--config", "test/support/hardhat.config.cjs", "node", "--hostname", "0.0.0.0", "--port", "8545"]

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node is PID 1 and handles SIGTERM itself (src/main.ts): the in-flight batch commits or rolls back.
CMD ["node", "--enable-source-maps", "dist/main.js"]
