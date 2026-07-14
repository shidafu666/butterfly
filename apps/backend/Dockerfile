ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@9
RUN apk add --no-cache openssl

FROM base AS builder
WORKDIR /app
# Copy everything needed for monorepo install
COPY .npmrc package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/backend/package.json ./apps/backend/
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/ ./packages/
COPY apps/backend/ ./apps/backend/

# Generate Prisma client and build
WORKDIR /app/apps/backend
RUN pnpm prisma:generate
RUN pnpm build

FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache openssl
WORKDIR /app
# With node-linker=hoisted, all packages are in root node_modules (no symlinks)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
EXPOSE 3001
CMD ["node", "dist/main.js"]
