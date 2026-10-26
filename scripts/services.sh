#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
. ./scripts/slots.sh
mode="${1:?Usage: services.sh <dev|ci|e2e> <up|down|build|logs|exec|pull> [args]}"
shift
case "$mode" in
  dev) hdx_dev_ports; project="$HDX_DEV_PROJECT"; file=docker-compose.dev.yml ;;
  ci) hdx_ci_ports; project="$HDX_CI_PROJECT"; file=docker-compose.ci.yml ;;
  e2e) hdx_e2e_ports; project="$E2E_PROJECT"; file=packages/app/tests/e2e/docker-compose.yml ;;
  *) echo "Unknown service mode: $mode" >&2; exit 1 ;;
esac
if [ "$(uname -s)" = Darwin ]; then
  exec bun --env-file=.env scripts/container-services.mjs "$project" "$file" "$@"
fi
exec docker compose -p "$project" -f "$file" "$@"
