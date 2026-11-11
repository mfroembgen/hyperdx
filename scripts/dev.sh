#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. ./scripts/dev-env.sh
bun run build:common-utils
bun --bun x dotenvx run --convention=nextjs -- bash scripts/services.sh dev up -d --build
trap 'bash scripts/services.sh dev down; _hdx_cleanup_slot' EXIT
bun run app:dev
