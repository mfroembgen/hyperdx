#!/bin/bash
# Run the CI test settings with the platform's local container runtime.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Running E2E tests with CI settings..."
echo "Repository root: $REPO_ROOT"

cd "$REPO_ROOT"
bun ci
bun --bun x nx run-many -t ci:build
CI=true bash scripts/test-e2e.sh "$@"

echo "Done! Check packages/app/test-results/ for results"
