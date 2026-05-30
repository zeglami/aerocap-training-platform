-- hris-service: pilot profiles, licences, type ratings, notifications

CREATE TABLE IF NOT EXISTS pilot_profiles (
  pilot_id        TEXT PRIMARY KEY,       -- same as user.id
  tenant_id       TEXT NOT NULL,
  licence_number  TEXT,                   -- e.g. FR.ATPL.12345
  nationality     TEXT,
  date_of_birth   TEXT,
  home_base       TEXT,                   -- e.g. 'CDG', 'JNB'
  total_hours     INTEGER DEFAULT 0,      -- total flight hours
  simulator_hours INTEGER DEFAULT 0,      -- SIM hours logged on this platform
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS licences (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  pilot_id          TEXT NOT NULL,
  type              TEXT NOT NULL CHECK(type IN (
                      'ATPL','CPL','IR','MEDICAL_CLASS1','MEDICAL_CLASS2',
                      'ENGLISH_LANGUAGE','LAPL','PPL'
                    )),
  number            TEXT,
  issuing_authority TEXT,
  issued_at         TEXT,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS type_ratings (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  pilot_id      TEXT NOT NULL,
  aircraft_type TEXT NOT NULL,   -- 'B737', 'A320', 'B777', 'A350'
  aircraft_full TEXT NOT NULL,   -- 'Boeing 737 MAX 8'
  rated_at      TEXT NOT NULL,
  expires_at    TEXT,            -- NULL = no recency requirement
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  pilot_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK(type IN (
                 'LICENCE_EXPIRY','LICENCE_EXPIRED',
                 'BOOKING_CONFIRMED','BOOKING_CANCELLED',
                 'CBTA_ASSESSMENT','SYSTEM'
               )),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'INFO' CHECK(severity IN ('INFO','WARNING','DANGER')),
  is_read      INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_licences_pilot      ON licences(tenant_id, pilot_id);
CREATE INDEX IF NOT EXISTS idx_licences_expiry     ON licences(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_type_ratings_pilot  ON type_ratings(tenant_id, pilot_id);
CREATE INDEX IF NOT EXISTS idx_notifications_pilot ON notifications(tenant_id, pilot_id, is_read);
