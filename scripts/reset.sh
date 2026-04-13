#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "⚠️  WARNING: This will DELETE all local database data and exports!"
echo "   - data/postgres/ (all database data)"
echo "   - data/exports/  (all exported files)"
echo ""
read -p "Are you sure? Type 'yes' to continue: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Aborted."
  exit 1
fi

echo ""
echo "🛑 Stopping services..."
docker compose down -v

echo "🗑️  Removing data directories..."
rm -rf data/postgres
rm -f data/exports/*.csv data/exports/*.log

echo "📁 Recreating data directories..."
mkdir -p data/postgres data/exports

echo "🚀 Rebuilding and restarting..."
docker compose up -d --build

echo ""
echo "✅ Reset complete! Services are restarting with a fresh database."
echo ""
echo "   Frontend:    http://localhost:3000"
echo "   Backend API: http://localhost:3001/api/docs"
