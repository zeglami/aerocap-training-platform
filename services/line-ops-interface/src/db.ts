import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap-line-ops.db');

export function txn(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  const row = db.prepare(
    'SELECT COUNT(*) AS count FROM line_training_assignment WHERE tenant_id = ?'
  ).get('tenant-demo') as { count: number };

  if (row.count === 0) seedDatabase(db);

  return db;
}

// ─── Seed data ────────────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

function dateOnlyDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function immutableAfter(): string {
  return new Date(Date.now() + 48 * 3600 * 1000).toISOString();
}

interface SectorSeed {
  id: string;
  flightDate: string;
  flightNumber: string;
  aircraftReg: string;
  departureIcao: string;
  arrivalIcao: string;
  blockOut: string;
  takeoff: string;
  landing: string;
  blockIn: string;
  blockMinutes: number;
  flightMinutes: number;
}

function seedDatabase(db: DatabaseSync): void {
  const ltaId     = randomUUID();
  const enrolId   = randomUUID();
  const tenantId  = 'tenant-demo';
  const pilotId   = 'pilot-alice';
  const captainId = 'instructor-jean';

  // ── Line Training Assignment ────────────────────────────────────────────────
  db.prepare(`
    INSERT INTO line_training_assignment
      (id, tenant_id, pilot_id, programme_enrolment_id, line_training_captain_id,
       start_date, planned_sectors, completed_sectors, status)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    ltaId, tenantId, pilotId, enrolId, captainId,
    dateOnlyDaysAgo(30), 100, 12, 'ACTIVE',
  );

  // ── Three sector logs over the past 45 days ────────────────────────────────
  // Sector 1: AF123  CDG→LHR, 45 days ago
  const s1BlockOut  = new Date(Date.now() - 45 * 24 * 3600 * 1000);
  s1BlockOut.setUTCHours(6, 30, 0, 0);
  const s1Takeoff   = new Date(s1BlockOut.getTime() + 12 * 60 * 1000);  // +12 min
  const s1Landing   = new Date(s1Takeoff.getTime()  + 65 * 60 * 1000);  // +65 min flight
  const s1BlockIn   = new Date(s1Landing.getTime()  + 10 * 60 * 1000);  // +10 min

  // Sector 2: BA456  LHR→AMS, 30 days ago
  const s2BlockOut  = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  s2BlockOut.setUTCHours(9, 0, 0, 0);
  const s2Takeoff   = new Date(s2BlockOut.getTime() + 15 * 60 * 1000);
  const s2Landing   = new Date(s2Takeoff.getTime()  + 55 * 60 * 1000);
  const s2BlockIn   = new Date(s2Landing.getTime()  + 8  * 60 * 1000);

  // Sector 3: LH789  FRA→BCN, 15 days ago
  const s3BlockOut  = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  s3BlockOut.setUTCHours(13, 45, 0, 0);
  const s3Takeoff   = new Date(s3BlockOut.getTime() + 18 * 60 * 1000);
  const s3Landing   = new Date(s3Takeoff.getTime()  + 100 * 60 * 1000);
  const s3BlockIn   = new Date(s3Landing.getTime()  + 12  * 60 * 1000);

  const sectors: SectorSeed[] = [
    {
      id:            randomUUID(),
      flightDate:    dateOnlyDaysAgo(45),
      flightNumber:  'AF123',
      aircraftReg:   'F-GKXA',
      departureIcao: 'LFPG',
      arrivalIcao:   'EGLL',
      blockOut:      s1BlockOut.toISOString(),
      takeoff:       s1Takeoff.toISOString(),
      landing:       s1Landing.toISOString(),
      blockIn:       s1BlockIn.toISOString(),
      blockMinutes:  Math.round((s1BlockIn.getTime()  - s1BlockOut.getTime()) / 60000),
      flightMinutes: Math.round((s1Landing.getTime()  - s1Takeoff.getTime())  / 60000),
    },
    {
      id:            randomUUID(),
      flightDate:    dateOnlyDaysAgo(30),
      flightNumber:  'BA456',
      aircraftReg:   'G-EUUE',
      departureIcao: 'EGLL',
      arrivalIcao:   'EHAM',
      blockOut:      s2BlockOut.toISOString(),
      takeoff:       s2Takeoff.toISOString(),
      landing:       s2Landing.toISOString(),
      blockIn:       s2BlockIn.toISOString(),
      blockMinutes:  Math.round((s2BlockIn.getTime()  - s2BlockOut.getTime()) / 60000),
      flightMinutes: Math.round((s2Landing.getTime()  - s2Takeoff.getTime())  / 60000),
    },
    {
      id:            randomUUID(),
      flightDate:    dateOnlyDaysAgo(15),
      flightNumber:  'LH789',
      aircraftReg:   'D-AINA',
      departureIcao: 'EDDF',
      arrivalIcao:   'LEBL',
      blockOut:      s3BlockOut.toISOString(),
      takeoff:       s3Takeoff.toISOString(),
      landing:       s3Landing.toISOString(),
      blockIn:       s3BlockIn.toISOString(),
      blockMinutes:  Math.round((s3BlockIn.getTime()  - s3BlockOut.getTime()) / 60000),
      flightMinutes: Math.round((s3Landing.getTime()  - s3Takeoff.getTime())  / 60000),
    },
  ];

  const insSector = db.prepare(`
    INSERT INTO sector_log (
      id, tenant_id, pilot_id, line_training_assignment_id,
      flight_date, flight_number, aircraft_registration, aircraft_type,
      departure_icao, arrival_icao,
      block_out_at, takeoff_at, landing_at, block_in_at,
      block_time_minutes, flight_time_minutes,
      pilot_flying_role, commander_id,
      landings_count, takeoffs_count,
      night_flight_minutes, ifr_time_minutes, pic_time_minutes, sic_time_minutes,
      source, immutable_after
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insRecency = db.prepare(`
    INSERT INTO recency_event (id, tenant_id, pilot_id, event_type, event_at, sector_log_id)
    VALUES (?,?,?,?,?,?)
  `);

  txn(db, () => {
    for (const s of sectors) {
      insSector.run(
        s.id, tenantId, pilotId, ltaId,
        s.flightDate, s.flightNumber, s.aircraftReg, 'A320neo',
        s.departureIcao, s.arrivalIcao,
        s.blockOut, s.takeoff, s.landing, s.blockIn,
        s.blockMinutes, s.flightMinutes,
        'PF', captainId,
        1, 1,
        0, 0, s.flightMinutes, 0,
        'MANUAL', immutableAfter(),
      );

      // LANDING recency event
      insRecency.run(randomUUID(), tenantId, pilotId, 'LANDING', s.landing, s.id);
      // TAKEOFF recency event
      insRecency.run(randomUUID(), tenantId, pilotId, 'TAKEOFF', s.takeoff, s.id);
    }
  });

  console.log('[seed] line-ops-interface: 1 LTA, 3 sectors, 6 recency events for tenant-demo');
}
