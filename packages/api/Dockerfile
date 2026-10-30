## base #############################################################################################
FROM oven/bun:1.4.4-alpine AS base

WORKDIR /app

COPY bun.lock bunfig.toml mise.toml package.json nx.json .prettierrc .prettierignore tsconfig.base.json ./
COPY patches ./patches
COPY packages/common-utils/package.json ./packages/common-utils/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/app/package.json ./packages/app/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/hdx-eval/package.json ./packages/hdx-eval/package.json
COPY packages/otel-collector/package.json ./packages/otel-collector/package.json
RUN --mount=type=cache,target=/root/.bun/install/cache,id=bun-cache bun ci


## dev #############################################################################################

FROM base AS dev

COPY ./packages/common-utils ./packages/common-utils

EXPOSE 8000

ENTRYPOINT ["bun", "--bun", "x", "nx", "run", "@hyperdx/api:dev"]


## common-utils-builder ############################################################################
# Separate stage so common-utils build is cached independently of API source changes.

FROM base AS common-utils-builder

COPY ./packages/common-utils ./packages/common-utils
RUN bun run --cwd packages/common-utils build


## builder #########################################################################################

FROM base AS builder

# Copy pre-built common-utils from its dedicated build stage
COPY --from=common-utils-builder /app/packages/common-utils ./packages/common-utils

COPY ./packages/api ./packages/api
RUN bun run --cwd packages/api build
RUN rm -rf node_modules packages/*/node_modules && bun install --frozen-lockfile --production --filter @hyperdx/api && mkdir -p packages/api/node_modules packages/common-utils/node_modules


## prod ############################################################################################

FROM oven/bun:1.4.4-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX API" \
      org.opencontainers.image.description="HyperDX API service for observability platform" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV OTEL_RESOURCE_ATTRIBUTES="service.version=$CODE_VERSION"
ENV NODE_ENV production

ARG PORT=8000

ENV PORT=$PORT

EXPOSE ${PORT}

USER bun

WORKDIR /app

COPY --chown=bun:bun --from=builder /app/node_modules ./node_modules
COPY --chown=bun:bun --from=builder /app/packages/api/build ./packages/api/build
COPY --chown=bun:bun --from=builder /app/packages/api/bin ./packages/api/bin
COPY --chown=bun:bun --from=builder /app/packages/api/package.json ./packages/api/package.json
COPY --chown=bun:bun --from=builder /app/packages/api/node_modules ./packages/api/node_modules
COPY --chown=bun:bun --from=builder /app/packages/common-utils/dist ./packages/common-utils/dist
COPY --chown=bun:bun --from=builder /app/packages/common-utils/package.json ./packages/common-utils/package.json
COPY --chown=bun:bun --from=builder /app/packages/common-utils/node_modules ./packages/common-utils/node_modules

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD bun -e "fetch('http://localhost:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./packages/api/bin/hyperdx", "api"]
