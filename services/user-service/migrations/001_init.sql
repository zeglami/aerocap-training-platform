-- user-service SQLite schema

CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  region     TEXT NOT NULL CHECK(region IN ('FR','ZA','CN','IN')),
  plan       TEXT NOT NULL DEFAULT 'STANDARD' CHECK(plan IN ('STANDARD','ENTERPRISE')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'PILOT'
                       CHECK(role IN ('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR','PILOT','MANAGER','PARTNER_ADMIN')),
  booking_authorized INTEGER NOT NULL DEFAULT 0,
  signup_method      TEXT NOT NULL DEFAULT 'admin' CHECK(signup_method IN ('admin','self')),
  scope              TEXT DEFAULT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at         TEXT,
  UNIQUE(tenant_id, email)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_pending   ON users(tenant_id, booking_authorized, role);
