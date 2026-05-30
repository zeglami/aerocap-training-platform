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
  db.exec(readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8'));

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM pilot_profiles').get() as { count: number };
  if (count === 0) seedDatabase(db);
  ensureCountryProfiles(db);
  return db;
}

// Generate notifications for licences expiring within `days` days
export function generateExpiryNotifications(db: DatabaseSync): void {
  const soon90 = new Date(); soon90.setDate(soon90.getDate() + 90);
  const soon30  = new Date(); soon30.setDate(soon30.getDate() + 30);
  const today   = new Date().toISOString().slice(0, 10);
  const soon30s = soon30.toISOString().slice(0, 10);
  const soon90s = soon90.toISOString().slice(0, 10);

  const licences = db.prepare(
    `SELECT * FROM licences WHERE expires_at <= ?`
  ).all(soon90s) as Array<Record<string, string>>;

  const insNotif = db.prepare(
    `INSERT OR IGNORE INTO notifications (id, tenant_id, pilot_id, type, title, message, severity, reference_id)
     VALUES (?,?,?,?,?,?,?,?)`
  );

  for (const lic of licences) {
    const expiry   = lic.expires_at;
    const isExp    = expiry < today;
    const isSoon30 = expiry >= today && expiry <= soon30s;
    const typeName = lic.type.replace('_', ' ');
    const daysLeft = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);

    const type     = isExp ? 'LICENCE_EXPIRED' : 'LICENCE_EXPIRY';
    const severity = isExp ? 'DANGER' : isSoon30 ? 'WARNING' : 'INFO';
    const title    = isExp ? `${typeName} licence expired` : `${typeName} expiring soon`;
    const message  = isExp
      ? `Your ${typeName} licence expired on ${expiry}. Immediate action required.`
      : `Your ${typeName} licence expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${expiry}).`;

    // Use reference_id to prevent duplicates across restarts
    const refKey = `${lic.id}-${expiry}-${isExp ? 'exp' : 'warn'}`;
    insNotif.run(randomUUID(), lic.tenant_id, lic.pilot_id, type, title, message, severity, refKey);
  }
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedDatabase(db: DatabaseSync): void {
  const insProfile = db.prepare(
    'INSERT INTO pilot_profiles (pilot_id, tenant_id, licence_number, nationality, date_of_birth, home_base, total_hours, simulator_hours, notes) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const insLic = db.prepare(
    'INSERT INTO licences (id, tenant_id, pilot_id, type, number, issuing_authority, issued_at, expires_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  const insRating = db.prepare(
    'INSERT INTO type_ratings (id, tenant_id, pilot_id, aircraft_type, aircraft_full, rated_at, expires_at) VALUES (?,?,?,?,?,?,?)'
  );

  txn(db, () => {

    // ── ALICE MARTIN — A320 ITR student, 2 800 h, Medical expiring in 42 days ─
    insProfile.run('pilot-alice', 'tenant-demo', 'FR.ATPL.24189', 'French', '1992-07-14', 'CDG', 2820, 310, 'A320 ITR in progress — Phase 3 FFS. Shows strong AP and FPM. COM needs monitoring.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-alice', 'ATPL',            'FR.ATPL.24189',  'DGAC France', '2020-03-15', '2026-03-15');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-alice', 'IR',              'FR.IR.24189',    'DGAC France', '2022-06-10', daysFromNow(185));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-alice', 'MEDICAL_CLASS1',  'MED-FR-24189',   'DGAC France', '2024-08-01', daysFromNow(42));  // ⚠️ 42 days — WARNING
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-alice', 'ENGLISH_LANGUAGE','ELP-FR-24189',   'DGAC France', '2021-04-20', daysFromNow(730));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-alice', 'A320', 'Airbus A320neo (CFM)', '2019-05-22', daysFromNow(-30)); // OPC recently due

    // ── ROBERT LEROY — B737 captain, 8 200 h, OPC due in 18 days ─────────────
    insProfile.run('pilot-bob', 'tenant-demo', 'FR.ATPL.10834', 'French', '1975-03-22', 'CDG', 8240, 680, 'Senior captain, 4 100 h on B737. OPC check due imminently. Excellent record except SA deficit resolved Feb 2026.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'ATPL',            'FR.ATPL.10834',  'DGAC France', '2005-11-20', '2027-11-20');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'IR',              'FR.IR.10834',    'DGAC France', '2024-06-01', daysFromNow(360));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'MEDICAL_CLASS1',  'MED-FR-10834',   'DGAC France', '2025-10-01', daysFromNow(210));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'ENGLISH_LANGUAGE','ELP-FR-10834',   'DGAC France', '2019-07-10', daysFromNow(1100));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'B737', 'Boeing 737 MAX 8',    '2015-04-12', daysFromNow(18));  // ⚠️ TR expiry in 18 days
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-bob', 'A320', 'Airbus A320-214',     '2009-09-03', daysFromNow(-400)); // expired — historical

    // ── SOFIA REYES — A350 command upgrade candidate, 6 500 h ─────────────────
    insProfile.run('pilot-sofia', 'tenant-demo', 'FR.ATPL.38211', 'Spanish', '1985-11-08', 'CDG', 6540, 520, 'Command upgrade candidate. 2 200 h on A350 SIC. LPC passed 15 May 2026. Recommended for captain upgrade.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'ATPL',            'FR.ATPL.38211',  'DGAC France', '2014-02-14', '2028-02-14');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'IR',              'FR.IR.38211',    'DGAC France', '2024-05-15', daysFromNow(350));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'MEDICAL_CLASS1',  'MED-FR-38211',   'DGAC France', '2025-04-01', daysFromNow(306));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'ENGLISH_LANGUAGE','ELP-FR-38211',   'DGAC France', '2022-08-30', daysFromNow(850));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'A350', 'Airbus A350-941',  '2021-11-20', daysFromNow(540));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-sofia', 'A320', 'Airbus A320neo',   '2016-09-10', daysFromNow(180));

    // ── MARC GIRARD — A320 line pilot, 5 100 h, stable performer ─────────────
    insProfile.run('pilot-marc', 'tenant-demo', 'FR.ATPL.52109', 'French', '1980-06-30', 'CDG', 5120, 440, 'Solid A320 line pilot. 3 200 h on type. Annual recurrent scheduled.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-marc', 'ATPL',            'FR.ATPL.52109',  'DGAC France', '2010-09-01', '2026-09-01');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-marc', 'IR',              'FR.IR.52109',    'DGAC France', '2024-09-01', daysFromNow(460));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-marc', 'MEDICAL_CLASS1',  'MED-FR-52109',   'DGAC France', '2025-02-10', daysFromNow(255));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-marc', 'ENGLISH_LANGUAGE','ELP-FR-52109',   'DGAC France', '2020-03-12', daysFromNow(920));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-marc', 'A320', 'Airbus A320-214', '2017-06-18', daysFromNow(400));

    // ── YUKI TANAKA — B737 MAX ITR, Phase 3 FFS in progress ──────────────────
    insProfile.run('pilot-yuki', 'tenant-demo', 'FR.ATPL.71802', 'Japanese', '1990-02-15', 'CDG', 3910, 290, 'B737 MAX ITR. FFS Phase 3 session 4/8. Score range currently 2–3, coaching on FPM and COM.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-yuki', 'ATPL',            'FR.ATPL.71802',  'DGAC France', '2019-04-10', daysFromNow(25));  // ⚠️ 25 days — ACTION NEEDED
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-yuki', 'IR',              'FR.IR.71802',    'DGAC France', '2023-11-22', daysFromNow(540));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-yuki', 'MEDICAL_CLASS1',  'MED-FR-71802',   'DGAC France', '2025-01-20', daysFromNow(234));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-yuki', 'ENGLISH_LANGUAGE','ELP-FR-71802',   'DGAC France', '2021-07-15', daysFromNow(600));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-yuki', 'B777', 'Boeing 777-300ER', '2021-08-20', daysFromNow(450));

    // ── FATIMA BENALI — A320 transferee, ITR week 1 ───────────────────────────
    insProfile.run('pilot-fatima', 'tenant-demo', 'MA.ATPL.FR88341', 'Moroccan', '1993-09-04', 'CDG', 3450, 180, 'Transferee from Royal Air Maroc. A320 on type at Air Maroc. ITR cross-credit assessment pending. Strong COM and LT from airline background.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-fatima', 'ATPL',            'MA.ATPL.FR88341','DGAC France', '2018-06-20', '2028-06-20');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-fatima', 'IR',              'FR.IR.88341',    'DGAC France', '2025-01-10', daysFromNow(590));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-fatima', 'MEDICAL_CLASS1',  'MED-FR-88341',   'DGAC France', '2025-03-15', daysFromNow(288));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-fatima', 'ENGLISH_LANGUAGE','ELP-FR-88341',   'DGAC France', '2022-05-10', daysFromNow(730));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-fatima', 'A320', 'Airbus A320neo', '2023-02-14', daysFromNow(260));

    // ── PIERRE DUMONT — B737 F/O, open FPM deficit ───────────────────────────
    insProfile.run('pilot-pierre', 'tenant-demo', 'FR.ATPL.29954', 'French', '1987-12-01', 'CDG', 4800, 410, 'B737 F/O. 2 700 h on type. FPM deficit opened 15 May 2026 after scoring 2 in recurrent. Remedial briefing scheduled.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-pierre', 'ATPL',            'FR.ATPL.29954',  'DGAC France', '2013-08-05', '2027-08-05');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-pierre', 'IR',              'FR.IR.29954',    'DGAC France', '2024-08-05', daysFromNow(430));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-pierre', 'MEDICAL_CLASS1',  'MED-FR-29954',   'DGAC France', '2024-10-10', daysFromNow(132));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-pierre', 'ENGLISH_LANGUAGE','ELP-FR-29954',   'DGAC France', '2021-01-30', daysFromNow(780));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-pierre', 'B737', 'Boeing 737 MAX 8', '2019-03-01', daysFromNow(305));

    // ── CAMILLE ROUSSEAU — A350 captain, exemplary performer ─────────────────
    insProfile.run('pilot-camille', 'tenant-demo', 'FR.ATPL.20017', 'French', '1978-04-25', 'CDG', 11200, 890, 'A350 captain, 5 100 h on type. LPC completed 20 May 2026 — PASS all 8 CUs at 4+. Role model for CRM. Candidate for TRI endorsement.');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'ATPL',            'FR.ATPL.20017',  'DGAC France', '2002-11-14', '2028-11-14');
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'IR',              'FR.IR.20017',    'DGAC France', '2025-05-20', daysFromNow(355));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'MEDICAL_CLASS1',  'MED-FR-20017',   'DGAC France', '2025-09-01', daysFromNow(460));
    insLic.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'ENGLISH_LANGUAGE','ELP-FR-20017',   'DGAC France', '2020-12-01', daysFromNow(1200));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'A350', 'Airbus A350-941',  '2016-07-08', daysFromNow(355));
    insRating.run(randomUUID(), 'tenant-demo', 'pilot-camille', 'A320', 'Airbus A320-214',  '2008-03-21', daysFromNow(650));

    // ── SOUTH AFRICA ─────────────────────────────────────────────────────────
    insProfile.run('pilot-amara', 'tenant-za', 'ZA.ATPL.10044', 'Ghanaian', '1989-05-11', 'JNB', 3200, 240, 'A320 line pilot. SACAA jurisdiction. Annual OPC passed Jan 2026.');
    insLic.run(randomUUID(), 'tenant-za', 'pilot-amara', 'ATPL',           'ZA.ATPL.10044', 'SACAA', '2017-08-15', daysFromNow(450));
    insLic.run(randomUUID(), 'tenant-za', 'pilot-amara', 'IR',             'ZA.IR.10044',   'SACAA', '2024-01-10', daysFromNow(220));
    insLic.run(randomUUID(), 'tenant-za', 'pilot-amara', 'MEDICAL_CLASS1', 'MED-ZA-10044',  'SACAA', '2025-05-20', daysFromNow(355));
    insRating.run(randomUUID(), 'tenant-za', 'pilot-amara', 'A320', 'Airbus A320-214', '2021-03-10', daysFromNow(315));

    insProfile.run('pilot-za-2', 'tenant-za', 'ZA.ATPL.10129', 'South African', '1991-08-03', 'JNB', 2100, 190, 'B737 first officer. Recently completed initial type rating.');
    insLic.run(randomUUID(), 'tenant-za', 'pilot-za-2', 'ATPL',           'ZA.ATPL.10129', 'SACAA', '2020-02-28', daysFromNow(550));
    insLic.run(randomUUID(), 'tenant-za', 'pilot-za-2', 'MEDICAL_CLASS1', 'MED-ZA-10129',  'SACAA', '2025-07-14', daysFromNow(410));
    insRating.run(randomUUID(), 'tenant-za', 'pilot-za-2', 'B737', 'Boeing 737-800', '2022-11-05', daysFromNow(530));

    insProfile.run('pilot-za-3', 'tenant-za', 'ZA.ATPL.10203', 'South African', '1983-01-17', 'JNB', 7800, 620, 'Senior A320 captain. High performer.');
    insLic.run(randomUUID(), 'tenant-za', 'pilot-za-3', 'ATPL',           'ZA.ATPL.10203', 'SACAA', '2008-06-01', daysFromNow(700));
    insLic.run(randomUUID(), 'tenant-za', 'pilot-za-3', 'MEDICAL_CLASS1', 'MED-ZA-10203',  'SACAA', '2025-11-30', daysFromNow(550));
    insRating.run(randomUUID(), 'tenant-za', 'pilot-za-3', 'A320', 'Airbus A320-214', '2012-04-22', daysFromNow(620));
  });

  // Generate expiry notifications from seed data
  generateExpiryNotifications(db);
  console.log('[seed] Pilot profiles, licences, type ratings + notifications inserted');
}

