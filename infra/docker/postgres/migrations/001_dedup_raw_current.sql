-- ============================================================
-- Migration 001: De-duplicate raw_current_measurements
-- ============================================================
--
-- Problem:
--   raw_current_measurements has PRIMARY KEY (id, ts) where `id` is a
--   BIGSERIAL surrogate. Every insert gets a fresh `id`, so the writer's
--   `ON CONFLICT DO NOTHING` never matched a conflict and a sensor that
--   re-sent the same (sensor_sn, device_id, second) produced duplicate rows.
--   This inflated current_1m/1h/1d sample_count and the raw exports.
--
-- This migration:
--   1. Removes existing duplicate rows, keeping the earliest-ingested row
--      (lowest `id`) per natural key.
--   2. Adds a UNIQUE constraint on the natural key so future duplicates are
--      rejected (the writer uses `ON CONFLICT (sensor_sn, device_id, ts)`).
--   3. Drops the now-redundant idx_raw_current_sensor_device_ts index.
--
-- Idempotent: safe to re-run. Applied automatically by scripts/migrate.sh
-- (which wraps this file in a transaction — do NOT add BEGIN/COMMIT here).
--
-- Run during low-traffic if the table is large: the DELETE and the unique
-- index build both scan every chunk.
-- ============================================================

-- ─── Step 1: Delete duplicate rows, keep the lowest id per natural key ───
DELETE FROM raw_current_measurements a
USING raw_current_measurements b
WHERE a.sensor_sn = b.sensor_sn
  AND a.device_id = b.device_id
  AND a.ts        = b.ts
  AND a.id        > b.id;

-- ─── Step 2: Add the natural-key UNIQUE constraint (idempotent) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_raw_current_natural'
  ) THEN
    ALTER TABLE raw_current_measurements
      ADD CONSTRAINT uq_raw_current_natural UNIQUE (sensor_sn, device_id, ts);
  END IF;
END $$;

-- ─── Step 3: Drop the now-redundant index ───
-- The unique index from uq_raw_current_natural covers (sensor_sn, device_id, ts)
-- lookups, including `ORDER BY ts DESC` via a backward scan.
DROP INDEX IF EXISTS idx_raw_current_sensor_device_ts;
