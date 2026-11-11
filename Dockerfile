# Vendor-owned scripts remain a pinned upstream dependency, NOT a fork.
FROM alpine/git:latest AS skill-source
ARG CRYPTO_SKILL_SHA=92e80c5527312d0acdf769f16511ba3c6db1f2fe
RUN git init -q /vendor \
 && git -C /vendor remote add origin https://github.com/crypto-com/crypto-agent-trading.git \
 && git -C /vendor fetch -q --depth=1 origin "$CRYPTO_SKILL_SHA" \
 && git -C /vendor checkout -q --detach FETCH_HEAD \
 && test "$(git -C /vendor rev-parse HEAD)" = "$CRYPTO_SKILL_SHA"

FROM node:lts-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.ts ./
COPY --from=skill-source /vendor/crypto-com-app ./upstream/crypto-com-app
COPY --from=skill-source /vendor/LICENSE ./upstream/LICENSE
USER node
EXPOSE 8185
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:8185/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["./node_modules/.bin/tsx","server.ts"]
LABEL org.opencontainers.image.source=https://github.com/GodsQuantum/Cloud9-CryptoComApp-MCP \
      org.opencontainers.image.vendor.source=https://github.com/crypto-com/crypto-agent-trading \
      com.cloud9.builder=GitHub-Actions
