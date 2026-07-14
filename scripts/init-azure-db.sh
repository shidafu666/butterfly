#!/usr/bin/env bash
# ============================================================
# CyberBee — Azure PostgreSQL 初始化脚本
# 在 Azure PostgreSQL Flexible Server 上启用 TimescaleDB 并初始化 Schema
#
# 前置条件:
#   - 已登录 Azure (az login)
#   - 已安装 psql (brew install postgresql)
#   - .env.azure 已正确填写
#
# Usage: bash scripts/init-azure-db.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INIT_SQL_DIR="${PROJECT_ROOT}/infra/docker/postgres/init"

ENV_FILE="${PROJECT_ROOT}/.env.aci"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.aci not found."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

echo "╔══════════════════════════════════════════════════╗"
echo "║  CyberBee — Azure PostgreSQL 初始化             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Check prerequisites ──────────────────────────────
if ! command -v psql &>/dev/null; then
  echo "❌ psql 未安装。请先安装:"
  echo "   brew install postgresql    # macOS"
  echo "   apt install postgresql-client  # Ubuntu"
  exit 1
fi

if ! command -v az &>/dev/null; then
  echo "❌ Azure CLI 未安装。"
  exit 1
fi

echo "📋 配置信息:"
echo "   Server:          ${PG_SERVER_NAME}"
# PG_RESOURCE_GROUP allows the database to be in a different resource group
# from the application resources (e.g. keeping butterfly-pg in the old RG).
# Falls back to AZURE_RESOURCE_GROUP for backward compatibility.
PG_EFFECTIVE_RESOURCE_GROUP="${PG_RESOURCE_GROUP:-${AZURE_RESOURCE_GROUP}}"
echo "   Resource Group:  ${PG_EFFECTIVE_RESOURCE_GROUP}"
DB_DISPLAY=$(echo "$DATABASE_URL" | sed 's/password=[^&]*/password=***/')
echo "   Database URL:    ${DB_DISPLAY}"
echo ""

# ─── Helper: Use az rest to call ARM API with pinned api-version ───
# Azure China may not support the latest preview API versions that
# az postgres flexible-server defaults to, so we call REST directly.
PG_API_VERSION="2024-08-01"
PG_RESOURCE_ID="/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${PG_EFFECTIVE_RESOURCE_GROUP}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${PG_SERVER_NAME}"

pg_param_get() {
  local param_name="$1"
  az rest --method GET \
    --url "${PG_RESOURCE_ID}/configurations/${param_name}?api-version=${PG_API_VERSION}" \
    --query "properties.value" -o tsv 2>/dev/null || echo ""
}

pg_param_set() {
  local param_name="$1"
  local param_value="$2"
  az rest --method PUT \
    --url "${PG_RESOURCE_ID}/configurations/${param_name}?api-version=${PG_API_VERSION}" \
    --body "{\"properties\":{\"value\":\"${param_value}\",\"source\":\"user-override\"}}" \
    --output none
}

pg_restart() {
  az rest --method POST \
    --url "${PG_RESOURCE_ID}/restart?api-version=${PG_API_VERSION}" \
    --body '{}' \
    --output none
}

# Wait for server to reach "Ready" state via ARM API (not psql connect test).
# The server can briefly accept connections during early "Restarting" phase,
# so psql polling is unreliable.
pg_wait_ready() {
  echo "   ⏳ Waiting for server to reach Ready state..."
  for i in $(seq 1 40); do
    local state
    state=$(az rest --method GET \
      --url "${PG_RESOURCE_ID}?api-version=${PG_API_VERSION}" \
      --query "properties.state" -o tsv 2>/dev/null || echo "Unknown")
    if [ "$state" = "Ready" ]; then
      # ARM says Ready; verify psql connectivity with up to 10 extra retries.
      # Azure PG can briefly close connections while loading extensions even
      # after ARM reports Ready, so we retry rather than looping back to the
      # ARM poll.
      for j in $(seq 1 10); do
        if psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
          echo "   ✅ Server is Ready and accepting connections (ARM poll ${i}, psql attempt ${j})"
          return 0
        fi
        echo "   ⏳ ARM=Ready but psql not yet accepting connections (attempt ${j}/10), waiting 10s..."
        sleep 10
      done
      # psql still failing after retries but ARM says Ready — trust ARM and proceed.
      echo "   ⚠️  ARM=Ready but psql connectivity check timed out; proceeding (server may still be finalizing)"
      return 0
    fi
    sleep 5
  done
  echo "   ❌ Server did not become Ready after 200s"
  return 1
}

