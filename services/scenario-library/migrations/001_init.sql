-- scenario-library SQLite schema

CREATE TABLE IF NOT EXISTS scenario (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  code                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  aircraft_type         TEXT NOT NULL,
  scenario_category     TEXT NOT NULL CHECK (scenario_category IN ('NORMAL','ABNORMAL','EMERGENCY','LOFT','EBT','UPRT','CRM_FOCUS')),
  phase_of_flight       TEXT NOT NULL CHECK (phase_of_flight IN ('PREFLIGHT','TAXI','TAKEOFF','CLIMB','CRUISE','DESCENT','APPROACH','LANDING','GO_AROUND','ALL')),
  minimum_fstd_level    TEXT NOT NULL CHECK (minimum_fstd_level IN ('FNPT_II','FTD_2','FFS_C','FFS_D')),
  approval_status       TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT','APPROVED','RETIRED')),
  authority_approval_ref TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  supersedes_scenario_id TEXT,
  description           TEXT,
  duration_minutes      INTEGER NOT NULL,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at            TEXT,
  UNIQUE (tenant_id, code, version)
);
CREATE INDEX IF NOT EXISTS idx_scen_tenant   ON scenario (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_scen_aircraft ON scenario (tenant_id, aircraft_type, approval_status);

CREATE TABLE IF NOT EXISTS scenario_initial_condition (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  scenario_id  TEXT NOT NULL REFERENCES scenario(id),
  airport_icao TEXT NOT NULL,
  runway       TEXT NOT NULL,
  weight_kg    INTEGER NOT NULL,
  fuel_kg      INTEGER NOT NULL,
  cg_percent   REAL NOT NULL,
  weather      TEXT NOT NULL DEFAULT '{}',
  ata_chapter_refs TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sic_tenant ON scenario_initial_condition (tenant_id, id);

CREATE TABLE IF NOT EXISTS scenario_injection (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  scenario_id           TEXT NOT NULL REFERENCES scenario(id),
  sequence              INTEGER NOT NULL,
  trigger_type          TEXT NOT NULL CHECK (trigger_type IN ('TIME','EVENT','PHASE','ATC')),
  trigger_spec          TEXT NOT NULL DEFAULT '{}',
  malfunction_code      TEXT NOT NULL,
  description           TEXT NOT NULL,
  expected_crew_response TEXT NOT NULL,
  severity              TEXT NOT NULL CHECK (severity IN ('NORMAL','ABNORMAL','EMERGENCY')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at            TEXT,
  UNIQUE (tenant_id, scenario_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_inj_tenant ON scenario_injection (tenant_id, id);

CREATE TABLE IF NOT EXISTS scenario_competency_mapping (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  scenario_id          TEXT NOT NULL REFERENCES scenario(id),
  competency_unit_code TEXT NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  weight               INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 5),
  observable_behaviours TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at           TEXT,
  UNIQUE (tenant_id, scenario_id, competency_unit_code)
);
CREATE INDEX IF NOT EXISTS idx_scm_tenant ON scenario_competency_mapping (tenant_id, id);

CREATE TABLE IF NOT EXISTS scenario_approval (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  scenario_id        TEXT NOT NULL REFERENCES scenario(id),
  approved_by        TEXT NOT NULL,
  approved_at        TEXT NOT NULL,
  authority_reference TEXT NOT NULL,
  valid_from         TEXT NOT NULL,
  valid_until        TEXT NOT NULL,
  revoked_at         TEXT,
  revoked_by         TEXT,
  revoke_reason      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sa_tenant ON scenario_approval (tenant_id, id);

CREATE TABLE IF NOT EXISTS scenario_brief_template (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  scenario_id       TEXT NOT NULL REFERENCES scenario(id),
  brief_markdown    TEXT NOT NULL,
  debrief_markdown  TEXT NOT NULL,
  instructor_notes  TEXT,
  pilot_preread_refs TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at        TEXT,
  UNIQUE (tenant_id, scenario_id)
);
CREATE INDEX IF NOT EXISTS idx_sbt_tenant ON scenario_brief_template (tenant_id, id);
