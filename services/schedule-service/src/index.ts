import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase, writeAudit } from './db';
import { authenticate, requireMinRole } from './middleware/auth';
import {
  CreateOperatingScheduleSchema, UpdateOperatingScheduleSchema, ActivateScheduleSchema,
  CreateBlockedPeriodSchema, UpdateBlockedPeriodSchema,
  CreateMaintenanceSchema, UpdateMaintenanceSchema, CompleteMaintenanceSchema,
  CreateOverrideSchema, CalendarQuerySchema, AvailabilityCheckSchema,
  ImportHolidaysSchema, parsePagination,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3011', 10);
export const db   = createDatabase();
export const app  = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Response helpers ─────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, status = 200, meta: object = {}): void {
  res.status(status).json({
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...meta },
    error: null,
  });
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    data:  null,
    meta:  { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

function validationFail(res: Response, err: { errors: { message: string; path: (string|number)[] }[] }): void {
  fail(res, 400, 'VALIDATION_ERROR',
    err.errors.map(e => `${e.path.join('.') || 'body'}: ${e.message}`).join('; '));
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'schedule-service' }));

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATING SCHEDULES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/operating-schedules', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const { simulatorId, status } = req.query as Record<string, string | undefined>;

  let q = 'SELECT * FROM operating_schedule WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];
  if (simulatorId) { q += ' AND simulator_id = ?'; params.push(simulatorId); }
  if (status)      { q += ' AND status = ?';       params.push(status); }
  q += ' ORDER BY effective_from DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(q).all(...params) as object[];
  const { c: total } = db.prepare(
    `SELECT COUNT(*) AS c FROM operating_schedule WHERE tenant_id = ? AND deleted_at IS NULL${simulatorId ? ' AND simulator_id = ?' : ''}${status ? ' AND status = ?' : ''}`
  ).get(...(simulatorId || status ? [tenantId, ...(simulatorId ? [simulatorId] : []), ...(status ? [status] : [])] : [tenantId])) as { c: number };

  ok(res, rows.map(parseScheduleRow), 200, { page, limit, total });
});

app.post('/api/v1/operating-schedules', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const parsed = CreateOperatingScheduleSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId, id: actorId, role } = req.user!;
  const { simulatorId, name, effectiveFrom, effectiveUntil, timeZone, dailyWindows, notes } = parsed.data;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO operating_schedule
      (id, tenant_id, simulator_id, name, effective_from, effective_until, status, time_zone, daily_windows, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, simulatorId ?? null, name, effectiveFrom, effectiveUntil ?? null,
    'DRAFT', timeZone, JSON.stringify(dailyWindows), notes ?? null, actorId);

  const row = db.prepare('SELECT * FROM operating_schedule WHERE id = ?').get(id) as object;
  writeAudit(db, tenantId, 'operating_schedule', id, 'CREATE', actorId, role, null, parsed.data);
  ok(res, parseScheduleRow(row), 201);
});

app.get('/api/v1/operating-schedules/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM operating_schedule WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, req.user!.tenantId) as object | undefined;
  if (!row) { fail(res, 404, 'NOT_FOUND', 'Operating schedule not found'); return; }
  ok(res, parseScheduleRow(row));
});