# ─── Step 2: Enable TimescaleDB extension on Azure PG ─────────
echo "🔧 Step 1/4: 配置 Azure PostgreSQL 扩展白名单..."

CURRENT_EXTENSIONS=$(pg_param_get "azure.extensions")

NEED_EXTENSIONS=""
if [[ "$CURRENT_EXTENSIONS" != *"TIMESCALEDB"* ]] && [[ "$CURRENT_EXTENSIONS" != *"timescaledb"* ]]; then
  NEED_EXTENSIONS="TIMESCALEDB"
fi
if [[ "$CURRENT_EXTENSIONS" != *"PGCRYPTO"* ]] && [[ "$CURRENT_EXTENSIONS" != *"pgcrypto"* ]]; then
  NEED_EXTENSIONS="${NEED_EXTENSIONS:+${NEED_EXTENSIONS},}PGCRYPTO"
fi
if [[ "$CURRENT_EXTENSIONS" != *"PG_CRON"* ]] && [[ "$CURRENT_EXTENSIONS" != *"pg_cron"* ]]; then
  NEED_EXTENSIONS="${NEED_EXTENSIONS:+${NEED_EXTENSIONS},}PG_CRON"
fi

if [ -n "$NEED_EXTENSIONS" ]; then
  NEW_EXTENSIONS="${CURRENT_EXTENSIONS:+${CURRENT_EXTENSIONS},}${NEED_EXTENSIONS}"
  echo "   Adding extensions: ${NEED_EXTENSIONS}"
  pg_param_set "azure.extensions" "$NEW_EXTENSIONS"
  echo "   ✅ azure.extensions updated"
else
  echo "   ✅ TIMESCALEDB, PGCRYPTO and PG_CRON already allowed"
fi

# ─── Step 3: Add TimescaleDB to shared_preload_libraries ──────
echo "🔧 Step 2/4: 配置 shared_preload_libraries..."

CURRENT_PRELOAD=$(pg_param_get "shared_preload_libraries")

if [[ "$CURRENT_PRELOAD" != *"timescaledb"* ]]; then
  NEW_PRELOAD="${CURRENT_PRELOAD:+${CURRENT_PRELOAD},}timescaledb"
  echo "   Adding timescaledb to shared_preload_libraries (ARM API)"
  pg_param_set "shared_preload_libraries" "$NEW_PRELOAD"
  echo "   ✅ shared_preload_libraries updated in ARM"
fi

# Always verify actual PostgreSQL runtime value.
# ARM value may include timescaledb but server hasn't restarted yet.
# Use || true to prevent pipefail from aborting the script if psql cannot
# connect (e.g. transient network issue); an empty result is treated as
# "not loaded" and triggers the restart path below.
PG_ACTUAL_PRELOAD=$(psql "$DATABASE_URL" -t -c "SHOW shared_preload_libraries;" 2>/dev/null | tr -d ' ') || PG_ACTUAL_PRELOAD=""
if [[ "$PG_ACTUAL_PRELOAD" != *"timescaledb"* ]]; then
  echo "🔄 重启 PostgreSQL 以加载 TimescaleDB (ARM state polling, ~1-2 min)..."
  pg_restart
  pg_wait_ready
  # Final verification
  PG_ACTUAL_PRELOAD=$(psql "$DATABASE_URL" -t -c "SHOW shared_preload_libraries;" 2>/dev/null | tr -d ' ') || PG_ACTUAL_PRELOAD=""
  if [[ "$PG_ACTUAL_PRELOAD" != *"timescaledb"* ]]; then
    echo "   ❌ 重启后 timescaledb 仍未在 shared_preload_libraries 中"
    echo "   实际值: $PG_ACTUAL_PRELOAD"
    exit 1
  fi
  echo "   ✅ PostgreSQL 已加载 timescaledb"
