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
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/frontend/package.json ./apps/frontend/
RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/frontend/ ./apps/frontend/

WORKDIR /app/apps/frontend
ENV NEXT_TELEMETRY_DISABLED=1

# Build args for NEXT_PUBLIC_ variables (baked into Next.js at build time)
ARG NEXT_PUBLIC_API_BASE_URL=
ARG BACKEND_ORIGIN=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN

RUN pnpm build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=nonroot:nonroot /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nonroot:nonroot /app/apps/frontend/public ./apps/frontend/public
USER nonroot
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/frontend/server.js"]