app.patch('/api/v1/operating-schedules/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM operating_schedule WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Operating schedule not found'); return; }
  if (existing.status !== 'DRAFT') { fail(res, 410, 'GONE', 'Only DRAFT schedules can be edited'); return; }

  const parsed = UpdateOperatingScheduleSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { name, effectiveUntil, dailyWindows, notes } = parsed.data;
  db.prepare(`
    UPDATE operating_schedule
    SET name = COALESCE(?, name),
        effective_until = CASE WHEN ? IS NOT NULL THEN ? ELSE effective_until END,
        daily_windows = COALESCE(?, daily_windows),
        notes = COALESCE(?, notes),
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    name ?? null,
    effectiveUntil ?? null, effectiveUntil ?? null,
    dailyWindows ? JSON.stringify(dailyWindows) : null,
    notes ?? null,
    new Date().toISOString(),
    req.params.id, tenantId,
  );

  const updated = db.prepare('SELECT * FROM operating_schedule WHERE id = ?').get(req.params.id) as object;
  writeAudit(db, tenantId, 'operating_schedule', req.params.id, 'UPDATE', actorId, role, existing, parsed.data);
  ok(res, parseScheduleRow(updated));
});

app.delete('/api/v1/operating-schedules/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM operating_schedule WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Operating schedule not found'); return; }
  if (existing.status === 'ACTIVE') { fail(res, 409, 'CONFLICT', 'Cannot delete an ACTIVE schedule. Activate a replacement first.'); return; }

  db.prepare('UPDATE operating_schedule SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), req.params.id, tenantId);
  writeAudit(db, tenantId, 'operating_schedule', req.params.id, 'DELETE', actorId, role, existing, null);
  res.status(204).end();
});

app.post('/api/v1/operating-schedules/:id/activate', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const schedule = db.prepare(
    'SELECT * FROM operating_schedule WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!schedule) { fail(res, 404, 'NOT_FOUND', 'Operating schedule not found'); return; }
  if (schedule.status === 'ACTIVE') { fail(res, 422, 'ALREADY_ACTIVE', 'Schedule is already active'); return; }

  const parsed = ActivateScheduleSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    // Supersede any currently-active schedule for same simulator
    const simId = (schedule.simulator_id ?? null) as string | null;
    db.prepare(`
      UPDATE operating_schedule
      SET status = 'SUPERSEDED', effective_until = ?, updated_at = ?
      WHERE tenant_id = ? AND simulator_id IS ? AND status = 'ACTIVE' AND id != ?
    `).run(parsed.data.effectiveFrom, now, tenantId, simId, req.params.id);

    db.prepare(`
      UPDATE operating_schedule
      SET status = 'ACTIVE', effective_from = ?, effective_until = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(parsed.data.effectiveFrom, parsed.data.effectiveUntil ?? null, now, req.params.id, tenantId);

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const updated = db.prepare('SELECT * FROM operating_schedule WHERE id = ?').get(req.params.id) as object;
  writeAudit(db, tenantId, 'operating_schedule', req.params.id, 'ACTIVATE', actorId, role, schedule, parsed.data);
  ok(res, parseScheduleRow(updated));
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKED PERIODS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/blocked-periods', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const q = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM blocked_period WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (q.simulatorId) { sql += ' AND simulator_id = ?';  params.push(q.simulatorId); }
  if (q.blockType)   { sql += ' AND block_type = ?';    params.push(q.blockType); }
  if (q.from)        { sql += ' AND end_at >= ?';       params.push(q.from); }
  if (q.until)       { sql += ' AND start_at <= ?';     params.push(q.until); }
  if (!q.includeExpired || q.includeExpired === 'false') {
    sql += ' AND end_at >= ?'; params.push(new Date().toISOString());
  }
  sql += ' ORDER BY start_at ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as object[];
  ok(res, rows.map(parseBlockRow), 200, { page, limit });
});

app.post('/api/v1/blocked-periods', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const parsed = CreateBlockedPeriodSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId, id: actorId, role } = req.user!;
  const { simulatorId, blockType, title, description, startAt, endAt, isPublic, recurrenceRule, affectsSlots } = parsed.data;

  // Overlap check for same simulator/facility maintenance windows
  if (blockType === 'MAINTENANCE' || blockType === 'AUTHORITY_INSPECTION') {
    const conflict = db.prepare(`
      SELECT id FROM blocked_period
      WHERE tenant_id = ? AND deleted_at IS NULL
      AND (simulator_id = ? OR (simulator_id IS NULL AND ? IS NULL))
      AND block_type IN ('MAINTENANCE','AUTHORITY_INSPECTION')
      AND start_at < ? AND end_at > ?
    `).get(tenantId, simulatorId ?? null, simulatorId ?? null, endAt, startAt);
    if (conflict) {
      fail(res, 422, 'SCHEDULE_CONFLICT', 'A maintenance or inspection window already exists in this period');
      return;
    }
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO blocked_period
      (id, tenant_id, simulator_id, block_type, title, description, start_at, end_at,
       is_public, recurrence_rule, affects_slots, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, simulatorId ?? null, blockType, title,
    description ?? null, startAt, endAt, isPublic ? 1 : 0,
    recurrenceRule ?? null, affectsSlots ? 1 : 0, actorId);

  // R-3: propagate to slots — mark overlapping slots unavailable in booking-service
  // (In dev: we log it; in prod an EventBridge event triggers the booking-service worker)
  if (affectsSlots) {
    console.log(`[schedule-service] BlockedPeriod ${id} created — slots should be propagated via EventBridge`);
  }

  const row = db.prepare('SELECT * FROM blocked_period WHERE id = ?').get(id) as object;
  writeAudit(db, tenantId, 'blocked_period', id, 'CREATE', actorId, role, null, parsed.data);
  ok(res, parseBlockRow(row), 201);
});