else
  echo "   ✅ timescaledb already loaded in PostgreSQL"
fi

# ─── Step 4: Run init SQL scripts ─────────────────────────────
echo "🗄️  Step 3/4: 执行初始化 SQL 脚本..."

# Run each SQL file; abort on real errors
run_sql_file() {
  local sql_file="$1"
  local filename
  filename=$(basename "$sql_file")
  echo "   Running: ${filename}..."
  local output
  output=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$sql_file" 2>&1 || true)
  local real_errors
  real_errors=$(echo "$output" | grep -i "error" | grep -vi "already exists\|IF NOT EXISTS\|if_not_exists\|does not exist, skipping" || true)
  if [ -n "$real_errors" ]; then
    echo "$real_errors"
    echo "   ❌ ${filename} had errors (see above)"
    return 1
  fi
  echo "   ✅ ${filename} done"
}

# CREATE EXTENSION timescaledb can drop the connection on Azure PG.
# Strategy: run it, and if connection drops, reconnect and check if extension exists.
echo "   Running: 001_init_extensions.sql..."
EXT_INSTALLED=0

for attempt in $(seq 1 4); do
  # Check if extension already exists (from a previous run or a "successful" connection-drop install)
  TSDB_EXISTS=$(psql "$DATABASE_URL" -t -c \
    "SELECT 1 FROM pg_extension WHERE extname='timescaledb';" 2>/dev/null | tr -d ' ') || TSDB_EXISTS=""
  PGCRYPTO_EXISTS=$(psql "$DATABASE_URL" -t -c \
    "SELECT 1 FROM pg_extension WHERE extname='pgcrypto';" 2>/dev/null | tr -d ' ') || PGCRYPTO_EXISTS=""
  if [ "$TSDB_EXISTS" = "1" ] && [ "$PGCRYPTO_EXISTS" = "1" ]; then
    echo "   ✅ 001_init_extensions.sql done (extensions verified)"
    EXT_INSTALLED=1
    break
  fi

  # Run the SQL file
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "${INIT_SQL_DIR}/001_init_extensions.sql" &>/dev/null || true

  # Wait a moment then verify
  sleep 5
  TSDB_EXISTS=$(psql "$DATABASE_URL" -t -c \
    "SELECT 1 FROM pg_extension WHERE extname='timescaledb';" 2>/dev/null | tr -d ' ') || TSDB_EXISTS=""
  PGCRYPTO_EXISTS=$(psql "$DATABASE_URL" -t -c \
    "SELECT 1 FROM pg_extension WHERE extname='pgcrypto';" 2>/dev/null | tr -d ' ') || PGCRYPTO_EXISTS=""
  if [ "$TSDB_EXISTS" = "1" ] && [ "$PGCRYPTO_EXISTS" = "1" ]; then
    echo "   ✅ 001_init_extensions.sql done (extensions verified)"
    EXT_INSTALLED=1
    break
  fi

  echo "   ⏳ Extensions not yet ready (attempt ${attempt}/4)，等待 15s 后重试..."
  sleep 15
done

if [ "$EXT_INSTALLED" -eq 0 ]; then
  echo "   ❌ 001_init_extensions.sql failed: extensions not installed after 4 attempts"
  echo "   Please check Azure PostgreSQL logs"
  exit 1
fi

INIT_FAILED=0

for sql_file in \
  "${INIT_SQL_DIR}/002_schema.sql" \
  "${INIT_SQL_DIR}/003_seed.sql"; do
  run_sql_file "$sql_file" || INIT_FAILED=1
done

# Verify TimescaleDB is loaded before running aggregate/policy scripts
TSDB_CHECK=$(psql "$DATABASE_URL" -t -c \
  "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';" 2>/dev/null | tr -d ' ') || TSDB_CHECK=""
if [ -z "$TSDB_CHECK" ]; then
  echo ""
  echo "   ❌ TimescaleDB 扩展未成功安装。跳过聚合和策略脚本。"
  echo "   请检查 Azure PostgreSQL 是否支持 TimescaleDB，然后重新运行 make aci-db-init"
  exit 1