function ensureCountryProfiles(db: DatabaseSync): void {
  const insProfile = db.prepare(
    'INSERT OR IGNORE INTO pilot_profiles (pilot_id, tenant_id, licence_number, nationality, total_hours, simulator_hours) VALUES (?,?,?,?,?,?)'
  );
  const insLicence = db.prepare(
    'INSERT OR IGNORE INTO licences (id, tenant_id, pilot_id, type, number, issuing_authority, issued_at, expires_at) VALUES (?,?,?,?,?,?,?,?)'
  );

  const profiles = [
    { pilotId: 'pilot-cn-1',  tenantId: 'tenant-cn', licence: 'CAAC-CN-001', nationality: 'Chinese',  hours: 2800, simHours: 320, auth: 'CAAC' },
    { pilotId: 'pilot-cn-2',  tenantId: 'tenant-cn', licence: 'CAAC-CN-002', nationality: 'Chinese',  hours: 1950, simHours: 210, auth: 'CAAC' },
    { pilotId: 'pilot-in-1',  tenantId: 'tenant-in', licence: 'DGCA-IN-001', nationality: 'Indian',   hours: 3100, simHours: 280, auth: 'DGCA' },
    { pilotId: 'pilot-in-2',  tenantId: 'tenant-in', licence: 'DGCA-IN-002', nationality: 'Indian',   hours: 2200, simHours: 195, auth: 'DGCA' },
    { pilotId: 'pilot-za-2',  tenantId: 'tenant-za', licence: 'SACAA-ZA-003', nationality: 'South African', hours: 4100, simHours: 440, auth: 'SACAA' },
  ];

  txn(db, () => {
    const future2y = new Date(); future2y.setFullYear(future2y.getFullYear() + 2);
    const future1y = new Date(); future1y.setFullYear(future1y.getFullYear() + 1);
    const past1y   = new Date(); past1y.setFullYear(past1y.getFullYear() - 1);

    for (const p of profiles) {
      insProfile.run(p.pilotId, p.tenantId, p.licence, p.nationality, p.hours, p.simHours);
      insLicence.run(randomUUID(), p.tenantId, p.pilotId, 'ATPL',           p.licence,     p.auth, past1y.toISOString().slice(0,10), future2y.toISOString().slice(0,10));
      insLicence.run(randomUUID(), p.tenantId, p.pilotId, 'MEDICAL_CLASS1', `MED-${p.licence}`, p.auth, past1y.toISOString().slice(0,10), future1y.toISOString().slice(0,10));
    }
  });
}
