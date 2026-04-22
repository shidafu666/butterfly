-- ============================================================
-- 004 (Azure): Materialized Views for Aggregates
-- Azure PG TimescaleDB uses Apache license which does NOT
-- support continuous aggregates. Use standard materialized
-- views refreshed by pg_cron instead.
-- ============================================================

-- time_bucket() is available in Apache TimescaleDB edition.

-- 1-minute aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1m AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value)   AS avg_current,
  MIN(current_value)   AS min_current,
  MAX(current_value)   AS max_current,
  COUNT(*)             AS sample_count
FROM raw_current_measurements
WHERE ts >= NOW() - INTERVAL '7 days'
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;

-- 1-hour aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1h AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value)   AS avg_current,
  MIN(current_value)   AS min_current,
  MAX(current_value)   AS max_current,
  COUNT(*)             AS sample_count
FROM raw_current_measurements
WHERE ts >= NOW() - INTERVAL '90 days'
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;

-- 1-day aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1d AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value)   AS avg_current,
  MIN(current_value)   AS min_current,
  MAX(current_value)   AS max_current,
  COUNT(*)             AS sample_count
FROM raw_current_measurements
WHERE ts >= NOW() - INTERVAL '3 years'
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;

-- Create UNIQUE indexes required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_current_1m_unique ON current_1m (bucket, sensor_sn, device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_current_1h_unique ON current_1h (bucket, sensor_sn, device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_current_1d_unique ON current_1d (bucket, sensor_sn, device_id);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_current_1m_bucket ON current_1m (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_current_1m_sensor ON current_1m (sensor_sn, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_current_1h_bucket ON current_1h (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_current_1h_sensor ON current_1h (sensor_sn, bucket DESC);
CREATE INDEX IF NOT EXISTS idx_current_1d_bucket ON current_1d (bucket DESC);
CREATE INDEX IF NOT EXISTS idx_current_1d_sensor ON current_1d (sensor_sn, bucket DESC);

-- ─── Initial population ───────────────────────────────────────
-- Views are created WITH NO DATA; do a blocking refresh now so queries
-- work immediately without waiting for the first pg_cron run.
-- Subsequent refreshes (scheduled by 005_azure_policies.sql) will use
-- REFRESH MATERIALIZED VIEW CONCURRENTLY which requires the view to
-- already be populated — this initial non-concurrent refresh satisfies
-- that prerequisite as well.
REFRESH MATERIALIZED VIEW current_1m;
REFRESH MATERIALIZED VIEW current_1h;
REFRESH MATERIALIZED VIEW current_1d;
