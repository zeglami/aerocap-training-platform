-- booking-service SQLite schema

CREATE TABLE IF NOT EXISTS simulators (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  aircraft   TEXT NOT NULL,
  location   TEXT NOT NULL,
  capacity   INTEGER NOT NULL DEFAULT 1,
  image_url  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS slots (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  simulator_id TEXT NOT NULL REFERENCES simulators(id),
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  pilot_id     TEXT NOT NULL,
  slot_id      TEXT NOT NULL REFERENCES slots(id),
  simulator_id TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'RECURRENT'
                 CHECK(session_type IN ('ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE')),
  status       TEXT NOT NULL DEFAULT 'CONFIRMED'
                 CHECK(status IN ('PENDING','CONFIRMED','CANCELLED')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_simulator    ON slots(simulator_id, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_tenant       ON slots(tenant_id, is_available);
CREATE INDEX IF NOT EXISTS idx_reservations_pilot ON reservations(tenant_id, pilot_id);
