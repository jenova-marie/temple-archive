# syntax=docker/dockerfile:1.4

# RecoverySky Agent - Multi-stage Alpine build
#
# Build with npmrc secret for private registry:
#   DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=$HOME/.npmrc -t recoverysky-agent .
#
# Or via compose:
#   docker-compose -f opt/docker-compose.yml build

# =============================================================================
# Stage 1: Base with pnpm
# =============================================================================
FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

# =============================================================================
# Stage 2: Dependencies
# =============================================================================
FROM base AS deps

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./

# Copy all package.json files for workspace resolution
COPY packages/types/package.json ./packages/types/
COPY packages/observability/package.json ./packages/observability/
COPY packages/db/package.json ./packages/db/
COPY packages/memory/package.json ./packages/memory/
COPY packages/crisis/package.json ./packages/crisis/
COPY packages/safety/package.json ./packages/safety/
COPY packages/agent/package.json ./packages/agent/
COPY packages/evaluation/package.json ./packages/evaluation/
COPY packages/tools/package.json ./packages/tools/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY packages/cli/package.json ./packages/cli/
COPY apps/api/package.json ./apps/api/

# Install dependencies with cache mount and npmrc secret for private registry
RUN --mount=type=cache,target=/root/.pnpm-store \
    --mount=type=secret,id=npmrc,target=/root/.npmrc \
    cp /root/.npmrc /app/.npmrc && \
    pnpm install --frozen-lockfile

# =============================================================================
# Stage 3: Builder
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/ ./packages/
COPY apps/ ./apps/

# Build all packages
RUN pnpm build:all

# =============================================================================
# Stage 4: Production
# =============================================================================
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# Add non-root user
RUN addgroup -g 1001 -S recoverysky && \
    adduser -S recoverysky -u 1001 -G recoverysky

WORKDIR /app

# Copy package files for pnpm workspace
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Copy all package.json files
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/memory/package.json ./packages/memory/
COPY --from=builder /app/packages/crisis/package.json ./packages/crisis/
COPY --from=builder /app/packages/safety/package.json ./packages/safety/
COPY --from=builder /app/packages/agent/package.json ./packages/agent/
COPY --from=builder /app/packages/evaluation/package.json ./packages/evaluation/
COPY --from=builder /app/packages/tools/package.json ./packages/tools/
COPY --from=builder /app/packages/pipeline/package.json ./packages/pipeline/
COPY --from=builder /app/packages/cli/package.json ./packages/cli/
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Copy npmrc for production install
COPY --from=deps /app/.npmrc ./

# Install production dependencies with cache mount
RUN --mount=type=cache,target=/root/.pnpm-store \
    pnpm install --prod --frozen-lockfile && \
    rm -f .npmrc

# Copy built artifacts
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/memory/dist ./packages/memory/dist
COPY --from=builder /app/packages/crisis/dist ./packages/crisis/dist
COPY --from=builder /app/packages/safety/dist ./packages/safety/dist
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/evaluation/dist ./packages/evaluation/dist
COPY --from=builder /app/packages/tools/dist ./packages/tools/dist
COPY --from=builder /app/packages/pipeline/dist ./packages/pipeline/dist
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Set ownership
RUN chown -R recoverysky:recoverysky /app

USER recoverysky

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
