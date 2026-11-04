FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
COPY integration ./integration
COPY examples ./examples
RUN npm ci && npm run build && npm test

FROM node:26.13.0-bookworm-slim AS client
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/examples ./examples
USER node
CMD ["node", "dist/scripts/seed-examples.js"]

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MODAI_HOST=0.0.0.0 \
    MODAI_DATABASE_PATH=/app/data/modularai.db \
    MODAI_ARTIFACT_DIR=/app/artifacts
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY apps/server/package.json ./apps/server/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @modai/server --workspace @modai/contracts --workspace @modai/sdk --workspace @modai/core
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3/build ./node_modules/better-sqlite3/build
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build --chown=node:node /app/packages/core/dist ./packages/core/dist
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=node:node /app/apps/admin/dist ./apps/admin/dist
RUN mkdir -p /app/data /app/artifacts && chown -R node:node /app/data /app/artifacts
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MODAI_PORT||process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "apps/server/dist/entrypoint.js"]
