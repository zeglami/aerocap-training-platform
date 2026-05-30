-- FTMC: Functional Training Management Center additions

CREATE TABLE IF NOT EXISTS competency_target (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  programme_id TEXT NOT NULL REFERENCES training_programme(id),
  phase_id TEXT REFERENCES programme_phase(id),
  competency_unit_code TEXT NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  minimum_score INTEGER NOT NULL DEFAULT 3 CHECK (minimum_score BETWEEN 1 AND 5),
  remedial_trigger_score INTEGER NOT NULL DEFAULT 2 CHECK (remedial_trigger_score BETWEEN 1 AND 5),
  required_assessment_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, programme_id, phase_id, competency_unit_code)
);
CREATE INDEX IF NOT EXISTS idx_ctarget_tenant ON competency_target (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_ctarget_programme ON competency_target (tenant_id, programme_id);

CREATE TABLE IF NOT EXISTS training_session_record (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  enrolment_id TEXT REFERENCES programme_enrolment(id),
  programme_module_id TEXT REFERENCES programme_module(id),
  reservation_id TEXT,
  pilot_id TEXT NOT NULL,
  instructor_id TEXT NOT NULL,
  instructor_qualification TEXT NOT NULL,
  examiner_required INTEGER NOT NULL DEFAULT 0,
  examiner_id TEXT,
  examiner_authorisation_ref TEXT,
  session_type TEXT NOT NULL CHECK (session_type IN ('ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE')),
  scenario_id TEXT,
  aircraft_type TEXT NOT NULL,
  simulator_id TEXT,
  simulator_qualification_level TEXT CHECK (simulator_qualification_level IN ('FFS_A','FFS_B','FFS_C','FFS_D','FTD','FNPT','AIRCRAFT','N_A')),
  simulator_approval_ref TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  assessed_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('PASS','FURTHER_TRAINING_REQUIRED','FAIL','TRAINING_ONLY')),
  instructor_signature_hash TEXT,
  signed_at TEXT,
  locked_at TEXT,
  amendment_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tsr_tenant ON training_session_record (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_tsr_pilot ON training_session_record (tenant_id, pilot_id, assessed_at);
CREATE INDEX IF NOT EXISTS idx_tsr_enrolment ON training_session_record (tenant_id, enrolment_id);

CREATE TABLE IF NOT EXISTS competency_assessment (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  session_record_id TEXT NOT NULL REFERENCES training_session_record(id),
  competency_unit_code TEXT NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  behavioural_markers TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, session_record_id, competency_unit_code)
);
CREATE INDEX IF NOT EXISTS idx_cassmt_tenant ON competency_assessment (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_cassmt_session ON competency_assessment (tenant_id, session_record_id);

CREATE TABLE IF NOT EXISTS ftmc_audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON ftmc_audit_log (tenant_id, entity_type, entity_id);
