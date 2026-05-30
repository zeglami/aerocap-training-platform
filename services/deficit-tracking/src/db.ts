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

/** Returns an ISO-8601 UTC timestamp N days offset from now. */
function isoOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  const row = db.prepare('SELECT COUNT(*) AS count FROM deficit').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  return db;
}

function seedDatabase(db: DatabaseSync): void {
  const insDef = db.prepare(`
    INSERT INTO deficit (
      id, tenant_id, pilot_id,
      originating_assessment_id, competency_unit_code, originating_score,
      originating_session_id, opened_at, severity, status,
      due_at, escalated_at,
      instructor_id, simulator_id, simulator_qualification_level,
      instructor_qualification, session_type, assessed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insEsc = db.prepare(`
    INSERT INTO deficit_escalation (
      id, tenant_id, deficit_id, escalation_level,
      triggered_at, triggered_by, notes
    ) VALUES (?,?,?,?,?,?,?)
  `);

  txn(db, () => {
    // ── Deficit 1 ─────────────────────────────────────────────────────────────
    // pilot-bob, FPM, score=2 → REMEDIAL, OPEN
    // assessed 7 days ago, opened 7 days ago, due 23 days from now (30d window)
    const def1Id    = randomUUID();
    const def1Assessed = isoOffset(-7);
    const def1Due      = isoOffset(23);

    insDef.run(
      def1Id,
      'tenant-demo',
      'pilot-bob',
      randomUUID(),           // originating_assessment_id
      'FPM',
      2,
      randomUUID(),           // originating_session_id
      def1Assessed,           // opened_at
      'REMEDIAL',
      'OPEN',
      def1Due,                // due_at
      null,                   // escalated_at
      'instructor-jean',
      'sim-737',
      'FFS_D',
      'TRI',
      'RECURRENT',
      def1Assessed,           // assessed_at
    );

    // ── Deficit 2 ─────────────────────────────────────────────────────────────
    // pilot-alice, SA, score=1 → TRAINING_REQUIRED, ESCALATED
    // assessed 25 days ago, opened 25 days ago, due 5 days from now, escalated 4 days ago
    const def2Id       = randomUUID();
    const def2Assessed = isoOffset(-25);
    const def2Due      = isoOffset(5);
    const def2Escalated = isoOffset(-4);

    insDef.run(
      def2Id,
      'tenant-demo',
      'pilot-alice',
      randomUUID(),           // originating_assessment_id
      'SA',
      1,
      randomUUID(),           // originating_session_id
      def2Assessed,           // opened_at
      'TRAINING_REQUIRED',
      'ESCALATED',
      def2Due,                // due_at
      def2Escalated,          // escalated_at
      'instructor-jean',
      'sim-a320',
      'FFS_D',
      'TRI',
      'OPC',
      def2Assessed,           // assessed_at
    );

    // Escalation entry for deficit 2
    insEsc.run(
      randomUUID(),
      'tenant-demo',
      def2Id,
      'LEVEL_1_CFI',
      def2Escalated,
      'SYSTEM',
      'Deficit approaching due date without remedial action scheduled.',
    );
  });

  console.log('[seed] 2 deficits + 1 escalation entry inserted for tenant-demo');
}
