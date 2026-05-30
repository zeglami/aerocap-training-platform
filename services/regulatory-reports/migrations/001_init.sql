-- regulatory-reports service SQLite schema

CREATE TABLE IF NOT EXISTS report_template (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  regulatory_framework TEXT NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','DGCA','CAAC','INTERNAL')),
  template_type TEXT NOT NULL CHECK (template_type IN ('PILOT_COMPLIANCE','FLEET_COMPLIANCE','AUTHORITY_AUDIT','INCIDENT_PACKAGE','TRAINING_LOG_EXTRACT')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  layout_spec TEXT NOT NULL DEFAULT '{}',
  is_authority_approved INTEGER NOT NULL DEFAULT 0,
  authority_approval_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT,
  UNIQUE (tenant_id, code, schema_version)
);
CREATE INDEX IF NOT EXISTS idx_tpl_tenant ON report_template (tenant_id, id);

CREATE TABLE IF NOT EXISTS report_run (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES report_template(id),
  scope TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  output_document_id TEXT,
  signed_at TEXT,
  signed_by TEXT,
  signature_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_tenant ON report_run (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_run_status ON report_run (tenant_id, status, requested_at);

CREATE TABLE IF NOT EXISTS report_document (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  report_run_id TEXT NOT NULL REFERENCES report_run(id),
  format TEXT NOT NULL CHECK (format IN ('PDF','JSON','CSV','XML')),
  storage_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_doc_tenant ON report_document (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_doc_run ON report_document (tenant_id, report_run_id);

CREATE TABLE IF NOT EXISTS pilot_compliance_snapshot (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  pilot_id TEXT NOT NULL,
  snapshot_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  q1_training_cycle_status TEXT NOT NULL CHECK (q1_training_cycle_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q2_medical_status TEXT NOT NULL CHECK (q2_medical_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q3_recency_status TEXT NOT NULL CHECK (q3_recency_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q4_cu_coverage_status TEXT NOT NULL CHECK (q4_cu_coverage_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q5_open_deficits_status TEXT NOT NULL CHECK (q5_open_deficits_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q6_instructor_qual_status TEXT NOT NULL CHECK (q6_instructor_qual_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q7_simulator_qual_status TEXT NOT NULL CHECK (q7_simulator_qual_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  payload TEXT NOT NULL DEFAULT '{}',
  overall_compliant INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_snap_tenant ON pilot_compliance_snapshot (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_snap_pilot ON pilot_compliance_snapshot (tenant_id, pilot_id, snapshot_at);

CREATE TABLE IF NOT EXISTS inspector_access_token (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  inspector_email TEXT NOT NULL,
  inspector_name TEXT NOT NULL,
  authority TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  valid_until TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  access_log TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_iat_tenant ON inspector_access_token (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iat_token ON inspector_access_token (tenant_id, token_hash);
