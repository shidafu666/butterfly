#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

SERVICE="${1:-}"

if [ -z "$SERVICE" ]; then
  echo "📋 Streaming logs for all services (Ctrl+C to stop)..."
  docker compose logs -f --tail=100
else
  echo "📋 Streaming logs for: $SERVICE (Ctrl+C to stop)..."
  docker compose logs -f --tail=100 "$SERVICE"
fi
