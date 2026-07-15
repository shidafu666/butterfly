ARG BUILD_IMAGE=mcr.azure.cn/devcontainers/javascript-node:20-bookworm
ARG NODE_IMAGE=mcr.azure.cn/azurelinux/base/nodejs:20.14
FROM ${BUILD_IMAGE} AS base
ENV npm_config_build_from_source=true
ENV npm_config_nodedir=/usr/local
RUN npm install -g pnpm@9.15.9

FROM base AS builder
WORKDIR /app
COPY .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY apps/ingestion-worker/package.json ./apps/ingestion-worker/
RUN pnpm install --frozen-lockfile

COPY packages/tsconfig/ ./packages/tsconfig/
COPY apps/ingestion-worker/ ./apps/ingestion-worker/

WORKDIR /app/apps/ingestion-worker
RUN pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ingestion-worker/dist ./dist
CMD ["node", "dist/main.js"]
