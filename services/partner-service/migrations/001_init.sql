-- partner-service SQLite schema

CREATE TABLE IF NOT EXISTS partners (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  icao_code      TEXT,
  type           TEXT NOT NULL DEFAULT 'AIRLINE'
                   CHECK(type IN ('AIRLINE','MILITARY','TRAINING_ACADEMY','CORPORATE','CHARTER')),
  contact_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  contract_ref   TEXT,
  contract_start TEXT NOT NULL,
  contract_end   TEXT,
  max_pilots     INTEGER,
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK(status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  notes          TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at     TEXT,
  UNIQUE(tenant_id, icao_code)
);

CREATE INDEX IF NOT EXISTS idx_partners_tenant ON partners (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS partner_members (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  partner_id         TEXT NOT NULL REFERENCES partners(id),
  user_id            TEXT NOT NULL,
  member_role        TEXT NOT NULL DEFAULT 'PILOT'
                       CHECK(member_role IN ('PILOT','PARTNER_ADMIN','PARTNER_COORDINATOR')),
  booking_authorized INTEGER NOT NULL DEFAULT 0,
  authorized_by      TEXT,
  authorized_at      TEXT,
  joined_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  status             TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK(status IN ('ACTIVE','SUSPENDED','REMOVED')),
  notes              TEXT,
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members (partner_id, status)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_partner_members_user ON partner_members (tenant_id, user_id);
