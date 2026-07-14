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
mkdir -p data/postgres data/exports

# Start services
echo "🚀 Starting all services..."
docker compose up -d --build

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

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Show status
docker compose ps

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ CyberBee is starting up!"
echo ""
echo "  Frontend:      http://localhost:3000"
echo "  Backend API:   http://localhost:3001"
echo "  Swagger Docs:  http://localhost:3001/api/docs"
echo "  Health Check:  http://localhost:3001/health"
echo ""
echo "  MQTT Broker:   localhost:1883"
echo "  PostgreSQL:    localhost:5432"
echo "  Redis:         localhost:6379"
echo "═══════════════════════════════════════════"
echo ""
echo "  To send a test MQTT message:"
echo "  node scripts/test-mqtt.js"
echo ""
echo "  To view logs:"
echo "  ./scripts/logs.sh [service]"
echo "═══════════════════════════════════════════"
