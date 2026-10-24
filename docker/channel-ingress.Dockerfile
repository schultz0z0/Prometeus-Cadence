FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app
COPY docker/channel-ingress/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/channel-ingress.ts ./scripts/channel-ingress.ts
COPY src/domain ./src/domain
COPY src/server/errors.ts ./src/server/errors.ts
COPY src/server/channels/crypto.ts src/server/channels/ingress-db.ts src/server/channels/ingress-contracts.ts ./src/server/channels/
COPY src/server/channels/openwa ./src/server/channels/openwa
ENV NODE_ENV=production
USER node
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD ["node","-e","fetch('http://127.0.0.1:3214/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","--conditions=react-server","--experimental-strip-types","scripts/channel-ingress.ts"]
