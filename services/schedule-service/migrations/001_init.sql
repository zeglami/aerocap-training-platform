-- schedule-service SQLite schema (dev) — Aurora PostgreSQL in production

-- Audit log: append-only, never soft-deleted
CREATE TABLE IF NOT EXISTS simulator_schedule_audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','ACTIVATE','COMPLETE','OVERRIDE')),
  actor_id    TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  old_value   TEXT,   -- JSON
  new_value   TEXT,   -- JSON
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ssal_tenant_entity ON simulator_schedule_audit_log (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ssal_actor ON simulator_schedule_audit_log (tenant_id, actor_id, created_at);

-- Operating schedules: weekly open-hours template per simulator or facility
CREATE TABLE IF NOT EXISTS operating_schedule (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  simulator_id   TEXT,   -- NULL = facility-wide
  name           TEXT NOT NULL,
  effective_from TEXT NOT NULL,   -- date ISO
  effective_until TEXT,           -- NULL = indefinite
  status         TEXT NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  time_zone      TEXT NOT NULL DEFAULT 'UTC',
  daily_windows  TEXT NOT NULL DEFAULT '[]',  -- JSON array of DailyWindow
  notes          TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_os_tenant_id ON operating_schedule (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_os_simulator ON operating_schedule (tenant_id, simulator_id, status);

-- Blocked periods: holidays, maintenance windows, closures
CREATE TABLE IF NOT EXISTS blocked_period (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  simulator_id    TEXT,   -- NULL = facility-wide
  block_type      TEXT NOT NULL CHECK (block_type IN (
    'HOLIDAY','MAINTENANCE','AUTHORITY_INSPECTION','WEATHER_CLOSURE','SPECIAL_EVENT','OTHER'
  )),
  title           TEXT NOT NULL,
  description     TEXT,
  start_at        TEXT NOT NULL,
  end_at          TEXT NOT NULL,
  is_public       INTEGER NOT NULL DEFAULT 1,   -- 0 = pilots see "unavailable", 1 = pilots see title
  recurrence_rule TEXT,
  affects_slots   INTEGER NOT NULL DEFAULT 1,
  propagated_at   TEXT,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at      TEXT,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_bp_tenant_id  ON blocked_period (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_bp_range      ON blocked_period (tenant_id, start_at, end_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bp_simulator  ON blocked_period (tenant_id, simulator_id, start_at)
  WHERE deleted_at IS NULL;

-- Maintenance records: linked to a blocked_period
CREATE TABLE IF NOT EXISTS maintenance_record (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL,
  simulator_id                TEXT NOT NULL,
  blocked_period_id           TEXT REFERENCES blocked_period(id),
  maintenance_type            TEXT NOT NULL CHECK (maintenance_type IN (
    'SCHEDULED_100H','SCHEDULED_500H','ANNUAL_RECERTIFICATION',
    'COMPONENT_REPLACEMENT','SOFTWARE_UPGRADE','UNSCHEDULED','FSTD_REQUALIFICATION'
  )),
  title                       TEXT NOT NULL,
  description                 TEXT,
  planned_start_at            TEXT NOT NULL,
  planned_end_at              TEXT NOT NULL,
  actual_start_at             TEXT,
  actual_end_at               TEXT,
  status                      TEXT NOT NULL DEFAULT 'PLANNED'
                                CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  technician_name             TEXT,
  authority_reference_number  TEXT,
  partial_operation_allowed   INTEGER NOT NULL DEFAULT 0,
  qualification_level_during  TEXT,
  completion_notes            TEXT,
  created_by                  TEXT NOT NULL,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                  TEXT,
  CHECK (planned_end_at > planned_start_at)
);
CREATE INDEX IF NOT EXISTS idx_mr_tenant_id ON maintenance_record (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_mr_simulator ON maintenance_record (tenant_id, simulator_id, status);

-- Availability overrides: extend open hours outside regular schedule
CREATE TABLE IF NOT EXISTS availability_override (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  simulator_id TEXT,
  title        TEXT NOT NULL,
  start_at     TEXT NOT NULL,
  end_at       TEXT NOT NULL,
  reason       TEXT,
  is_public    INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at   TEXT,
  CHECK (end_at > start_at)
);
CREATE INDEX IF NOT EXISTS idx_ao_tenant_id ON availability_override (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_ao_range     ON availability_override (tenant_id, start_at, end_at)
  WHERE deleted_at IS NULL;

-- National holiday calendar: reference data per region
CREATE TABLE IF NOT EXISTS national_holiday_calendar (
  id                TEXT PRIMARY KEY,
  region            TEXT NOT NULL CHECK (region IN ('FR','ZA','CN','IN')),
  year              INTEGER NOT NULL,
  holiday_date      TEXT NOT NULL,
  name              TEXT NOT NULL,
  is_full_day       INTEGER NOT NULL DEFAULT 1,
  auto_create_block INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (region, holiday_date, name)
);
CREATE INDEX IF NOT EXISTS idx_nhc_region_year ON national_holiday_calendar (region, year);
