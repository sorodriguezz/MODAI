FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build && npm test && npm prune --omit=dev

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MODAI_HOST=0.0.0.0 \
    MODAI_PORT=8787 \
    MODAI_DATABASE_PATH=/app/data/modularai.db \
    MODAI_ARTIFACT_DIR=/app/artifacts
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node examples ./examples
RUN mkdir -p /app/data /app/artifacts && chown -R node:node /app/data /app/artifacts
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "dist/src/server.js"]
