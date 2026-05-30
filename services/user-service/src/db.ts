import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

function txn(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try   { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Region code → tenant ID mapping (single source of truth)
export const REGION_TENANT: Record<string, string> = {
  FR: 'tenant-demo',
  ZA: 'tenant-za',
  CN: 'tenant-cn',
  IN: 'tenant-in',
};

export const TENANT_REGION: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_TENANT).map(([r, t]) => [t, r])
);

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  // Migration: add MANAGER role + scope column to existing DBs (idempotent)
  try {
    const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
    if (info && !info.sql.includes("'MANAGER'")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE users_v2 (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'PILOT'
            CHECK(role IN ('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR','PILOT','MANAGER')),
          booking_authorized INTEGER NOT NULL DEFAULT 0,
          signup_method TEXT NOT NULL DEFAULT 'admin' CHECK(signup_method IN ('admin','self')),
          scope TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
          deleted_at TEXT,
          UNIQUE(tenant_id, email)
        );
        INSERT INTO users_v2 (id,tenant_id,email,password_hash,first_name,last_name,role,booking_authorized,signup_method,created_at,updated_at,deleted_at)
          SELECT id,tenant_id,email,password_hash,first_name,last_name,role,booking_authorized,signup_method,created_at,updated_at,deleted_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_v2 RENAME TO users;
        CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_pending ON users(tenant_id,booking_authorized,role);
        PRAGMA foreign_keys = ON;
      `);
      console.log('[migration] users: MANAGER role + scope column applied');
    }
  } catch (e) { console.error('[migration] users migration failed:', e); }

  const row = db.prepare('SELECT COUNT(*) AS count FROM tenants').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  // Always ensure CN/IN tenants and manager accounts exist (idempotent inserts)
  ensureExtendedSeed(db);

  return db;
}

function h(pw: string) { return bcrypt.hashSync(pw, 10); }

function seedDatabase(db: DatabaseSync): void {
  txn(db, () => {
    // ── Tenants ──────────────────────────────────────────────────────────────
    const insTenant = db.prepare('INSERT INTO tenants (id, name, slug, region, plan) VALUES (?,?,?,?,?)');
    insTenant.run('tenant-demo', 'AeroCap France',       'aerocap-france',       'FR', 'ENTERPRISE');
    insTenant.run('tenant-za',   'AeroCap South Africa', 'aerocap-south-africa', 'ZA', 'ENTERPRISE');

    const ins = db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, booking_authorized, signup_method) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    const A = 'admin', S = 'self';

    // ── France — Staff ────────────────────────────────────────────────────────
    ins.run('admin-eric',        'tenant-demo', 'admin@demo.com',          h('admin123'), 'Éric',         'Moreau',    'GLOBAL_ADMIN', 1, A);
    // CFI / Chief Flight Instructor — doubles as instructor
    ins.run('instructor-jean',   'tenant-demo', 'j.dubois@aerocap.fr',     h('pilot123'), 'Jean-Pierre',  'Dubois',    'INSTRUCTOR',   1, A);
    // Senior TRI / EBT specialist
    ins.run('instructor-sophie', 'tenant-demo', 'm.bernard@aerocap.fr',    h('pilot123'), 'Marie-Claire', 'Bernard',   'INSTRUCTOR',   1, A);

    // ── France — Active Pilots ────────────────────────────────────────────────
    // A320 ITR student — 3 months into training, progressing well
    ins.run('pilot-alice',   'tenant-demo', 'a.martin@aerocap.fr',   h('pilot123'), 'Alice',   'Martin',   'PILOT', 1, A);
    // B737 captain — 8 200 h, OPC due next month
    ins.run('pilot-bob',     'tenant-demo', 'r.leroy@aerocap.fr',    h('pilot123'), 'Robert',  'Leroy',    'PILOT', 1, A);
    // A350 command upgrade candidate — 6 500 h, recent LPC pass
    ins.run('pilot-sofia',   'tenant-demo', 's.reyes@aerocap.fr',    h('pilot123'), 'Sofia',   'Reyes',    'PILOT', 1, A);
    // A320 line pilot — 5 100 h, annual recurrent upcoming
    ins.run('pilot-marc',    'tenant-demo', 'm.girard@aerocap.fr',   h('pilot123'), 'Marc',    'Girard',   'PILOT', 1, A);
    // B737 MAX ITR — recently started Phase 3 FFS
    ins.run('pilot-yuki',    'tenant-demo', 'y.tanaka@aerocap.fr',   h('pilot123'), 'Yuki',    'Tanaka',   'PILOT', 1, A);
    // A320 transferee from Air Maroc — starting ITR next week
    ins.run('pilot-fatima',  'tenant-demo', 'f.benali@aerocap.fr',   h('pilot123'), 'Fatima',  'Benali',   'PILOT', 1, A);
    // B737 F/O — open FPM deficit after last session
    ins.run('pilot-pierre',  'tenant-demo', 'p.dumont@aerocap.fr',   h('pilot123'), 'Pierre',  'Dumont',   'PILOT', 1, A);
    // A350 captain — just completed LPC, exemplary performer
    ins.run('pilot-camille', 'tenant-demo', 'c.rousseau@aerocap.fr', h('pilot123'), 'Camille', 'Rousseau', 'PILOT', 1, A);
    // Self-registered — pending training manager approval
    ins.run('pilot-pending', 'tenant-demo', 'newpilot@demo.com',     h('pilot123'), 'Lucas',   'Petit',    'PILOT', 0, S);

    // ── South Africa — Staff & Pilots ────────────────────────────────────────
    ins.run('admin-za',      'tenant-za', 'admin@aerocap.za',        h('admin123'), 'Nomvula',  'Dlamini', 'COUNTRY_ADMIN', 1, A);
    ins.run('instructor-za', 'tenant-za', 'sipho.zulu@aerocap.za',  h('pilot123'), 'Sipho',    'Zulu',    'INSTRUCTOR',    1, A);
    ins.run('pilot-amara',   'tenant-za', 'a.osei@aerocap.za',      h('pilot123'), 'Amara',    'Osei',    'PILOT',         1, A);
    ins.run('pilot-za-2',    'tenant-za', 'l.mokoena@aerocap.za',   h('pilot123'), 'Lerato',   'Mokoena', 'PILOT',         1, A);
    ins.run('pilot-za-3',    'tenant-za', 't.nkosi@aerocap.za',     h('pilot123'), 'Thabo',    'Nkosi',   'PILOT',         1, A);
  });

  console.log('[seed] Users: 2 tenants, 3 staff + 9 pilots (FR), 4 users (ZA) created');
}

function ensureExtendedSeed(db: DatabaseSync): void {
  // China and India tenants
  db.prepare('INSERT OR IGNORE INTO tenants (id, name, slug, region, plan) VALUES (?,?,?,?,?)').run(
    'tenant-cn', 'AeroCap China', 'aerocap-china', 'CN', 'ENTERPRISE'
  );
  db.prepare('INSERT OR IGNORE INTO tenants (id, name, slug, region, plan) VALUES (?,?,?,?,?)').run(
    'tenant-in', 'AeroCap India', 'aerocap-india', 'IN', 'ENTERPRISE'
  );

  // Manager accounts
  const ins = db.prepare(
    'INSERT OR IGNORE INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, booking_authorized, signup_method, scope) VALUES (?,?,?,?,?,?,?,?,?,?)'
  );
  const A = 'admin';

  ins.run('manager-fr',     'tenant-demo', 'manager.fr@demo.com',     h('manager123'), 'Claire',  'Fontaine', 'MANAGER', 1, A, '["FR"]');
  ins.run('manager-fr-za',  'tenant-demo', 'manager.eu@demo.com',     h('manager123'), 'Thomas',  'Renard',   'MANAGER', 1, A, '["FR","ZA"]');
  ins.run('manager-global', 'tenant-demo', 'manager.global@demo.com', h('manager123'), 'Nadia',   'Larousse', 'MANAGER', 1, A, 'GLOBAL');

  // China users
  ins.run(randomUUID(),        'tenant-cn', 'admin@aerocap.cn',       h('admin123'),   'Wei',     'Zhang',    'COUNTRY_ADMIN', 1, A, null);
  ins.run('instructor-cn',     'tenant-cn', 'instructor@aerocap.cn',  h('pilot123'),   'Ming',    'Li',       'INSTRUCTOR',    1, A, null);
  ins.run('pilot-cn-1',        'tenant-cn', 'pilot1@aerocap.cn',      h('pilot123'),   'Jing',    'Wang',     'PILOT',         1, A, null);
  ins.run('pilot-cn-2',        'tenant-cn', 'pilot2@aerocap.cn',      h('pilot123'),   'Fang',    'Chen',     'PILOT',         1, A, null);

  // India users
  ins.run(randomUUID(),        'tenant-in', 'admin@aerocap.in',       h('admin123'),   'Priya',   'Sharma',   'COUNTRY_ADMIN', 1, A, null);
  ins.run('instructor-in',     'tenant-in', 'instructor@aerocap.in',  h('pilot123'),   'Arjun',   'Patel',    'INSTRUCTOR',    1, A, null);
  ins.run('pilot-in-1',        'tenant-in', 'pilot1@aerocap.in',      h('pilot123'),   'Kavya',   'Nair',     'PILOT',         1, A, null);
  ins.run('pilot-in-2',        'tenant-in', 'pilot2@aerocap.in',      h('pilot123'),   'Rahul',   'Mehta',    'PILOT',         1, A, null);

  // South Africa — add instructor + extra pilot
  ins.run('instructor-za',     'tenant-za', 'instructor@afrasky.com', h('pilot123'),   'Sipho',   'Dlamini',  'INSTRUCTOR',    1, A, null);
  ins.run('pilot-za-2',        'tenant-za', 'pilot2@afrasky.com',     h('pilot123'),   'Lerato',  'Mokoena',  'PILOT',         1, A, null);
}
