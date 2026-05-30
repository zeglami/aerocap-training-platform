import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'aerocap-scenarios.db');

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

  const row = db.prepare('SELECT COUNT(*) AS count FROM scenario').get() as { count: number };
  if (row.count === 0) seedDatabase(db);

  return db;
}

function seedDatabase(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const tenantId = 'tenant-demo';

  // ── Scenario 1: A320 Engine Failure ────────────────────────────────────────
  const sc1Id = randomUUID();

  db.prepare(`
    INSERT INTO scenario (id, tenant_id, code, title, aircraft_type, scenario_category,
      phase_of_flight, minimum_fstd_level, approval_status, version, duration_minutes,
      created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    sc1Id, tenantId,
    'SC-A320-ENGINE-FAIL-01',
    'A320 Engine Failure After Takeoff',
    'A320', 'EMERGENCY', 'TAKEOFF', 'FFS_D', 'APPROVED',
    1, 90, 'instructor-jean', now, now,
  );

  // Competency mappings for SC1
  const sc1Mappings = [
    { code: 'FPM', weight: 5 },
    { code: 'AP',  weight: 4 },
    { code: 'WM',  weight: 3 },
  ];
  for (const m of sc1Mappings) {
    db.prepare(`
      INSERT INTO scenario_competency_mapping (id, tenant_id, scenario_id, competency_unit_code, weight, observable_behaviours, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(randomUUID(), tenantId, sc1Id, m.code, m.weight, '[]', now, now);
  }

  // Injection for SC1
  db.prepare(`
    INSERT INTO scenario_injection (id, tenant_id, scenario_id, sequence, trigger_type,
      trigger_spec, malfunction_code, description, expected_crew_response, severity,
      created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(), tenantId, sc1Id,
    1, 'TIME',
    JSON.stringify({ offsetSeconds: 0, triggerCondition: 'V1_reached' }),
    'ATA-71-ENG1-FAIL',
    'Engine 1 failure at V1',
    'Apply Engine Failure After Takeoff memory items: maintain directional control, rotate normally, climb on one engine, initiate ECAM actions at safe altitude',
    'EMERGENCY',
    now, now,
  );

  // Approval record for SC1
  db.prepare(`
    INSERT INTO scenario_approval (id, tenant_id, scenario_id, approved_by, approved_at,
      authority_reference, valid_from, valid_until, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(), tenantId, sc1Id,
    'instructor-jean', now,
    'EASA-OPS-A320-2024-001',
    '2024-01-01', '2025-12-31',
    now, now,
  );

  // ── Scenario 2: B737 Rapid Depressurisation ─────────────────────────────────
  const sc2Id = randomUUID();

  db.prepare(`
    INSERT INTO scenario (id, tenant_id, code, title, aircraft_type, scenario_category,
      phase_of_flight, minimum_fstd_level, approval_status, version, duration_minutes,
      created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    sc2Id, tenantId,
    'SC-B737-OPC-DEPRESS-01',
    'B737 Rapid Depressurisation at FL350',
    'B737', 'EMERGENCY', 'CRUISE', 'FFS_D', 'APPROVED',
    1, 60, 'instructor-marie', now, now,
  );

  // Approval record for SC2
  db.prepare(`
    INSERT INTO scenario_approval (id, tenant_id, scenario_id, approved_by, approved_at,
      authority_reference, valid_from, valid_until, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(), tenantId, sc2Id,
    'instructor-marie', now,
    'EASA-OPS-B737-2024-002',
    '2024-01-01', '2025-12-31',
    now, now,
  );

  console.log('[seed] 2 demo scenarios inserted for tenant-demo');
}
