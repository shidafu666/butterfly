#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "⚡ .env not found, copying from .env.example..."
  cp .env.example .env
fi

mkdir -p data/exports

set -a
# shellcheck source=/dev/null
source .env
set +a

# Host-run dev servers talk to Docker-published ports, not Compose DNS names.
export DATABASE_URL="postgresql://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app123}@localhost:5432/${POSTGRES_DB:-current_platform}"
export REDIS_HOST="localhost"
export REDIS_PORT="${REDIS_PORT:-6379}"
export MQTT_URL="mqtt://localhost:1883"
export BROKER_URL="${BROKER_URL:-mqtt://localhost:1883}"
export EXPORT_DIR="${ROOT_DIR}/data/exports"
export BACKEND_ORIGIN="${BACKEND_ORIGIN:-http://localhost:3001}"
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-}"

exec "$@"
