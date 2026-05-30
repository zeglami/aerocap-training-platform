-- instructor-records service SQLite schema

CREATE TABLE IF NOT EXISTS instructor_record (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  employee_number  TEXT NOT NULL,
  primary_role     TEXT NOT NULL CHECK (primary_role IN ('CFI','TRI','TRE','SFI','SFE','CRI','FI','IRI')),
  hire_date        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at       TEXT,
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, employee_number)
);
CREATE INDEX IF NOT EXISTS idx_instr_tenant ON instructor_record (tenant_id, id);

CREATE TABLE IF NOT EXISTS instructor_qualification (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  instructor_record_id      TEXT NOT NULL REFERENCES instructor_record(id),
  qualification_type        TEXT NOT NULL CHECK (qualification_type IN ('TRI','TRE','SFI','SFE','CRI','FI','IRI','EXAMINER_SE','EXAMINER_ME')),
  aircraft_type             TEXT NOT NULL,
  regulatory_framework      TEXT NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','DGCA','CAAC')),
  authority_reference_number TEXT NOT NULL,
  issued_at                 TEXT NOT NULL,
  valid_from                TEXT NOT NULL,
  valid_until               TEXT NOT NULL,
  issuing_authority         TEXT NOT NULL,
  restrictions              TEXT NOT NULL DEFAULT '[]',
  status                    TEXT NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','EXPIRING','EXPIRED','REVOKED')),
  revoked_at                TEXT,
  revoked_by                TEXT,
  revocation_reason         TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                TEXT,
  UNIQUE (tenant_id, authority_reference_number)
);
CREATE INDEX IF NOT EXISTS idx_iq_tenant     ON instructor_qualification (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_iq_instructor ON instructor_qualification (tenant_id, instructor_record_id, aircraft_type, status);

CREATE TABLE IF NOT EXISTS examiner_authorisation (
  id                         TEXT PRIMARY KEY,
  tenant_id                  TEXT NOT NULL,
  instructor_record_id       TEXT NOT NULL REFERENCES instructor_record(id),
  authorisation_type         TEXT NOT NULL CHECK (authorisation_type IN ('OPC','LPC','SKILL_TEST','PROFICIENCY_CHECK','TYPE_RATING_TEST')),
  aircraft_type              TEXT NOT NULL,
  valid_from                 TEXT NOT NULL,
  valid_until                TEXT NOT NULL,
  authority_reference_number TEXT NOT NULL,
  conducted_tests_count      INTEGER NOT NULL DEFAULT 0,
  restrictions               TEXT NOT NULL DEFAULT '[]',
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                 TEXT
);
CREATE INDEX IF NOT EXISTS idx_ea_tenant     ON examiner_authorisation (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_ea_instructor ON examiner_authorisation (tenant_id, instructor_record_id, aircraft_type);

CREATE TABLE IF NOT EXISTS instructor_training_record (
  id                           TEXT PRIMARY KEY,
  tenant_id                    TEXT NOT NULL,
  instructor_record_id         TEXT NOT NULL REFERENCES instructor_record(id),
  event_type                   TEXT NOT NULL CHECK (event_type IN ('INITIAL_COURSE','REFRESHER','STANDARDISATION','ASSESSMENT_OF_COMPETENCE','PROFICIENCY_CHECK')),
  event_date                   TEXT NOT NULL,
  valid_until                  TEXT NOT NULL,
  conducted_by_examiner_id     TEXT NOT NULL,
  simulator_id                 TEXT NOT NULL,
  simulator_qualification_level TEXT NOT NULL,
  outcome                      TEXT NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  document_ref                 TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_itr_tenant     ON instructor_training_record (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_itr_instructor ON instructor_training_record (tenant_id, instructor_record_id, event_type, event_date);

CREATE TABLE IF NOT EXISTS instructor_assignment_restriction (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  instructor_record_id TEXT NOT NULL REFERENCES instructor_record(id),
  restriction_type     TEXT NOT NULL CHECK (restriction_type IN ('NO_SOLO_LIFUS','UNDER_SUPERVISION','SPECIFIC_PROGRAMME')),
  parameters           TEXT NOT NULL DEFAULT '{}',
  valid_until          TEXT,
  imposed_by           TEXT NOT NULL,
  reason               TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_iar_tenant ON instructor_assignment_restriction (tenant_id, id);
