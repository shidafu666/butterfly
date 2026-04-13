FROM node:20-alpine AS base
RUN npm install -g pnpm@9

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

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ingestion-worker/dist ./dist
CMD ["node", "dist/main.js"]
