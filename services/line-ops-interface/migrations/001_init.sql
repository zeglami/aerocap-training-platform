-- line-ops-interface SQLite schema
-- Covers: Line Training Assignments, Sector Logs, Sector Assessments,
--         Line Check Releases, and Recency Events.

CREATE TABLE IF NOT EXISTS line_training_assignment (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL,
  pilot_id                  TEXT NOT NULL,
  programme_enrolment_id    TEXT NOT NULL,
  line_training_captain_id  TEXT NOT NULL,
  start_date                TEXT NOT NULL,
  planned_sectors           INTEGER NOT NULL CHECK (planned_sectors >= 1),
  completed_sectors         INTEGER NOT NULL DEFAULT 0,
  status                    TEXT NOT NULL DEFAULT 'PLANNED'
                              CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','TERMINATED')),
  termination_reason        TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                TEXT
);
CREATE INDEX IF NOT EXISTS idx_lta_tenant ON line_training_assignment (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_lta_pilot  ON line_training_assignment (tenant_id, pilot_id, status);

CREATE TABLE IF NOT EXISTS sector_log (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL,
  pilot_id                    TEXT NOT NULL,
  line_training_assignment_id TEXT REFERENCES line_training_assignment(id),
  flight_date                 TEXT NOT NULL,
  flight_number               TEXT NOT NULL,
  aircraft_registration       TEXT NOT NULL,
  aircraft_type               TEXT NOT NULL,
  departure_icao              TEXT NOT NULL,
  arrival_icao                TEXT NOT NULL,
  block_out_at                TEXT NOT NULL,
  takeoff_at                  TEXT NOT NULL,
  landing_at                  TEXT NOT NULL,
  block_in_at                 TEXT NOT NULL,
  block_time_minutes          INTEGER NOT NULL,
  flight_time_minutes         INTEGER NOT NULL,
  pilot_flying_role           TEXT NOT NULL CHECK (pilot_flying_role IN ('PF','PM')),
  commander_id                TEXT NOT NULL,
  instructor_id               TEXT,
  landings_count              INTEGER NOT NULL DEFAULT 1,
  takeoffs_count              INTEGER NOT NULL DEFAULT 1,
  night_flight_minutes        INTEGER NOT NULL DEFAULT 0,
  ifr_time_minutes            INTEGER NOT NULL DEFAULT 0,
  pic_time_minutes            INTEGER NOT NULL DEFAULT 0,
  sic_time_minutes            INTEGER NOT NULL DEFAULT 0,
  source                      TEXT NOT NULL CHECK (source IN ('EFB','OPS_SYSTEM','MANUAL')),
  immutable_after             TEXT NOT NULL,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                  TEXT,
  UNIQUE (tenant_id, pilot_id, flight_date, flight_number, departure_icao, arrival_icao)
);
CREATE INDEX IF NOT EXISTS idx_sl_tenant     ON sector_log (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_sl_pilot_date ON sector_log (tenant_id, pilot_id, flight_date);
CREATE INDEX IF NOT EXISTS idx_sl_assignment ON sector_log (tenant_id, line_training_assignment_id);

CREATE TABLE IF NOT EXISTS sector_assessment (
  id                           TEXT PRIMARY KEY,
  tenant_id                    TEXT NOT NULL,
  sector_log_id                TEXT NOT NULL REFERENCES sector_log(id),
  instructor_id                TEXT NOT NULL,
  debrief_at                   TEXT NOT NULL,
  overall_outcome              TEXT NOT NULL
                                 CHECK (overall_outcome IN ('SATISFACTORY','UNSATISFACTORY','RECOMMENDED_FOR_RELEASE')),
  competency_scores            TEXT NOT NULL DEFAULT '{}',
  narrative                    TEXT NOT NULL,
  simulator_id                 TEXT,
  simulator_qualification_level TEXT,
  instructor_qualification     TEXT NOT NULL,
  session_type                 TEXT NOT NULL DEFAULT 'LIFUS',
  assessed_at                  TEXT NOT NULL,
  immutable_after              TEXT NOT NULL,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at                   TEXT,
  UNIQUE (tenant_id, sector_log_id)
);
CREATE INDEX IF NOT EXISTS idx_sa_tenant ON sector_assessment (tenant_id, id);

CREATE TABLE IF NOT EXISTS line_check_release (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL,
  pilot_id                 TEXT NOT NULL,
  programme_enrolment_id   TEXT NOT NULL,
  released_at              TEXT NOT NULL,
  released_by              TEXT NOT NULL,
  sectors_accumulated      INTEGER NOT NULL,
  pic_requirement_met      INTEGER NOT NULL DEFAULT 0,
  narrative                TEXT NOT NULL,
  document_ref             TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at               TEXT,
  UNIQUE (tenant_id, programme_enrolment_id)
);
CREATE INDEX IF NOT EXISTS idx_lcr_tenant ON line_check_release (tenant_id, id);

CREATE TABLE IF NOT EXISTS recency_event (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  pilot_id       TEXT NOT NULL,
  event_type     TEXT NOT NULL CHECK (event_type IN ('LANDING','TAKEOFF','NIGHT_LANDING','IFR_APPROACH')),
  event_at       TEXT NOT NULL,
  sector_log_id  TEXT NOT NULL REFERENCES sector_log(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_re_tenant     ON recency_event (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_re_pilot_event ON recency_event (tenant_id, pilot_id, event_type, event_at);
