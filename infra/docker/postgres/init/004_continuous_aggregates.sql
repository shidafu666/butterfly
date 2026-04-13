-- ============================================================
-- 004: TimescaleDB Continuous Aggregates
-- ============================================================

-- 1-minute aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value)   AS avg_current,
  MIN(current_value)   AS min_current,
  MAX(current_value)   AS max_current,
  COUNT(*)             AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;

-- 1-hour aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS current_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  sensor_sn,
  device_id,
  AVG(current_value)   AS avg_current,
  MIN(current_value)   AS min_current,
  MAX(current_value)   AS max_current,
  COUNT(*)             AS sample_count
FROM raw_current_measurements
GROUP BY bucket, sensor_sn, device_id
WITH NO DATA;
