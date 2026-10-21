# syntax=docker/dockerfile:1
# Frontend image: static build served by nginx (unprivileged, port 8080). /api/* is proxied
# to the server, so the browser talks to one origin. VITE_* values are PUBLIC: they end up in
# the JavaScript every visitor downloads, so only the chain id and contract address go here.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_CHAIN_ID
ARG VITE_STAKING_ADDRESS
RUN if [ -z "$VITE_CHAIN_ID" ] || [ -z "$VITE_STAKING_ADDRESS" ]; then \
      echo "build args VITE_CHAIN_ID and VITE_STAKING_ADDRESS are required" >&2; exit 1; fi
RUN npm test && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:8080/ || exit 1