fi
echo "   ✅ TimescaleDB ${TSDB_CHECK} 已确认加载"

# Detect TimescaleDB license: "apache" vs "timescale" (community/TSL)
TSDB_LICENSE=$(psql "$DATABASE_URL" -t -c "SHOW timescaledb.license;" 2>/dev/null | tr -d ' ') || TSDB_LICENSE=""
echo "   📋 TimescaleDB license: ${TSDB_LICENSE}"

if [ "$TSDB_LICENSE" = "apache" ]; then
  echo "   ⚠️  Apache license: using standard materialized views + pg_cron"
  AGG_SQL="${INIT_SQL_DIR}/004_azure_aggregates.sql"
  POL_SQL="${INIT_SQL_DIR}/005_azure_policies.sql"
else
  echo "   ✅ TSL license: using native continuous aggregates"
  AGG_SQL="${INIT_SQL_DIR}/004_continuous_aggregates.sql"
  POL_SQL="${INIT_SQL_DIR}/005_policies.sql"
fi

for sql_file in "$AGG_SQL" "$POL_SQL"; do
  run_sql_file "$sql_file" || INIT_FAILED=1
done

if [ "$INIT_FAILED" -ne 0 ]; then
  echo ""
  echo "   ⚠️ 部分脚本执行有错误，请检查上方输出"
fi

# ─── Step 4b: Populate materialized views (Apache license only) ───
# When using standard materialized views (Apache TimescaleDB), the views are
# created WITH NO DATA. The REFRESH at the end of 004_azure_aggregates.sql
# handles the initial population, but if the view already existed from a
# previous run (IF NOT EXISTS skips re-creation), we need to ensure it is
# populated here too. We do a non-concurrent refresh which is idempotent.
if [ "$TSDB_LICENSE" = "apache" ]; then
  echo "🔄 Step 3b/4: 刷新 Apache 物化视图（初始填充数据）..."
  for view in current_1m current_1h current_1d; do
    IS_POPULATED=$(psql "$DATABASE_URL" -t -c \
      "SELECT ispopulated FROM pg_matviews WHERE matviewname = '${view}';" 2>/dev/null | tr -d ' ')
    if [ "$IS_POPULATED" != "t" ]; then
      echo "   ⏳ REFRESH MATERIALIZED VIEW ${view} ..."
      psql "$DATABASE_URL" -c "REFRESH MATERIALIZED VIEW ${view};" 2>&1 | grep -v "^REFRESH$" || true
      echo "   ✅ ${view} 已填充"
    else
      echo "   ✅ ${view} 已填充（跳过）"
    fi
  done
fi

# ─── Step 4c: Apply SQL migrations ────────────────────────────
# init/ only builds the base schema; versioned changes live in migrations/.
# DATABASE_URL is already exported from .env.aci above.
echo "🗄️  Step 3c/4: 应用 SQL 迁移..."
bash "${SCRIPT_DIR}/migrate.sh" || echo "   ⚠️ 迁移步骤有错误，请检查上方输出"

# ─── Step 5: Verify ───────────────────────────────────────────
echo "🔍 Step 4/4: 验证 TimescaleDB..."

TSDB_VERSION=$(psql "$DATABASE_URL" -t -c \
  "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb';" 2>/dev/null | tr -d ' ') || TSDB_VERSION=""

if [ -n "$TSDB_VERSION" ]; then
  echo "   ✅ TimescaleDB ${TSDB_VERSION} 已启用"
else
  echo "   ❌ TimescaleDB 扩展未找到，请检查错误日志"
  exit 1
fi

HYPERTABLE_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM timescaledb_information.hypertables;" 2>/dev/null | tr -d ' ') || HYPERTABLE_COUNT="?"
echo "   ✅ Hypertables: ${HYPERTABLE_COUNT}"

CAGG_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM timescaledb_information.continuous_aggregates;" 2>/dev/null | tr -d ' ') || CAGG_COUNT="?"
echo "   ✅ Continuous Aggregates: ${CAGG_COUNT}"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Azure PostgreSQL 初始化完成！"
echo "═══════════════════════════════════════════"