app.get('/api/v1/blocked-periods/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM blocked_period WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, req.user!.tenantId) as object | undefined;
  if (!row) { fail(res, 404, 'NOT_FOUND', 'Blocked period not found'); return; }
  ok(res, parseBlockRow(row));
});

app.patch('/api/v1/blocked-periods/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM blocked_period WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Blocked period not found'); return; }

  // Past blocks: only endAt and description can change (R-5)
  const isPast = new Date(existing.start_at as string) < new Date();
  const parsed = UpdateBlockedPeriodSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  if (isPast && (parsed.data.title !== undefined || parsed.data.isPublic !== undefined)) {
    fail(res, 410, 'GONE', 'A started block can only have endAt or description updated');
    return;
  }

  const { title, description, endAt, isPublic } = parsed.data;
  db.prepare(`
    UPDATE blocked_period
    SET title = COALESCE(?, title), description = COALESCE(?, description),
        end_at = COALESCE(?, end_at), is_public = COALESCE(?, is_public), updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(title ?? null, description ?? null, endAt ?? null, isPublic != null ? (isPublic ? 1 : 0) : null,
    new Date().toISOString(), req.params.id, tenantId);

  const updated = db.prepare('SELECT * FROM blocked_period WHERE id = ?').get(req.params.id) as object;
  writeAudit(db, tenantId, 'blocked_period', req.params.id, 'UPDATE', actorId, role, existing, parsed.data);
  ok(res, parseBlockRow(updated));
});

app.delete('/api/v1/blocked-periods/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM blocked_period WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Blocked period not found'); return; }

  const started = new Date(existing.start_at as string) <= new Date();
  if (started && !['GLOBAL_ADMIN', 'COUNTRY_ADMIN'].includes(req.user!.role)) {
    fail(res, 410, 'GONE', 'A block that has already started requires COUNTRY_ADMIN or GLOBAL_ADMIN to remove');
    return;
  }

  db.prepare('UPDATE blocked_period SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), req.params.id, tenantId);
  writeAudit(db, tenantId, 'blocked_period', req.params.id, 'DELETE', actorId, role, existing, null);

  console.log(`[schedule-service] BlockedPeriod ${req.params.id} deleted — slots should be restored via EventBridge`);
  res.status(204).end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAINTENANCE RECORDS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/maintenance', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const q = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM maintenance_record WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];
  if (q.simulatorId) { sql += ' AND simulator_id = ?'; params.push(q.simulatorId); }
  if (q.status)      { sql += ' AND status = ?';       params.push(q.status); }
  if (q.from)        { sql += ' AND planned_end_at >= ?';  params.push(q.from); }
  if (q.until)       { sql += ' AND planned_start_at <= ?'; params.push(q.until); }
  sql += ' ORDER BY planned_start_at ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as object[];
  ok(res, rows.map(parseMaintenanceRow), 200, { page, limit });
});

app.post('/api/v1/maintenance', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const parsed = CreateMaintenanceSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId, id: actorId, role } = req.user!;
  const {
    simulatorId, maintenanceType, title, description,
    plannedStartAt, plannedEndAt, technicianName, authorityReferenceNumber,
    partialOperationAllowed, qualificationLevelDuring, autoCreateBlockedPeriod,
  } = parsed.data;

  // Overlap check: no two maintenance windows for same simulator at the same time
  const conflict = db.prepare(`
    SELECT id FROM maintenance_record
    WHERE tenant_id = ? AND simulator_id = ? AND deleted_at IS NULL
    AND status IN ('PLANNED','IN_PROGRESS')
    AND planned_start_at < ? AND planned_end_at > ?
  `).get(tenantId, simulatorId, plannedEndAt, plannedStartAt);
  if (conflict) {
    fail(res, 422, 'SCHEDULE_CONFLICT', 'A maintenance window already exists for this simulator in this period');
    return;
  }

  const id = randomUUID();
  let blockedPeriodId: string | null = null;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (autoCreateBlockedPeriod) {
      blockedPeriodId = randomUUID();
      db.prepare(`
        INSERT INTO blocked_period
          (id, tenant_id, simulator_id, block_type, title, start_at, end_at, is_public, affects_slots, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(blockedPeriodId, tenantId, simulatorId, 'MAINTENANCE',
        `Maintenance: ${title}`, plannedStartAt, plannedEndAt, 0, 1, actorId);
    }

    db.prepare(`
      INSERT INTO maintenance_record
        (id, tenant_id, simulator_id, blocked_period_id, maintenance_type, title, description,
         planned_start_at, planned_end_at, technician_name, authority_reference_number,
         partial_operation_allowed, qualification_level_during, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, tenantId, simulatorId, blockedPeriodId, maintenanceType, title,
      description ?? null, plannedStartAt, plannedEndAt, technicianName ?? null,
      authorityReferenceNumber ?? null, partialOperationAllowed ? 1 : 0,
      qualificationLevelDuring ?? null, actorId);

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const row = db.prepare('SELECT * FROM maintenance_record WHERE id = ?').get(id) as object;
  writeAudit(db, tenantId, 'maintenance_record', id, 'CREATE', actorId, role, null, parsed.data);
  ok(res, parseMaintenanceRow(row), 201);
});

app.get('/api/v1/maintenance/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM maintenance_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, req.user!.tenantId) as object | undefined;
  if (!row) { fail(res, 404, 'NOT_FOUND', 'Maintenance record not found'); return; }
  ok(res, parseMaintenanceRow(row));
});

app.patch('/api/v1/maintenance/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM maintenance_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Maintenance record not found'); return; }

  const parsed = UpdateMaintenanceSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const now = new Date().toISOString();
  const { plannedEndAt, status, technicianName, authorityReferenceNumber,
          partialOperationAllowed, qualificationLevelDuring, completionNotes } = parsed.data;

  db.prepare(`
    UPDATE maintenance_record
    SET planned_end_at = COALESCE(?, planned_end_at),
        status = COALESCE(?, status),
        technician_name = COALESCE(?, technician_name),
        authority_reference_number = COALESCE(?, authority_reference_number),
        partial_operation_allowed = COALESCE(?, partial_operation_allowed),
        qualification_level_during = COALESCE(?, qualification_level_during),
        completion_notes = COALESCE(?, completion_notes),
        actual_start_at = CASE WHEN ? = 'IN_PROGRESS' AND actual_start_at IS NULL THEN ? ELSE actual_start_at END,
        updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    plannedEndAt ?? null, status ?? null, technicianName ?? null,
    authorityReferenceNumber ?? null,
    partialOperationAllowed != null ? (partialOperationAllowed ? 1 : 0) : null,
    qualificationLevelDuring ?? null, completionNotes ?? null,
    status ?? null, now,
    now, req.params.id, tenantId,
  );

  const updated = db.prepare('SELECT * FROM maintenance_record WHERE id = ?').get(req.params.id) as object;
  writeAudit(db, tenantId, 'maintenance_record', req.params.id, 'UPDATE', actorId, role, existing, parsed.data);
  ok(res, parseMaintenanceRow(updated));
});

