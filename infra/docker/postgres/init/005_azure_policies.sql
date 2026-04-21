-- ============================================================
-- 005 (Azure): pg_cron Refresh & Retention Policies
-- Azure PG TimescaleDB Apache license does NOT support
-- continuous aggregate policies, compression, or retention.
-- Use pg_cron for scheduling instead.
-- ============================================================

-- Enable pg_cron extension (already in shared_preload_libraries on Azure PG)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to allow cron jobs from current database
-- (Azure PG pg_cron jobs run in the postgres database by default)

-- ─── Materialized View Refresh Jobs ──────────────────────────
-- Unschedule existing jobs first (idempotent re-runs)
SELECT cron.unschedule('refresh_current_1m') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh_current_1m');
SELECT cron.unschedule('refresh_current_1h') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh_current_1h');
SELECT cron.unschedule('refresh_current_1d') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh_current_1d');
SELECT cron.unschedule('retention_raw_measurements') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'retention_raw_measurements');

-- Refresh 1-minute aggregate every minute
SELECT cron.schedule(
  'refresh_current_1m',
  '* * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY current_1m$$
);

-- Refresh 1-hour aggregate every 5 minutes
SELECT cron.schedule(
  'refresh_current_1h',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY current_1h$$
);

-- Refresh 1-day aggregate every hour
SELECT cron.schedule(
  'refresh_current_1d',
  '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY current_1d$$
);

-- ─── Data Retention ──────────────────────────────────────────
-- Delete raw measurements older than 30 days (daily at 3:00 AM UTC)
SELECT cron.schedule(
  'retention_raw_measurements',
  '0 3 * * *',
  $$DELETE FROM raw_current_measurements WHERE ts < NOW() - INTERVAL '30 days'$$
);
