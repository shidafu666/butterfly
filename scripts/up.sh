#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║   CyberBee - 电流数据采集与可视化平台     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Ensure .env exists
if [ ! -f ".env" ]; then
  echo "⚡ .env not found, copying from .env.example..."
  cp .env.example .env
  echo "✅ Created .env — please review and update secrets before production use."
  echo ""
fi

# Create required data directories
echo "📁 Creating data directories..."
mkdir -p data/postgres data/redis data/exports

echo "🚀 Starting local infrastructure (Postgres, Redis, Mosquitto)..."
docker compose up -d postgres redis mosquitto

echo ""
echo "⏳ Waiting for Postgres to be ready..."
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-current_platform}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# Apply pending SQL migrations (idempotent; safe on a fresh init too)
echo "🗄️  Applying database migrations..."
bash "$SCRIPT_DIR/migrate.sh" --local || echo "⚠️  Migration step failed — see output above."

# Show status
docker compose ps postgres redis mosquitto

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Local infrastructure is ready!"
echo ""
echo "  Start app dev servers in another terminal:"
echo "    make install   # first time only"
echo "    make dev-all"
echo ""
echo "  Or start them separately:"
echo "    make dev-backend"
echo "    make dev-frontend"
echo "    make dev-ingestion"
echo "    make dev-export"
echo ""
echo "  MQTT Broker:   localhost:1883"
echo "  PostgreSQL:    localhost:5432"
echo "  Redis:         localhost:6379"
echo "═══════════════════════════════════════════"
echo ""
echo "  To send a test MQTT message:"
echo "  node scripts/test-mqtt.js"
echo ""
echo "  To run the old full Docker production-style stack:"
echo "    make up-prod"
echo "═══════════════════════════════════════════"