app.post('/api/v1/maintenance/:id/complete', authenticate, requireMinRole('COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: actorId, role } = req.user!;
  const existing = db.prepare(
    'SELECT * FROM maintenance_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Maintenance record not found'); return; }
  if (existing.status === 'COMPLETED') { fail(res, 422, 'ALREADY_COMPLETE', 'Maintenance already marked complete'); return; }
  if (existing.status === 'CANCELLED') { fail(res, 422, 'CANCELLED', 'Cannot complete a cancelled maintenance record'); return; }

  const parsed = CompleteMaintenanceSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const now = new Date().toISOString();
  const actualEndAt = parsed.data.actualEndAt ?? now;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE maintenance_record
      SET status = 'COMPLETED', actual_end_at = ?, completion_notes = ?,
          authority_reference_number = COALESCE(?, authority_reference_number),
          actual_start_at = COALESCE(actual_start_at, ?), updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(actualEndAt, parsed.data.completionNotes,
      parsed.data.authorityReferenceNumber ?? null, now, now, req.params.id, tenantId);

    // Shorten the linked BlockedPeriod to the actual end time
    if (existing.blocked_period_id) {
      db.prepare(`
        UPDATE blocked_period SET end_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND end_at > ?
      `).run(actualEndAt, now, existing.blocked_period_id as string, tenantId, actualEndAt);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const updated = db.prepare('SELECT * FROM maintenance_record WHERE id = ?').get(req.params.id) as object;
  writeAudit(db, tenantId, 'maintenance_record', req.params.id, 'COMPLETE', actorId, role, existing, parsed.data);
  console.log(`[schedule-service] Maintenance ${req.params.id} complete — slots from ${actualEndAt} should be restored`);
  ok(res, parseMaintenanceRow(updated));
});

