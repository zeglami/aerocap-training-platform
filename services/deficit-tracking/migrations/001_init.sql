-- deficit-tracking-service SQLite schema

CREATE TABLE IF NOT EXISTS deficit (
  id                           TEXT PRIMARY KEY,
  tenant_id                    TEXT NOT NULL,
  pilot_id                     TEXT NOT NULL,
  originating_assessment_id    TEXT NOT NULL,
  competency_unit_code         TEXT NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  originating_score            INTEGER NOT NULL CHECK (originating_score IN (1,2)),
  originating_session_id       TEXT NOT NULL,
  opened_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  severity                     TEXT NOT NULL CHECK (severity IN ('REMEDIAL','TRAINING_REQUIRED')),
  status                       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REASSESSMENT_SCHEDULED','UNDER_REMEDIATION','RESOLVED','ESCALATED','WAIVED')),
  due_at                       TEXT NOT NULL,
  escalated_at                 TEXT,
  resolved_at                  TEXT,
  resolution_assessment_id     TEXT,
  instructor_id                TEXT NOT NULL,
  cfi_id                       TEXT,
  waived_by                    TEXT,
  waived_reason                TEXT,
  waived_at                    TEXT,
  simulator_id                 TEXT NOT NULL,
  simulator_qualification_level TEXT NOT NULL,
  instructor_qualification     TEXT NOT NULL,
  session_type                 TEXT NOT NULL,
  assessed_at                  TEXT NOT NULL,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_deficit_tenant ON deficit (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_deficit_pilot  ON deficit (tenant_id, pilot_id, status);
CREATE INDEX IF NOT EXISTS idx_deficit_due    ON deficit (tenant_id, due_at);

CREATE TABLE IF NOT EXISTS remedial_action (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  deficit_id       TEXT NOT NULL REFERENCES deficit(id),
  action_type      TEXT NOT NULL CHECK (action_type IN ('BRIEFING','GROUND_TRAINING','FFS_SESSION','FTD_SESSION','LINE_OPS_FOCUS')),
  description      TEXT NOT NULL,
  planned_date     TEXT NOT NULL,
  completed_date   TEXT,
  instructor_id    TEXT NOT NULL,
  duration_minutes INTEGER,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_ra_tenant  ON remedial_action (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_ra_deficit ON remedial_action (tenant_id, deficit_id);

CREATE TABLE IF NOT EXISTS reassessment (
  id                             TEXT PRIMARY KEY,
  tenant_id                      TEXT NOT NULL,
  deficit_id                     TEXT NOT NULL REFERENCES deficit(id),
  scheduled_for                  TEXT NOT NULL,
  scheduled_slot_id              TEXT,
  conducted_at                   TEXT,
  conducted_by_instructor_id     TEXT,
  resulting_assessment_id        TEXT,
  outcome                        TEXT CHECK (outcome IN ('PASS','FAIL','NO_SHOW','CANCELLED')),
  simulator_id                   TEXT,
  simulator_qualification_level  TEXT,
  created_at                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                     TEXT
);
CREATE INDEX IF NOT EXISTS idx_reass_tenant  ON reassessment (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_reass_deficit ON reassessment (tenant_id, deficit_id);

CREATE TABLE IF NOT EXISTS deficit_escalation (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  deficit_id        TEXT NOT NULL REFERENCES deficit(id),
  escalation_level  TEXT NOT NULL CHECK (escalation_level IN ('LEVEL_1_CFI','LEVEL_2_HEAD_OF_TRAINING','LEVEL_3_AUTHORITY')),
  triggered_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  triggered_by      TEXT NOT NULL CHECK (triggered_by IN ('SYSTEM','USER')),
  acknowledged_at   TEXT,
  acknowledged_by   TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_esc_tenant  ON deficit_escalation (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_esc_deficit ON deficit_escalation (tenant_id, deficit_id);
