-- ============================================================
-- 003: Seed Data
-- ============================================================

-- Insert default roles
INSERT INTO roles (code, name) VALUES
  ('admin',    'Administrator'),
  ('operator', 'Operator'),
  ('viewer',   'Viewer'),
  ('auditor',  'Auditor')
ON CONFLICT (code) DO NOTHING;

-- Note: The initial admin user is created by the backend on first startup
-- via the INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD environment variables.
-- This allows the password to be configured without hardcoding it in SQL.
