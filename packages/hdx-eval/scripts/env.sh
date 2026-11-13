#!/usr/bin/env bash
# Set up the full environment for hdx-eval, then exec the remaining args.
#
# 1. Set the dev stack's slot-based port vars from scripts/slots.sh
# 2. Load the optional root .env.local with Bun; existing vars take precedence.
#
# Usage:
#   scripts/env.sh bun src/cli.ts seed error-root-cause
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Slot-based port env vars (HYPERDX_API_PORT, HDX_DEV_CH_HTTP_PORT, etc.)
# shellcheck source=../../../scripts/slots.sh
. "$REPO_ROOT/scripts/slots.sh"
hdx_dev_ports "$REPO_ROOT"

if [[ -f "$REPO_ROOT/.env.local" ]]; then
  exec bun --env-file="$REPO_ROOT/.env.local" --bun run "$@"
fi
exec "$@"
