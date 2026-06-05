-- ============================================================
-- 002: Core Schema
-- ============================================================

-- ─── Users & Auth ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid     VARCHAR(128) UNIQUE,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255),
  password_hash VARCHAR(255),
  status        VARCHAR(32)  NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(32)  UNIQUE NOT NULL,
  name       VARCHAR(64)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- ─── Sensors & Devices ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensors (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_sn    VARCHAR(64)  UNIQUE NOT NULL,
  display_name VARCHAR(128),
  status       VARCHAR(32)  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id    UUID        NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  device_id    VARCHAR(64)  NOT NULL,
  display_name VARCHAR(128),
  status       VARCHAR(32)  NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (sensor_id, device_id)
);

-- ─── Permissions ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sensor_permissions (
  id         UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_id  UUID     NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  can_view   BOOLEAN  NOT NULL DEFAULT true,
  can_export BOOLEAN  NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sensor_id)
);

-- ─── Time-Series Data ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raw_current_measurements (
  id            BIGSERIAL,
  sensor_sn     VARCHAR(64)   NOT NULL,
  device_id     VARCHAR(64)   NOT NULL,
  ts            TIMESTAMPTZ   NOT NULL,
  current_value DOUBLE PRECISION NOT NULL,
  msg_id        VARCHAR(128),
  source_topic  VARCHAR(255),
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (id, ts),
  -- Natural key: dedupe repeated sensor reports for the same (sensor, device, second).
  -- Must include the partition column `ts` to satisfy TimescaleDB hypertable rules.
  CONSTRAINT uq_raw_current_natural UNIQUE (sensor_sn, device_id, ts)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable(
  'raw_current_measurements', 'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

-- Indexes for common query patterns.
-- NOTE: (sensor_sn, device_id, ts) lookups are served by the uq_raw_current_natural
-- unique index above (a backward scan covers `ORDER BY ts DESC`), so no separate
-- index on those columns is needed.
CREATE INDEX IF NOT EXISTS idx_raw_current_sensor_ts
  ON raw_current_measurements (sensor_sn, ts DESC);

CREATE INDEX IF NOT EXISTS idx_raw_current_ts
  ON raw_current_measurements (ts DESC);

-- ─── Ingestion Tracking ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingestion_messages (
  id           BIGSERIAL   PRIMARY KEY,
  msg_id       VARCHAR(128),
  sensor_sn    VARCHAR(64),
  topic        VARCHAR(255) NOT NULL,
  payload_size INT          NOT NULL,
  device_count INT          NOT NULL DEFAULT 0,
  point_count  INT          NOT NULL DEFAULT 0,
  status       VARCHAR(32)  NOT NULL,
  error_message TEXT,
  received_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ingestion_error_logs (
  id                  BIGSERIAL   PRIMARY KEY,
  topic               VARCHAR(255) NOT NULL,
  error_type          VARCHAR(64),
  error_message       TEXT,
  raw_payload_base64  TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ─── Export Jobs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS export_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sensor_sn     VARCHAR(64)  NOT NULL,
  device_id     VARCHAR(64),
  start_time    TIMESTAMPTZ  NOT NULL,
  end_time      TIMESTAMPTZ  NOT NULL,
  resolution    VARCHAR(16)  NOT NULL,
  format        VARCHAR(16)  NOT NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'pending',
  file_path     TEXT,
  file_name     VARCHAR(255),
  file_size     BIGINT,
  row_count     BIGINT,
  error_message TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- ─── Audit Logs ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  action        VARCHAR(64)  NOT NULL,
  resource_type VARCHAR(64),
  resource_id   VARCHAR(128),
  metadata      JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
