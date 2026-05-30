import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

function txn(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try   { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  // Migration 002 — idempotent via try/catch on ADD COLUMN
  try {
    const sql2 = readFileSync(join(__dirname, '..', 'migrations', '002_booking_rules.sql'), 'utf-8');
    for (const stmt of sql2.split(';').map(s => s.trim()).filter(Boolean)) {
      try { db.exec(stmt); } catch { /* column already exists — skip */ }
    }
  } catch { /* migration file not found in test env — skip */ }

  const row = db.prepare('SELECT COUNT(*) AS count FROM simulators').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  ensureCountryData(db);

  return db;
}

// AeroCap France — Paris CDG training centre
const SIMS = [
  { id:'sim-a320-1', tenantId:'tenant-demo', name:'Airbus A320neo — Sim 1', type:'FFS Level D', aircraft:'A320neo (CFM56)', location:'Paris CDG — Building A, Bay 1', capacity:2 },
  { id:'sim-a320-2', tenantId:'tenant-demo', name:'Airbus A321XLR — Sim 2', type:'FFS Level D', aircraft:'A321XLR (LEAP)',  location:'Paris CDG — Building A, Bay 2', capacity:2 },
  { id:'sim-737-1',  tenantId:'tenant-demo', name:'Boeing 737 MAX 8 — Sim 3',type:'FFS Level D', aircraft:'B737 MAX 8',      location:'Paris CDG — Building B, Bay 1', capacity:2 },
  { id:'sim-737-2',  tenantId:'tenant-demo', name:'Boeing 737 MAX 10 — Sim 4',type:'FFS Level D',aircraft:'B737 MAX 10',     location:'Paris CDG — Building B, Bay 2', capacity:2 },
  { id:'sim-a350',   tenantId:'tenant-demo', name:'Airbus A350-900 — Sim 5', type:'FFS Level D', aircraft:'A350-941',         location:'Paris CDG — Building C, Bay 1', capacity:2 },
  // South Africa — Johannesburg OR Tambo
  { id:'sim-za-a320', tenantId:'tenant-za',  name:'Airbus A320-214',          type:'FFS Level D', aircraft:'A320-214 (CFM)', location:'Johannesburg OR Tambo — Bay 1', capacity:2 },
  { id:'sim-za-737',  tenantId:'tenant-za',  name:'Boeing 737-800',           type:'FFS Level D', aircraft:'B737-800 (CFM)', location:'Johannesburg OR Tambo — Bay 2', capacity:2 },
];

// 4h blocks per day: 06:00, 10:00, 14:00, 18:00
const BLOCKS = [[6,4],[10,4],[14,4],[18,4]] as const;

// Build absolute date offset from today
function dateOffset(days: number, hour = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function seedDatabase(db: DatabaseSync): void {
  const insSim  = db.prepare('INSERT INTO simulators (id, tenant_id, name, type, aircraft, location, capacity) VALUES (?,?,?,?,?,?,?)');
  const insSlot = db.prepare('INSERT INTO slots (id, tenant_id, simulator_id, start_time, end_time) VALUES (?,?,?,?,?)');
  const insRes  = db.prepare('INSERT INTO reservations (id, tenant_id, pilot_id, slot_id, simulator_id, session_type, status, notes) VALUES (?,?,?,?,?,?,?,?)');

  // Map: simId → ordered list of available slot IDs per tenant
  const slotMap: Record<string, string[]> = {};

  txn(db, () => {
    for (const s of SIMS) {
      insSim.run(s.id, s.tenantId, s.name, s.type, s.aircraft, s.location, s.capacity);
      slotMap[s.id] = [];
    }

    // Generate 28 days of slots for every simulator
    for (let d = 1; d <= 28; d++) {
      for (const s of SIMS) {
        for (const [startH, durH] of BLOCKS) {
          const start = dateOffset(d, startH);
          const end   = new Date(start); end.setHours(startH + durH);
          const sid   = randomUUID();
          slotMap[s.id].push(sid);
          insSlot.run(sid, s.tenantId, s.id, start.toISOString(), end.toISOString());
        }
      }
    }

    // ── Confirmed reservations — realistic upcoming schedule ──────────────────
    // Each booking uses the NEXT available slot for that simulator
    const nextSlot = (simId: string) => slotMap[simId].shift()!;
    const book = (pilotId: string, simId: string, type: string, note: string, tenant = 'tenant-demo') => {
      const slotId = nextSlot(simId);
      if (!slotId) return;
      insRes.run(randomUUID(), tenant, pilotId, slotId, simId, type, 'CONFIRMED', note);
      db.prepare('UPDATE slots SET is_available = 0 WHERE id = ?').run(slotId);
    };

    // ALICE — A320 ITR Session 8 (final pre-check before examiner session)
    book('pilot-alice',   'sim-a320-1', 'ITR',        'ITR Sess 8/8 — LOFT: dual engine failure on departure CDG. Pre-examiner check.');
    // ALICE — ITR examiner session (OPC equivalent for type rating issue)
    book('pilot-alice',   'sim-a320-1', 'OPC',        'A320 ITR final check — Examiner: J.-P. Dubois (TRE). Scenario: engine fire + hydraulic failure.');

    // ROBERT — B737 OPC (annual proficiency check, type rating due in 18 days)
    book('pilot-bob',     'sim-737-1',  'OPC',        'Annual OPC B737 MAX 8 — FCL.740 revalidation. Dep CDG/LFPG RWY 27R, engine fail V1, rapid depressurisation FL350.');
    book('pilot-bob',     'sim-737-1',  'LINE_CHECK',  'B737 pre-OPC line check preparation. Crosswind limits + RNAV approaches.');

    // SOFIA — A350 command upgrade final LPC (already passed — confirmation session)
    book('pilot-sofia',   'sim-a350',   'LPC',        'Command upgrade LPC (final confirmation) — A350-941. All-weather CAT IIIb + unusual attitude recovery.');

    // MARC — A320 annual recurrent EBT session
    book('pilot-marc',    'sim-a320-2', 'EBT',        'Annual EBT recurrent — A320. Manoeuvre phase: windshear on approach + rejected T/O contaminated RWY.');
    book('pilot-marc',    'sim-a320-2', 'RECURRENT',  'Supplementary recurrent — fuel emergency + ATC failure procedure.');

    // YUKI — B737 MAX ITR Session 5 + 6
    book('pilot-yuki',    'sim-737-1',  'ITR',        'ITR Sess 5 — Abnormal procedures: engine flame-out at cruise, diversion LFLY.');
    book('pilot-yuki',    'sim-737-1',  'ITR',        'ITR Sess 6 — UPRT element + night ILS to minimums CAT I. FPM focus.');

    // FATIMA — A320 ITR start (cross-credit reduced syllabus)
    book('pilot-fatima',  'sim-a320-1', 'ITR',        'Cross-credit ITR Sess 1 — A320neo CFM. Normal procedures, FFS familiarisation.');
    book('pilot-fatima',  'sim-a320-1', 'ITR',        'Cross-credit ITR Sess 2 — Abnormal + emergency procedures. APU fire, TCAS RA.');

    // PIERRE — Remedial FFS session (FPM deficit reassessment)
    book('pilot-pierre',  'sim-737-2',  'RECURRENT',  'REMEDIAL session — FPM deficit reassessment. Focus: energy management, stabilised approach gate 1000ft. Briefing: J.-P. Dubois.');

    // CAMILLE — A350 EBT (post-LPC routine EBT)
    book('pilot-camille', 'sim-a350',   'EBT',        'EBT session — A350. Competency focus: WM and FPA (ETOPS diversion scenario + manual reversion).');

    // SOUTH AFRICA
    book('pilot-amara',   'sim-za-a320', 'OPC',       'Annual OPC — A320. SACAA CAT Part 61 revalidation. Dep FAOR.', 'tenant-za');
    book('pilot-za-2',    'sim-za-737',  'RECURRENT', 'B737-800 recurrent — wind shear + GPWS reactive.', 'tenant-za');
    book('pilot-za-3',    'sim-za-a320', 'LPC',       'LPC annual — A320 captain. Senior check. SACAA oversight flight.', 'tenant-za');
  });

  console.log('[seed] 7 simulators (5 FR + 2 ZA), 28-day slots, 15 realistic bookings created');
}

// Idempotent: adds ZA, CN, IN simulators + slots for countries that have none
export function ensureCountryData(db: DatabaseSync): void {
  const EXTRA_SIMS = [
    { id: 'sim-cn-737',  tenantId: 'tenant-cn', name: 'Boeing 737 MAX 8', type: 'FFS Level D', aircraft: 'B737 MAX 8',      location: 'Beijing Capital — Building A, Bay 1' },
    { id: 'sim-cn-a320', tenantId: 'tenant-cn', name: 'Airbus A320neo',   type: 'FFS Level D', aircraft: 'A320neo (CFM)',   location: 'Beijing Capital — Building A, Bay 2' },
    { id: 'sim-in-a320', tenantId: 'tenant-in', name: 'Airbus A320neo',   type: 'FFS Level D', aircraft: 'A320neo (IAE)', location: 'Mumbai CSIA — Building A, Bay 1' },
    { id: 'sim-in-737',  tenantId: 'tenant-in', name: 'Boeing 737-800',   type: 'FFS Level D', aircraft: 'B737-800 (CFM)', location: 'Mumbai CSIA — Building A, Bay 2' },
  ];

  const insSim  = db.prepare('INSERT OR IGNORE INTO simulators (id, tenant_id, name, type, aircraft, location, capacity) VALUES (?,?,?,?,?,?,?)');
  const insSlot = db.prepare('INSERT OR IGNORE INTO slots (id, tenant_id, simulator_id, start_time, end_time) VALUES (?,?,?,?,?)');

  const BLOCKS = [[6,4],[10,4],[14,4],[18,4]] as const;

  txn(db, () => {
    for (const s of EXTRA_SIMS) {
      const existing = db.prepare('SELECT id FROM simulators WHERE id = ?').get(s.id);
      if (existing) continue;

      insSim.run(s.id, s.tenantId, s.name, s.type, s.aircraft, s.location, 1);

      const now = new Date();
      for (let d = 1; d <= 21; d++) {
        const base = new Date(now);
        base.setDate(base.getDate() + d);
        for (const [startH, durH] of BLOCKS) {
          const start = new Date(base); start.setHours(startH, 0, 0, 0);
          const end   = new Date(start); end.setHours(startH + durH);
          insSlot.run(randomUUID(), s.tenantId, s.id, start.toISOString(), end.toISOString());
        }
      }
    }
  });
}
