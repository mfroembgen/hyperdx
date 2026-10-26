## base #############################################################################################
FROM oven/bun:1.4.4-alpine AS base
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
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

EXPOSE 8080

ENTRYPOINT ["bun", "--bun", "x", "nx", "run", "@hyperdx/app:dev"]


## common-utils-builder ############################################################################
# Separate stage so common-utils build is cached independently of App source changes.

FROM base AS common-utils-builder

COPY ./packages/common-utils ./packages/common-utils
RUN bun run --cwd packages/common-utils build


## builder #########################################################################################
# Rebuild the source code only when needed
FROM base AS builder

# Copy pre-built common-utils from its dedicated build stage
COPY --from=common-utils-builder /app/packages/common-utils ./packages/common-utils

# Expose custom env variables to the browser (needs NEXT_PUBLIC_ prefix)
# doc: https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#bundling-environment-variables-for-the-browser
ARG OTEL_EXPORTER_OTLP_ENDPOINT
ARG OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
ARG OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
ARG OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
ARG OTEL_SERVICE_NAME
ARG IS_LOCAL_MODE
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT $OTEL_EXPORTER_OTLP_ENDPOINT
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT $OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT $OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
ENV NEXT_PUBLIC_OTEL_EXPORTER_OTLP_LOGS_ENDPOINT $OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
ENV NEXT_PUBLIC_OTEL_SERVICE_NAME $OTEL_SERVICE_NAME
ENV NEXT_PUBLIC_IS_LOCAL_MODE $IS_LOCAL_MODE

COPY packages/app ./packages/app
COPY CHANGELOG.md ./CHANGELOG.md
ENV NEXT_OUTPUT_STANDALONE=true
RUN bun run --cwd packages/app build


## prod ############################################################################################
FROM oven/bun:1.4.4-alpine AS prod
ARG CODE_VERSION
ENV CODE_VERSION=$CODE_VERSION NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
USER bun
COPY --chown=bun:bun --from=builder /app/packages/app/dist/standalone ./
EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0
ENTRYPOINT ["bun", "server.mjs"]
