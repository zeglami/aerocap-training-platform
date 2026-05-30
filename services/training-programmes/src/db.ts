import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap-training.db');

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

  const row = db.prepare('SELECT COUNT(*) AS count FROM training_programme').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  // Migration 002: FTMC new tables + column additions (idempotent)
  const has002 = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='training_session_record'"
  ).get();
  if (!has002) {
    const sql002 = readFileSync(join(__dirname, '..', 'migrations', '002_ftmc.sql'), 'utf-8');
    db.exec(sql002);
    console.log('[migration] 002_ftmc applied');
  }

  // Add columns to existing tables (idempotent — catch on duplicate)
  const columnMigrations = [
    "ALTER TABLE programme_phase ADD COLUMN gate_strategy TEXT NOT NULL DEFAULT 'ALL_CRITERIA'",
    "ALTER TABLE programme_phase ADD COLUMN planned_duration_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE programme_module ADD COLUMN session_type TEXT",
    "ALTER TABLE programme_module ADD COLUMN minimum_duration_minutes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE programme_module ADD COLUMN minimum_overall_score INTEGER",
    "ALTER TABLE gate_criterion ADD COLUMN evidence_service TEXT",
    "ALTER TABLE training_programme ADD COLUMN regulatory_basis TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE training_programme ADD COLUMN validity_months INTEGER",
    "ALTER TABLE training_programme ADD COLUMN prerequisite_ratings TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE programme_enrolment ADD COLUMN enrolled_by TEXT",
  ];
  for (const stmt of columnMigrations) {
    try { db.exec(stmt); } catch { /* column already exists */ }
  }

  return db;
}

function seedDatabase(db: DatabaseSync): void {
  const progId    = 'prog-a320-initial';
  const phase1Id  = 'phase-cbt-ground';
  const phase2Id  = 'phase-fbs';
  const phase3Id  = 'phase-ffs';
  const enrolId   = 'enrol-alice-a320';

  txn(db, () => {
    // Seed programme
    db.prepare(`
      INSERT INTO training_programme (
        id, tenant_id, code, title, aircraft_type, programme_type,
        regulatory_framework, authority_approval_ref,
        approval_valid_from, approval_valid_until,
        version, status, created_by, approved_by, approved_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      progId,
      'tenant-demo',
      'TR-A320-INITIAL',
      'Airbus A320 Initial Type Rating',
      'A320',
      'TYPE_RATING',
      'EASA',
      'EASA.ATO.FR.0042/TR-A320/v1',
      '2024-01-01',
      '2027-01-01',
      1,
      'APPROVED',
      'system',
      'system',
      '2024-01-15T09:00:00Z',
    );

    // Seed phases
    db.prepare(`
      INSERT INTO programme_phase (
        id, tenant_id, programme_id, sequence, code, title,
        duration_hours, minimum_sessions, delivery_mode
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(phase1Id, 'tenant-demo', progId, 1, 'CBT-GROUND', 'Phase 1 — CBT Ground School', 40.0, 10, 'CBT');

    db.prepare(`
      INSERT INTO programme_phase (
        id, tenant_id, programme_id, sequence, code, title,
        duration_hours, minimum_sessions, delivery_mode
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(phase2Id, 'tenant-demo', progId, 2, 'FBS', 'Phase 2 — Fixed Base Simulator', 12.0, 4, 'FTD');

    db.prepare(`
      INSERT INTO programme_phase (
        id, tenant_id, programme_id, sequence, code, title,
        duration_hours, minimum_sessions, delivery_mode
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(phase3Id, 'tenant-demo', progId, 3, 'FFS-D', 'Phase 3 — Full Flight Simulator Level D', 24.0, 8, 'FFS');

    // Seed modules for Phase 1
    const mod1Id = randomUUID();
    const mod2Id = randomUUID();
    db.prepare(`
      INSERT INTO programme_module (
        id, tenant_id, phase_id, sequence, code, title,
        learning_objectives, competency_unit_codes, mandatory
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      mod1Id,
      'tenant-demo',
      phase1Id,
      1,
      'CBT-SYS-01',
      'Aircraft Systems Overview',
      JSON.stringify(['Identify primary aircraft systems','Describe normal operating limits']),
      JSON.stringify(['SA','WM']),
      1,
    );

    db.prepare(`
      INSERT INTO programme_module (
        id, tenant_id, phase_id, sequence, code, title,
        learning_objectives, competency_unit_codes, mandatory
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      mod2Id,
      'tenant-demo',
      phase1Id,
      2,
      'CBT-PERF-01',
      'Performance and Limitations',
      JSON.stringify(['Calculate takeoff performance','Apply limitations in abnormal situations']),
      JSON.stringify(['FPM','FPA']),
      1,
    );

    // Seed gate criterion for Phase 1
    db.prepare(`
      INSERT INTO gate_criterion (
        id, tenant_id, phase_id, criterion_type, parameters, blocks_progression
      ) VALUES (?,?,?,?,?,?)
    `).run(
      randomUUID(),
      'tenant-demo',
      phase1Id,
      'ALL_MODULES_COMPLETE',
      JSON.stringify({}),
      1,
    );

    // Seed enrolment for pilot-alice
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO programme_enrolment (
        id, tenant_id, programme_id, pilot_id,
        enrolled_at, expected_completion_at, status
      ) VALUES (?,?,?,?,?,?,?)
    `).run(
      enrolId,
      'tenant-demo',
      progId,
      'pilot-alice',
      now,
      '2025-06-30T23:59:59Z',
      'IN_PROGRESS',
    );

    // Seed progress rows for each phase
    for (const [phaseId, status, startedAt] of [
      [phase1Id, 'COMPLETED', '2024-02-01T08:00:00Z'],
      [phase2Id, 'IN_PROGRESS', '2024-05-01T08:00:00Z'],
      [phase3Id, 'NOT_STARTED', null],
    ] as [string, string, string | null][]) {
      db.prepare(`
        INSERT INTO programme_progress (
          id, tenant_id, enrolment_id, phase_id, status, started_at
        ) VALUES (?,?,?,?,?,?)
      `).run(randomUUID(), 'tenant-demo', enrolId, phaseId, status, startedAt);
    }
  });

  console.log('[seed] training-programmes: 1 programme, 3 phases, 2 modules, 1 enrolment, 3 progress entries inserted');
}
