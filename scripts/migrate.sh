#!/usr/bin/env bash
# ============================================================
# CyberBee — SQL migration runner
#
# Applies every infra/docker/postgres/migrations/*.sql file (in filename
# order) that has not yet been recorded in the schema_migrations table.
# Each file + its bookkeeping row is applied in a single transaction, so a
# migration either fully applies and is recorded, or not at all.
#
# Migration files MUST:
#   - be named NNN_description.sql (ordered by the numeric prefix)
#   - NOT contain their own BEGIN/COMMIT (the runner wraps each file)
#   - be idempotent where practical (safe if re-run)
#
# Target selection (pick one):
#   scripts/migrate.sh --local      # build DATABASE_URL from .env (localhost:5432)
#   scripts/migrate.sh --aci        # source .env.aci, use its DATABASE_URL
#   DATABASE_URL=... scripts/migrate.sh   # use a DATABASE_URL already in the env
#
# Requires: psql on PATH.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="${PROJECT_ROOT}/infra/docker/postgres/migrations"

# ─── Resolve DATABASE_URL from the chosen target ──────────────
TARGET="${1:-}"
case "$TARGET" in
  --local)
    ENV_FILE="${PROJECT_ROOT}/.env"
    [ -f "$ENV_FILE" ] || { echo "❌ .env not found"; exit 1; }
    set -a; source "$ENV_FILE"; set +a
    DATABASE_URL="postgresql://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app123}@localhost:5432/${POSTGRES_DB:-current_platform}"
    ;;
  --aci)
    ENV_FILE="${PROJECT_ROOT}/.env.aci"
    [ -f "$ENV_FILE" ] || { echo "❌ .env.aci not found"; exit 1; }
    set -a; source "$ENV_FILE"; set +a
    ;;
  "")
    : # use DATABASE_URL already exported by the caller
    ;;
  *)
    echo "❌ Unknown target '$TARGET' (use --local, --aci, or pre-set DATABASE_URL)"
    exit 1
    ;;
esac

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL is not set"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql not found on PATH"
  exit 1
fi

psql_run() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }

echo "🗄️  Running migrations from ${MIGRATIONS_DIR#"$PROJECT_ROOT"/}"

# ─── Ensure the ledger table exists ───────────────────────────
psql_run -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null

# ─── Apply pending migrations in filename order ───────────────
shopt -s nullglob
applied_count=0
for file in $(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort); do
  version="$(basename "$file" .sql)"

  already="$(psql_run -c "SELECT 1 FROM schema_migrations WHERE version = '${version}';")"
  if [ "$already" = "1" ]; then
    echo "   ⏭️  ${version} (already applied)"
    continue
  fi

  echo "   ▶️  ${version} ..."
  # --single-transaction wraps the -f file and the bookkeeping -c in ONE
  # transaction; psql runs them in command-line order (file, then INSERT).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "INSERT INTO schema_migrations (version) VALUES ('${version}');"
  echo "   ✅ ${version} applied"
  applied_count=$((applied_count + 1))
done

if [ "$applied_count" -eq 0 ]; then
  echo "✅ Database is up to date (no pending migrations)."
else
  echo "✅ Applied ${applied_count} migration(s)."
fi
