#!/usr/bin/env bash
# Usage: ./scripts/set-retention.sh <days>
# Example: ./scripts/set-retention.sh 60

set -euo pipefail

DAYS="${1:-}"
if [[ -z "$DAYS" || ! "$DAYS" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 <days>"
  echo "  e.g.: $0 30    # keep 30 days of raw data"
  exit 1
fi

DB_USER="${POSTGRES_USER:-app}"
DB_NAME="${POSTGRES_DB:-current_platform}"
CONTAINER="${POSTGRES_CONTAINER:-butterfly-postgres}"

echo "Setting raw_current_measurements retention to ${DAYS} days..."

docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT remove_retention_policy('raw_current_measurements', if_not_exists => TRUE);
SELECT add_retention_policy('raw_current_measurements', INTERVAL '${DAYS} days');
"

echo "Done. Verify with:"
echo "  docker exec $CONTAINER psql -U $DB_USER -d $DB_NAME -c \\"
echo "    \"SELECT job_id, config->>'drop_after' AS retention FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';\""
