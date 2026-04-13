-- ============================================================
-- 005: TimescaleDB Policies
-- NOTE: Retention and compression are disabled for development.
--       Uncomment for production use.
-- ============================================================

-- Continuous aggregate refresh policies
SELECT add_continuous_aggregate_policy('current_1m',
  start_offset     => INTERVAL '7 days',
  end_offset       => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists    => TRUE
);

SELECT add_continuous_aggregate_policy('current_1h',
  start_offset     => INTERVAL '90 days',
  end_offset       => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists    => TRUE
);

-- ─── Production Policies (disabled for development) ──────────
--
-- Retention: drop raw data older than 90 days
-- SELECT add_retention_policy('raw_current_measurements', INTERVAL '90 days');
--
-- Compression: compress chunks older than 7 days
-- ALTER TABLE raw_current_measurements SET (
--   timescaledb.compress,
--   timescaledb.compress_segmentby = 'sensor_sn,device_id'
-- );
-- SELECT add_compression_policy('raw_current_measurements', INTERVAL '7 days');
