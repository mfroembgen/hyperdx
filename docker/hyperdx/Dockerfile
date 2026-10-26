# Starts several services in a single container
# For production build:
# - API (Bun)
# - App (Frontend)
# For all-in-one build:
# - Clickhouse
# - Mongo
# - Otel Collector (otelcol)

ARG BUN_VERSION=1.4.4
ARG CLICKHOUSE_VERSION=26.8
ARG OTEL_COLLECTOR_VERSION=0.155.0
ARG OTEL_COLLECTOR_CORE_VERSION=1.61.0

# base #############################################################################################
# == Otel Collector Image ==
FROM otel/opentelemetry-collector-opampsupervisor:${OTEL_COLLECTOR_VERSION} AS otel_collector_opampsupervisor_base
FROM kukymbr/goose-docker@sha256:0cd025636df126e7f66472861ca4db3683bc649be46cd1f6ef1a316209058e23 AS goose

# Build the custom HyperDX collector binary using OCB (OpenTelemetry Collector Builder).
# This replaces the pre-built otel/opentelemetry-collector-contrib image so we can
# include custom receiver/processor components alongside the standard contrib ones.
# Note: The official OCB image may ship an older Go than the contrib modules require,
# so we copy the ocb binary into a golang base with a newer toolchain.
FROM otel/opentelemetry-collector-builder:${OTEL_COLLECTOR_VERSION} AS ocb-bin
FROM golang:1.26-alpine AS ocb-builder
ARG OTEL_COLLECTOR_VERSION
ARG OTEL_COLLECTOR_CORE_VERSION
COPY --from=ocb-bin /usr/local/bin/ocb /usr/local/bin/ocb
WORKDIR /build
COPY packages/otel-collector/builder-config.yaml .
RUN --mount=type=cache,target=/go/pkg/mod,id=ocb-gomod \
    --mount=type=cache,target=/root/.cache/go-build,id=ocb-gobuild \
    sed -i "s/__OTEL_COLLECTOR_VERSION__/${OTEL_COLLECTOR_VERSION}/g; s/__OTEL_COLLECTOR_CORE_VERSION__/${OTEL_COLLECTOR_CORE_VERSION}/g" builder-config.yaml && \
    CGO_ENABLED=0 ocb --config=builder-config.yaml

# Build the Go migration tool with full TLS support for ClickHouse
FROM golang:1.26-alpine AS migrate-builder
WORKDIR /build
COPY packages/otel-collector/go.mod packages/otel-collector/go.sum ./
RUN go mod download
COPY packages/otel-collector/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /migrate ./cmd/migrate

FROM oven/bun:${BUN_VERSION}-alpine AS bun_base

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


## common-utils builder ############################################################################
# Separate stage so common-utils build is cached independently of API/App source changes.
FROM bun_base AS common-utils-builder

COPY ./packages/common-utils ./packages/common-utils
RUN bun run --cwd packages/common-utils build


## API/APP Builder Image ##########################################################################
FROM bun_base AS builder

WORKDIR /app

# Copy pre-built common-utils from its dedicated build stage
COPY --from=common-utils-builder /app/packages/common-utils ./packages/common-utils