// ═══════════════════════════════════════════════════════════════════════════════
// AVAILABILITY OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/availability-overrides', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>);
  const q = req.query as Record<string, string | undefined>;

  let sql = 'SELECT * FROM availability_override WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];
  if (q.simulatorId) { sql += ' AND simulator_id = ?'; params.push(q.simulatorId); }
  if (q.from)        { sql += ' AND end_at >= ?';  params.push(q.from); }
  if (q.until)       { sql += ' AND start_at <= ?'; params.push(q.until); }
  sql += ' ORDER BY start_at ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  ok(res, (db.prepare(sql).all(...params) as object[]).map(parseOverrideRow), 200, { page, limit });
});

app.post('/api/v1/availability-overrides', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const parsed = CreateOverrideSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId, id: actorId } = req.user!;
  const id = randomUUID();
  const { simulatorId, title, startAt, endAt, reason, isPublic } = parsed.data;
  db.prepare(`
    INSERT INTO availability_override (id, tenant_id, simulator_id, title, start_at, end_at, reason, is_public, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, simulatorId ?? null, title, startAt, endAt, reason ?? null, isPublic ? 1 : 0, actorId);

  const row = db.prepare('SELECT * FROM availability_override WHERE id = ?').get(id) as object;
  ok(res, parseOverrideRow(row), 201);
});

app.patch('/api/v1/availability-overrides/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const existing = db.prepare(
    'SELECT id FROM availability_override WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId);
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Override not found'); return; }

  const parsed = CreateOverrideSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { title, startAt, endAt, reason, isPublic } = parsed.data;
  db.prepare(`
    UPDATE availability_override SET title = ?, start_at = ?, end_at = ?, reason = ?, is_public = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(title, startAt, endAt, reason ?? null, isPublic ? 1 : 0, new Date().toISOString(), req.params.id, tenantId);

  const updated = db.prepare('SELECT * FROM availability_override WHERE id = ?').get(req.params.id) as object;
  ok(res, parseOverrideRow(updated));
});

