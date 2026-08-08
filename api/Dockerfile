FROM node:20-bookworm-slim AS build
WORKDIR /workspace/api
COPY api/package*.json ./
RUN npm install
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /workspace/api
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates bubblewrap && rm -rf /var/lib/apt/lists/*
COPY api/package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /workspace/api/dist ./dist
RUN useradd --create-home --uid 10001 gateway && mkdir -p /var/lib/model-gateway/codex-home /var/empty/model-gateway && chown -R gateway:gateway /var/lib/model-gateway /var/empty/model-gateway
USER gateway
EXPOSE 8000
CMD ["node", "dist/main.js"]
