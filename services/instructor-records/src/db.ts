import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap.db');

export function txn(db: DatabaseSync, fn: () => void): void {
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

  const row = db.prepare('SELECT COUNT(*) AS count FROM instructor_record').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  return db;
}

function seedDatabase(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const TENANT = 'tenant-demo';

  // Instructor 1 — Jean (TRI / A320)
  const jeanId   = randomUUID();
  const jeanQId  = randomUUID();

  // Instructor 2 — Marie (TRE / B737) + examiner authorisation
  const marieId  = randomUUID();
  const marieQId = randomUUID();
  const marieEAId = randomUUID();

  txn(db, () => {
    // --- instructor records ---
    db.prepare(`
      INSERT INTO instructor_record
        (id, tenant_id, user_id, employee_number, primary_role, hire_date, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(jeanId, TENANT, 'instructor-jean', 'EMP-001', 'TRI', '2018-06-01', 'ACTIVE', now, now);

    db.prepare(`
      INSERT INTO instructor_record
        (id, tenant_id, user_id, employee_number, primary_role, hire_date, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(marieId, TENANT, 'instructor-marie', 'EMP-002', 'TRE', '2015-03-10', 'ACTIVE', now, now);

    // --- qualifications ---
    db.prepare(`
      INSERT INTO instructor_qualification
        (id, tenant_id, instructor_record_id, qualification_type, aircraft_type,
         regulatory_framework, authority_reference_number, issued_at, valid_from, valid_until,
         issuing_authority, restrictions, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      jeanQId, TENANT, jeanId, 'TRI', 'A320',
      'EASA', 'EASA.TRI.FR.A320.001', '2022-01-15', '2022-01-15', '2025-01-15',
      'DGAC', '[]', 'EXPIRED', now, now,
    );

    db.prepare(`
      INSERT INTO instructor_qualification
        (id, tenant_id, instructor_record_id, qualification_type, aircraft_type,
         regulatory_framework, authority_reference_number, issued_at, valid_from, valid_until,
         issuing_authority, restrictions, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      marieQId, TENANT, marieId, 'TRE', 'B737',
      'EASA', 'EASA.TRE.FR.B737.001', '2023-06-01', '2023-06-01', '2026-06-01',
      'DGAC', '[]', 'VALID', now, now,
    );

    // --- examiner authorisation for Marie ---
    db.prepare(`
      INSERT INTO examiner_authorisation
        (id, tenant_id, instructor_record_id, authorisation_type, aircraft_type,
         valid_from, valid_until, authority_reference_number, conducted_tests_count,
         restrictions, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      marieEAId, TENANT, marieId, 'OPC', 'B737',
      '2023-06-01', '2026-06-01', 'EASA.OPC.FR.B737.001', 0,
      '[]', now, now,
    );
  });

  console.log('[seed] instructor-records: 2 instructors, 2 qualifications, 1 examiner authorisation inserted');
}