app.delete('/api/v1/availability-overrides/:id', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const existing = db.prepare(
    'SELECT id FROM availability_override WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId);
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Override not found'); return; }
  db.prepare('UPDATE availability_override SET deleted_at = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), req.params.id, tenantId);
  res.status(204).end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// NATIONAL HOLIDAYS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/holidays', authenticate, (req: Request, res: Response) => {
  const parsed = ImportHolidaysSchema.safeParse(req.query);
  if (!parsed.success) { validationFail(res, parsed.error); return; }
  const { year, region } = parsed.data;
  const tenantRegion = region ?? tenantToRegion(req.user!.tenantId);

  const rows = db.prepare(
    'SELECT * FROM national_holiday_calendar WHERE region = ? AND year = ? ORDER BY holiday_date'
  ).all(tenantRegion, year) as object[];
  ok(res, rows);
});

app.post('/api/v1/holidays/import', authenticate, requireMinRole('MANAGER'), (req: Request, res: Response) => {
  const parsed = ImportHolidaysSchema.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { year, region, dryRun } = parsed.data;
  const { tenantId, id: actorId } = req.user!;
  const targetRegion = region ?? tenantToRegion(tenantId);

  const holidays = db.prepare(
    'SELECT * FROM national_holiday_calendar WHERE region = ? AND year = ? AND auto_create_block = 1'
  ).all(targetRegion, year) as Array<Record<string, unknown>>;

  let imported = 0, skipped = 0, blockedPeriodsCreated = 0;

  if (!dryRun) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const h of holidays) {
        const date = h.holiday_date as string;
        const startAt = `${date}T00:00:00.000Z`;
        const endAt   = `${date}T23:59:59.000Z`;

        // Idempotent: skip if block already exists for this date+title
        const existing = db.prepare(
          "SELECT id FROM blocked_period WHERE tenant_id = ? AND block_type = 'HOLIDAY' AND start_at = ? AND deleted_at IS NULL"
        ).get(tenantId, startAt);

        if (existing) { skipped++; continue; }

        db.prepare(`
          INSERT INTO blocked_period (id, tenant_id, block_type, title, start_at, end_at, is_public, affects_slots, created_by)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(randomUUID(), tenantId, 'HOLIDAY', h.name as string, startAt, endAt, 1, 1, actorId);
        blockedPeriodsCreated++;
        imported++;
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  ok(res, { imported: dryRun ? holidays.length : imported, skipped, blockedPeriodsCreated, holidays });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR (unified view) + AVAILABILITY CHECK
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/v1/calendar', authenticate, (req: Request, res: Response) => {
  const parsed = CalendarQuerySchema.safeParse(req.query);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId, role } = req.user!;
  const isAdmin = ['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','INSTRUCTOR'].includes(role);
  const { from, until, simulatorId } = parsed.data;

  // Fetch active blocked periods in range (facility-wide + simulator-specific)
  const blocks = db.prepare(`
    SELECT * FROM blocked_period
    WHERE tenant_id = ? AND deleted_at IS NULL
    AND (simulator_id = ? OR simulator_id IS NULL)
    AND start_at <= ? AND end_at >= ?
  `).all(tenantId, simulatorId ?? null, `${until}T23:59:59Z`, `${from}T00:00:00Z`) as Array<Record<string, unknown>>;

  // Build day-by-day calendar
  const days: object[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end    = new Date(`${until}T23:59:59Z`);

  while (cursor <= end) {
    const dateStr  = cursor.toISOString().slice(0, 10);
    const dayStart = `${dateStr}T00:00:00Z`;
    const dayEnd   = `${dateStr}T23:59:59Z`;

    const dayBlocks = blocks.filter(b =>
      (b.start_at as string) <= dayEnd && (b.end_at as string) >= dayStart
    );

    let status: string = 'AVAILABLE';
    let title: string | null = null;
    const blocksSummary: object[] = [];

    for (const b of dayBlocks) {
      const bType = b.block_type as string;
      const isPublic = (b.is_public as number) === 1;

      if (bType === 'HOLIDAY')              status = 'HOLIDAY';
      else if (bType === 'MAINTENANCE' || bType === 'AUTHORITY_INSPECTION') {
        if (status !== 'HOLIDAY') status = 'MAINTENANCE';
      } else {
        if (status === 'AVAILABLE')         status = 'BLOCKED';
      }

      blocksSummary.push({
        startAt:   b.start_at,
        endAt:     b.end_at,
        blockType: bType,
        title:     isAdmin ? (b.title as string) : (isPublic ? (b.title as string) : null),
      });

      if (isPublic || isAdmin) title = b.title as string;
    }

    // Check for availability overrides on blocked days
    const override = db.prepare(`
      SELECT id FROM availability_override
      WHERE tenant_id = ? AND deleted_at IS NULL
      AND (simulator_id = ? OR simulator_id IS NULL)
      AND start_at <= ? AND end_at >= ?
    `).get(tenantId, simulatorId ?? null, dayEnd, dayStart);

    if (override && status !== 'AVAILABLE') status = 'OVERRIDE_OPEN';

    days.push({ date: dateStr, simulatorId: simulatorId ?? null, status, title, blocks: blocksSummary });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  ok(res, days);
});

app.get('/api/v1/availability', authenticate, (req: Request, res: Response) => {
  const parsed = AvailabilityCheckSchema.safeParse(req.query);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId } = req.user!;
  const { simulatorId, startAt, endAt } = parsed.data;

  // Check for active operating schedule — is the window within open hours?
  const schedule = db.prepare(`
    SELECT * FROM operating_schedule
    WHERE tenant_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL
    AND (simulator_id = ? OR simulator_id IS NULL)
    ORDER BY simulator_id DESC LIMIT 1
  `).get(tenantId, simulatorId) as Record<string, unknown> | undefined;

  const dateStr   = new Date(startAt).toISOString().slice(0, 10);
  const dayOfWeek = new Date(startAt).getUTCDay(); // 0=Sun
  let withinSchedule = false;

  if (schedule) {
    const windows = JSON.parse(schedule.daily_windows as string) as Array<{ dayOfWeek: number; isOpen: boolean; openTime: string; closeTime: string }>;
    const win = windows.find(w => w.dayOfWeek === dayOfWeek);
    if (win?.isOpen) {
      const slotHHMM = new Date(startAt).toISOString().slice(11, 16);
      withinSchedule = slotHHMM >= win.openTime && slotHHMM < win.closeTime;
    }
  } else {
    withinSchedule = true; // No schedule defined — assume open
  }

  // Check override first
  const override = db.prepare(`
    SELECT id FROM availability_override
    WHERE tenant_id = ? AND deleted_at IS NULL
    AND (simulator_id = ? OR simulator_id IS NULL)
    AND start_at <= ? AND end_at >= ?
  `).get(tenantId, simulatorId, endAt, startAt);
  if (override) withinSchedule = true;

  if (!withinSchedule) {
    ok(res, { available: false, reason: 'Outside operating hours', blockType: null, blockedPeriodId: null });
    return;
  }

  // Check for blocking periods
  const block = db.prepare(`
    SELECT * FROM blocked_period
    WHERE tenant_id = ? AND deleted_at IS NULL
    AND (simulator_id = ? OR simulator_id IS NULL)
    AND start_at < ? AND end_at > ?
    ORDER BY start_at ASC LIMIT 1
  `).get(tenantId, simulatorId, endAt, startAt) as Record<string, unknown> | undefined;

  if (block) {
    ok(res, {
      available:       false,
      reason:          (block.is_public as number) === 1 ? (block.title as string) : 'Simulator unavailable',
      blockType:       block.block_type,
      blockedPeriodId: block.id,
    });
    return;
  }

  // Fetch maintenance record to surface qualificationLevelDuring
  const maintenance = db.prepare(`
    SELECT qualification_level_during FROM maintenance_record
    WHERE tenant_id = ? AND simulator_id = ? AND deleted_at IS NULL
    AND status IN ('PLANNED','IN_PROGRESS')
    AND planned_start_at < ? AND planned_end_at > ?
    AND partial_operation_allowed = 1
    LIMIT 1
  `).get(tenantId, simulatorId, endAt, startAt) as Record<string, unknown> | undefined;

  ok(res, {
    available:                      true,
    reason:                         null,
    blockType:                      null,
    blockedPeriodId:                null,
    qualificationLevelDuring:       maintenance?.qualification_level_during ?? null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseScheduleRow(row: object): object {
  const r = row as Record<string, unknown>;
  return {
    ...r,
    dailyWindows: typeof r.daily_windows === 'string' ? JSON.parse(r.daily_windows) : r.daily_windows,
  };
}

function parseBlockRow(row: object): object {
  const r = row as Record<string, unknown>;
  return { ...r, isPublic: (r.is_public as number) === 1, affectsSlots: (r.affects_slots as number) === 1 };
}

function parseMaintenanceRow(row: object): object {
  const r = row as Record<string, unknown>;
  return { ...r, partialOperationAllowed: (r.partial_operation_allowed as number) === 1 };
}

function parseOverrideRow(row: object): object {
  const r = row as Record<string, unknown>;
  return { ...r, isPublic: (r.is_public as number) === 1 };
}

function tenantToRegion(tenantId: string): string {
  const map: Record<string, string> = {
    'tenant-demo': 'FR', 'tenant-za': 'ZA', 'tenant-cn': 'CN', 'tenant-in': 'IN',
  };
  return map[tenantId] ?? 'FR';
}

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[schedule-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[schedule-service] ✓  http://localhost:${PORT}`));
}
