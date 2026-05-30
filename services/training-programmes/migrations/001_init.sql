-- training-programmes service SQLite schema

CREATE TABLE IF NOT EXISTS training_programme (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  aircraft_type TEXT NOT NULL,
  programme_type TEXT NOT NULL CHECK (programme_type IN ('TYPE_RATING','RECURRENT','OPC','LPC','EBT','MCC','JOC','UPRT','LIFUS','TRI_COURSE','TRE_COURSE')),
  regulatory_framework TEXT NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','DGCA','CAAC')),
  authority_approval_ref TEXT NOT NULL,
  approval_valid_from TEXT NOT NULL,
  approval_valid_until TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  supersedes_programme_id TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, code, version)
);
CREATE INDEX IF NOT EXISTS idx_programme_tenant ON training_programme (tenant_id, id);

CREATE TABLE IF NOT EXISTS programme_phase (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  programme_id TEXT NOT NULL REFERENCES training_programme(id),
  sequence INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  minimum_sessions INTEGER NOT NULL,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('GROUND','FFS','FTD','FNPT','AIRCRAFT','LIFUS','CBT')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, programme_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_phase_tenant ON programme_phase (tenant_id, id);

CREATE TABLE IF NOT EXISTS programme_module (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  phase_id TEXT NOT NULL REFERENCES programme_phase(id),
  sequence INTEGER NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  learning_objectives TEXT NOT NULL DEFAULT '[]',
  competency_unit_codes TEXT NOT NULL DEFAULT '[]',
  mandatory INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_module_tenant ON programme_module (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_module_phase ON programme_module (tenant_id, phase_id, sequence);

CREATE TABLE IF NOT EXISTS prerequisite (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  module_id TEXT NOT NULL REFERENCES programme_module(id),
  prerequisite_module_id TEXT NOT NULL REFERENCES programme_module(id),
  type TEXT NOT NULL CHECK (type IN ('HARD','SOFT')),
  waiver_allowed_by_role TEXT NOT NULL CHECK (waiver_allowed_by_role IN ('CFI','TRE','NONE')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, module_id, prerequisite_module_id)
);
CREATE INDEX IF NOT EXISTS idx_prereq_tenant ON prerequisite (tenant_id, id);

CREATE TABLE IF NOT EXISTS gate_criterion (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  phase_id TEXT NOT NULL REFERENCES programme_phase(id),
  criterion_type TEXT NOT NULL CHECK (criterion_type IN ('MIN_CU_SCORE','ALL_MODULES_COMPLETE','MEDICAL_VALID','RECENCY_OK','LIFUS_SECTORS_MIN','EXAMINER_SIGN_OFF')),
  parameters TEXT NOT NULL DEFAULT '{}',
  blocks_progression INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gate_tenant ON gate_criterion (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_gate_phase ON gate_criterion (tenant_id, phase_id);

CREATE TABLE IF NOT EXISTS programme_enrolment (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  programme_id TEXT NOT NULL REFERENCES training_programme(id),
  pilot_id TEXT NOT NULL,
  enrolled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expected_completion_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED','IN_PROGRESS','COMPLETED','WITHDRAWN','FAILED')),
  withdrawal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrolment_tenant ON programme_enrolment (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_enrolment_pilot ON programme_enrolment (tenant_id, pilot_id, status);

CREATE TABLE IF NOT EXISTS programme_progress (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  enrolment_id TEXT NOT NULL REFERENCES programme_enrolment(id),
  phase_id TEXT NOT NULL REFERENCES programme_phase(id),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','GATE_BLOCKED','COMPLETED','FAILED')),
  started_at TEXT,
  completed_at TEXT,
  gate_override_by TEXT,
  gate_override_reason TEXT,
  gate_override_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, enrolment_id, phase_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_tenant ON programme_progress (tenant_id, id);
