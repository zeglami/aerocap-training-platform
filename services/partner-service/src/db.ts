import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  const count = (db.prepare('SELECT COUNT(*) AS c FROM partners').get() as { c: number }).c;
  if (count === 0) seedDatabase(db);

  return db;
}

function seedDatabase(db: DatabaseSync): void {
  const ins = db.prepare(`
    INSERT INTO partners
      (id, tenant_id, name, icao_code, type, contact_name, contact_email,
       contract_ref, contract_start, contract_end, max_pilots, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insMember = db.prepare(`
    INSERT INTO partner_members
      (id, tenant_id, partner_id, user_id, member_role, booking_authorized, status)
    VALUES (?,?,?,?,?,?,?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    // Air France (FR tenant)
    ins.run('partner-afr', 'tenant-demo', 'Air France', 'AFR', 'AIRLINE',
      'Isabelle Morel', 'training@airfrance.fr', 'AER-AFR-2026-001',
      '2026-01-01', null, 120, 'ACTIVE', 'admin-demo');

    // Corsair International (FR tenant)
    ins.run('partner-css', 'tenant-demo', 'Corsair International', 'CSS', 'AIRLINE',
      'Laurent Dupuis', 'ops@corsair.fr', 'AER-CSS-2026-002',
      '2026-02-01', '2027-01-31', 20, 'ACTIVE', 'admin-demo');

    // French Air & Space Force (FR tenant - military)
    ins.run('partner-fasf', 'tenant-demo', 'French Air & Space Force', 'FAF', 'MILITARY',
      'Commandant Girard', 'training@defense.gouv.fr', 'AER-FAF-2026-003',
      '2026-01-15', null, null, 'ACTIVE', 'admin-demo');

    // South African Airways (ZA tenant)
    ins.run('partner-saa', 'tenant-za', 'South African Airways', 'SAA', 'AIRLINE',
      'Themba Dlamini', 'training@flysaa.com', 'AER-SAA-2026-001',
      '2026-01-01', null, 60, 'ACTIVE', 'admin-za');

    // Members — Air France pilots
    insMember.run(randomUUID(), 'tenant-demo', 'partner-afr', 'pilot-alice',   'PILOT', 1, 'ACTIVE');
    insMember.run(randomUUID(), 'tenant-demo', 'partner-afr', 'pilot-bob',     'PILOT', 1, 'ACTIVE');
    insMember.run(randomUUID(), 'tenant-demo', 'partner-afr', 'pilot-sofia',   'PILOT', 1, 'ACTIVE');
    insMember.run(randomUUID(), 'tenant-demo', 'partner-afr', 'pilot-marc',    'PILOT', 0, 'ACTIVE');

    // Members — Corsair pilots
    insMember.run(randomUUID(), 'tenant-demo', 'partner-css', 'pilot-yuki',    'PILOT', 1, 'ACTIVE');
    insMember.run(randomUUID(), 'tenant-demo', 'partner-css', 'pilot-fatima',  'PILOT', 1, 'ACTIVE');

    db.exec('COMMIT');
    console.log('[partner-service seed] 4 partners, 6 members created');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
