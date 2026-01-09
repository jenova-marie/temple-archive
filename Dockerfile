# syntax=docker/dockerfile:1.4

# Pippa Agent & Web - Multi-stage Alpine build
#
# Build with npmrc secret for private registry:
#   DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=$HOME/.npmrc -t pippa-agent .
#   DOCKER_BUILDKIT=1 docker build --secret id=npmrc,src=$HOME/.npmrc --target web -t pippa-web .
#
# Or via compose:
#   docker-compose build

# =============================================================================
# Stage 1: Base with pnpm
# =============================================================================
FROM node:22-bookworm AS base

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
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/mem0/package.json ./packages/mem0/
COPY apps/agent-api/package.json ./apps/agent-api/
COPY apps/web-api/package.json ./apps/web-api/
COPY apps/web-app/package.json ./apps/web-app/

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

# Build all packages EXCEPT web-app (web-app is built separately in web-app-builder with AGENT_API_PORT)
RUN pnpm -r --filter '!@pippa/web-app' build

# =============================================================================
# Stage 4: Web Builder (separate stage for web-specific build)
# =============================================================================
FROM deps AS web-app-builder

# Build arguments from docker-compose or docker build - REQUIRED
ARG AGENT_API_PORT
ENV AGENT_API_PORT=${AGENT_API_PORT}

# Copy source code
COPY packages/ ./packages/
COPY apps/ ./apps/

# Copy build.env to .env for Vite to pick up during build
RUN cp apps/web-app/build.env apps/web-app/.env

# Build shared package first, then web app
RUN pnpm --filter @pippa/shared build && \
    pnpm --filter @pippa/web-app build

# =============================================================================
# Stage 5: Agent Production
# =============================================================================
FROM node:22-bookworm AS agent-api

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# Add non-root user
RUN groupadd -g 1001 pippa && \
    useradd -u 1001 -g pippa -s /sbin/nologin -M pippa

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
COPY --from=builder /app/packages/config/package.json ./packages/config/
COPY --from=builder /app/packages/mem0/package.json ./packages/mem0/
COPY --from=builder /app/apps/agent-api/package.json ./apps/agent-api/

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
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/mem0/dist ./packages/mem0/dist
COPY --from=builder /app/apps/agent-api/dist ./apps/agent-api/dist

# Set ownership
RUN chown -R pippa:pippa /app

USER pippa

ENV NODE_ENV=production
ENV PORT=61664
ENV ZITADEL_ISSUER=https://auth.rso
ENV ZITADEL_AUDIENCE=352079658088464386
ENV ZITADEL_PROJECT_ID=352079615960809474
ENV ZITADEL_CLIENT_ID=352079658088464386

EXPOSE 61664

CMD ["node", "apps/agent-api/dist/index.js"]

# =============================================================================
# Stage 6: Web API Production
# =============================================================================
FROM node:22-bookworm AS web-api

RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

# Add non-root user
RUN groupadd -g 1001 pippa && \
    useradd -u 1001 -g pippa -s /sbin/nologin -M pippa

WORKDIR /app

# Copy package files for pnpm workspace
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Copy all package.json files
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/web-api/package.json ./apps/web-api/

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
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/web-api/dist ./apps/web-api/dist

# Set ownership
RUN chown -R pippa:pippa /app

USER pippa

ENV NODE_ENV=production
ENV PORT=61665

EXPOSE 61665

CMD ["node", "apps/web-api/dist/index.js"]

# =============================================================================
# Stage 7: Web Production (nginx)
# =============================================================================
FROM nginx:alpine AS web-app

# Copy nginx configuration
COPY apps/web-app/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built web assets
COPY --from=web-app-builder /app/apps/web-app/dist /usr/share/nginx/html

# Add non-root user support
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
