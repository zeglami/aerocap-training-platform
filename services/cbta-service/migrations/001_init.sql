-- cbta-service SQLite schema
-- Implements EASA CBTA (Competency-Based Training & Assessment) data model

CREATE TABLE IF NOT EXISTS competency_units (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'TECHNICAL',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS assessments (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  pilot_id            TEXT NOT NULL,
  instructor_id       TEXT NOT NULL,
  competency_unit_id  TEXT NOT NULL REFERENCES competency_units(id),
  score               INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
  markers             TEXT,   -- JSON array of observed behavioural markers
  notes               TEXT,
  assessed_at         TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_assessments_pilot     ON assessments(tenant_id, pilot_id);
CREATE INDEX IF NOT EXISTS idx_assessments_unit      ON assessments(tenant_id, competency_unit_id);
CREATE INDEX IF NOT EXISTS idx_competency_tenant     ON competency_units(tenant_id, code);
