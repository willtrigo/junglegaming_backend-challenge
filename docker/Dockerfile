# syntax=docker/dockerfile:1.26

# =============================================================================
# Build arguments
# =============================================================================
ARG ALPINE_VERSION=1.4.2

# =============================================================================
# Stage: base
# =============================================================================
FROM oven/bun:${ALPINE_VERSION}-alpine AS base
WORKDIR /app

# =============================================================================
# deps: full dependency tree (dev + prod), cached on manifest changes only
# =============================================================================
FROM base AS deps
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
 
# =============================================================================
# prod-deps: production dependencies only
# =============================================================================
FROM base AS prod-deps
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production
 
# =============================================================================
# development: hot reload, source is bind-mounted by docker-compose
# =============================================================================
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev"]
 
# =============================================================================
# verify: static gates (types + lint). Fails the build on any violation.
# =============================================================================
FROM development AS verify
RUN bun run typecheck && bun run lint
 
# =============================================================================
# production: minimal, non-root, no dev tooling
# =============================================================================
FROM base AS production
ENV NODE_ENV=production
COPY --from=prod-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json tsconfig.json bunfig.toml ./
COPY --chown=bun:bun src ./src
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health/live" > /dev/null || exit 1

CMD ["bun", "run", "start"]