COPY packages/api ./packages/api
COPY packages/app ./packages/app
COPY CHANGELOG.md ./CHANGELOG.md

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT_STANDALONE=true
ENV NEXT_PUBLIC_IS_LOCAL_MODE=false
RUN bun run --cwd packages/api build && bun run --cwd packages/app build
RUN rm -rf node_modules packages/*/node_modules && bun install --frozen-lockfile --production --filter @hyperdx/api && mkdir -p packages/api/node_modules packages/common-utils/node_modules


# prod ############################################################################################
FROM oven/bun:${BUN_VERSION}-alpine AS prod

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX Production" \
      org.opencontainers.image.description="HyperDX production image with API and App services" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

ARG CODE_VERSION

ENV CODE_VERSION=$CODE_VERSION
ENV OTEL_RESOURCE_ATTRIBUTES="service.version=$CODE_VERSION"
ENV NODE_ENV=production

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
COPY --chown=bun:bun --from=builder /app/packages/app/dist/standalone ./packages/app
COPY --chown=bun:bun docker/hyperdx/entry.prod.sh /etc/local/entry.sh
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD bun -e "fetch('http://localhost:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one base ############################################################################################
FROM hairyhenderson/gomplate:v4.3.3-alpine AS gomplate
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}-alpine AS all-in-one-base

ARG CODE_VERSION
ARG USER_UID=10001
ARG USER_GID=10001

ENV CODE_VERSION=$CODE_VERSION
ENV OTEL_RESOURCE_ATTRIBUTES="service.version=$CODE_VERSION"
# Copy from otel collector bases
COPY --from=ocb-builder --chmod=755 /build/output/otelcol-hyperdx /otelcontribcol
COPY --from=otel_collector_opampsupervisor_base --chmod=755 /usr/local/bin/opampsupervisor /usr/local/bin/opampsupervisor

COPY --from=bun_base /usr/local/bin/bun /usr/local/bin/bun

# Set up Clickhouse
COPY docker/clickhouse/local/*.xml /etc/clickhouse-server
COPY docker/hyperdx/clickhouseConfig.xml /etc/clickhouse-server/config.xml

# Set up Otel Collector
COPY docker/otel-collector/config.yaml /etc/otelcol-contrib/config.yaml
COPY docker/otel-collector/supervisor_docker.yaml.tmpl /etc/otel/supervisor.yaml.tmpl
COPY docker/otel-collector/schema /etc/otel/schema

# Copy otel-collector entrypoint script
COPY --chmod=755 docker/otel-collector/entrypoint.sh /otel-entrypoint.sh

# Copy gomplate binary from the gomplate image
COPY --from=gomplate /bin/gomplate /usr/local/bin/gomplate

# Copy goose binary from the goose image
COPY --from=goose /bin/goose /usr/local/bin/goose

# Copy migrate binary (Go-based goose migration tool with full TLS support)
COPY --from=migrate-builder /migrate /usr/local/bin/migrate

# Install MongoDB and other dependencies (consolidated into a single RUN command).
# libstdc++/libgcc are Bun runtime deps, installed before the v3.9
# repositories are appended so they resolve from this image's own Alpine release.
RUN apk add --no-cache libstdc++ libgcc && \
  echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/main' >> /etc/apk/repositories && \
  echo 'http://dl-cdn.alpinelinux.org/alpine/v3.9/community' >> /etc/apk/repositories && \
  apk update && \
  apk add --no-cache mongodb yaml-cpp=0.6.2-r2 ca-certificates && \
  apk add --no-cache --upgrade curl busybox && \
  addgroup -S -g ${USER_GID} otel && \
  adduser  -S -u ${USER_UID} -G otel otel && \
  mkdir -p /data/db && \
  install -d -m 0777 -o ${USER_UID} -g ${USER_GID} /etc/otel/supervisor-data && \
  rm -rf /var/cache/apk/*

ENV NODE_ENV=production

# Set up App
COPY --from=prod /app /app
COPY docker/hyperdx/entry.local.base.sh /etc/local/entry.base.sh

# Copy VEX exception files for Docker Scout vulnerability suppression
# Reference via: docker scout cves --vex-location /etc/vex/ <image>
COPY .vex/*.vex.json /etc/vex/

WORKDIR /app

# Add hosts entry in entrypoint script instead of here

# Expose ports
EXPOSE 8080 4317 4318 13133 8123 9000 8125/udp

# all-in-one no auth ############################################################################################
FROM all-in-one-base AS all-in-one-noauth

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX All-in-One (No Auth)" \
      org.opencontainers.image.description="HyperDX all-in-one image with ClickHouse, MongoDB, and OTel Collector (no authentication)" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY docker/hyperdx/entry.local.noauth.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["sh", "/etc/local/entry.sh"]

# all-in-one with auth ############################################################################################
FROM all-in-one-base AS all-in-one-auth

LABEL org.opencontainers.image.vendor="HyperDX" \
      org.opencontainers.image.title="HyperDX All-in-One (With Auth)" \
      org.opencontainers.image.description="HyperDX all-in-one image with ClickHouse, MongoDB, and OTel Collector (with authentication)" \
      org.opencontainers.image.source="https://github.com/hyperdxio/hyperdx" \
      org.opencontainers.image.licenses="MIT"

COPY docker/hyperdx/entry.local.auth.sh /etc/local/entry.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/api/health || exit 1

ENTRYPOINT ["sh", "/etc/local/entry.sh"]

