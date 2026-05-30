import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const DB_DIR  = join(__dirname, '..', 'db');
const DB_PATH = process.env.DB_PATH ?? join(DB_DIR, 'schedule.db');

export function createDatabase(): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const sql = readFileSync(join(__dirname, '..', 'migrations', '001_init.sql'), 'utf-8');
  db.exec(sql);

  seedHolidays(db);
  return db;
}

// Pre-load French public holidays for 2026 for the demo tenant
function seedHolidays(db: DatabaseSync): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM national_holiday_calendar WHERE region = ? AND year = ?').get('FR', 2026) as { c: number }).c;
  if (count > 0) return;

  const ins = db.prepare(
    'INSERT OR IGNORE INTO national_holiday_calendar (id, region, year, holiday_date, name) VALUES (?,?,?,?,?)'
  );

  const FR_2026 = [
    ['2026-01-01', "New Year's Day"],
    ['2026-04-06', 'Easter Monday'],
    ['2026-05-01', 'Fête du Travail'],
    ['2026-05-08', 'Victoire 1945'],
    ['2026-05-14', 'Ascension'],
    ['2026-05-25', 'Lundi de Pentecôte'],
    ['2026-07-14', 'Bastille Day'],
    ['2026-08-15', "Assomption de Marie"],
    ['2026-11-01', 'Toussaint'],
    ['2026-11-11', 'Armistice'],
    ['2026-12-25', 'Christmas Day'],
  ];

  db.exec('BEGIN');
  for (const [date, name] of FR_2026) {
    ins.run(randomUUID(), 'FR', 2026, date, name);
  }
  db.exec('COMMIT');
}

export function writeAudit(
  db: DatabaseSync,
  tenantId: string,
  entityType: string,
  entityId: string,
  action: string,
  actorId: string,
  actorRole: string,
  oldValue: unknown,
  newValue: unknown,
  reason?: string,
): void {
  db.prepare(`
    INSERT INTO simulator_schedule_audit_log
      (id, tenant_id, entity_type, entity_id, action, actor_id, actor_role, old_value, new_value, reason)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    randomUUID(), tenantId, entityType, entityId, action, actorId, actorRole,
    oldValue != null ? JSON.stringify(oldValue) : null,
    newValue != null ? JSON.stringify(newValue) : null,
    reason ?? null,
  );
}
