-- ============================================================
-- 005: TimescaleDB Policies
-- ============================================================

-- ─── Continuous Aggregate Refresh Policies ───────────────────

SELECT add_continuous_aggregate_policy('current_1m',
  start_offset      => INTERVAL '7 days',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists     => TRUE
);

SELECT add_continuous_aggregate_policy('current_1h',
  start_offset      => INTERVAL '90 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists     => TRUE
);

-- ─── Compression ─────────────────────────────────────────────
-- Compress raw chunks older than 7 days to reduce storage

ALTER TABLE raw_current_measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'sensor_sn,device_id'
);

SELECT add_compression_policy('raw_current_measurements',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

-- ─── Retention ───────────────────────────────────────────────
-- Drop raw data older than 30 days.
--
-- To change the retention window on a running instance:
--
--   1. Find the job ID:
--      SELECT job_id FROM timescaledb_information.jobs
--      WHERE proc_name = 'policy_retention';
--
--   2. Remove the existing policy and re-add with a new interval:
--      SELECT remove_retention_policy('raw_current_measurements');
--      SELECT add_retention_policy('raw_current_measurements', INTERVAL '60 days');
--
--   Alternatively, use the helper script:
--      ./scripts/set-retention.sh 60

SELECT add_retention_policy('raw_current_measurements',
  INTERVAL '30 days',
  if_not_exists => TRUE
);
