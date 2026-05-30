import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase, txn } from './db';
import { authenticate, isInstructorOrAbove, isCfiOrAbove } from './middleware/auth';
import {
  deficitCreateZ,
  deficitPatchZ,
  remedialActionCreateZ,
  remedialActionCompleteZ,
  reassessmentScheduleZ,
  reassessmentOutcomeZ,
  deficitWaiveZ,
  escalateZ,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3007', 10);

const db  = createDatabase();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, status = 200, meta: object = {}): void {
  res.status(status).json({
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...meta },
    error: null,
  });
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    data: null,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

/** Add 30 calendar days to an ISO timestamp and return an ISO string. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** CLOSED statuses — no mutations allowed on the deficit itself. */
const CLOSED_STATUSES = new Set(['RESOLVED', 'WAIVED']);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'deficit-tracking' }));

// ─── Deficits ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/deficits
 * Filters: ?pilotId, ?status, ?competencyUnitCode, ?page, ?pageSize
 * PILOTs always see only their own deficits.
 */
app.get('/api/v1/deficits', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const page     = Math.max(1, parseInt(req.query.page     as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;

  const conditions: string[]              = ['d.tenant_id = ?', 'd.deleted_at IS NULL'];
  const params: (string | number | null)[] = [tenantId];

  // Pilots see only their own deficits regardless of query params
  if (role === 'PILOT') {
    conditions.push('d.pilot_id = ?');
    params.push(userId);
  } else if (req.query.pilotId) {
    conditions.push('d.pilot_id = ?');
    params.push(req.query.pilotId as string);
  }

  if (req.query.status) {
    conditions.push('d.status = ?');
    params.push(req.query.status as string);
  }
  if (req.query.competencyUnitCode) {
    conditions.push('d.competency_unit_code = ?');
    params.push(req.query.competencyUnitCode as string);
  }

  const where = conditions.join(' AND ');

  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM deficit d WHERE ${where}`)
    .get(...params) as { count: number };
  const total = countRow.count;

  const rows = db.prepare(
    `SELECT * FROM deficit d WHERE ${where} ORDER BY d.due_at ASC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as object[];

  ok(res, rows, 200, { page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

/**
 * POST /api/v1/deficits
 * R-C-1: severity is derived from score (score=1 → TRAINING_REQUIRED, score=2 → REMEDIAL),
 * but we also accept an explicit severity from the caller for override scenarios.
 * due_at = opened_at + 30 days.
 */
app.post('/api/v1/deficits', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may open deficits');
    return;
  }

  const parsed = deficitCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const {
    pilotId, originatingAssessmentId, competencyUnitCode, originatingScore,
    originatingSessionId, instructorId, simulatorId,
    simulatorQualificationLevel, instructorQualification, sessionType, assessedAt,
  } = parsed.data;

  // R-C-1: severity derived from score
  const severity: 'TRAINING_REQUIRED' | 'REMEDIAL' =
    originatingScore === 1 ? 'TRAINING_REQUIRED' : 'REMEDIAL';

  const id       = randomUUID();
  const openedAt = now();
  const dueAt    = addDays(openedAt, 30);

  db.prepare(`
    INSERT INTO deficit (
      id, tenant_id, pilot_id,
      originating_assessment_id, competency_unit_code, originating_score,
      originating_session_id, opened_at, severity, status,
      due_at, instructor_id, simulator_id,
      simulator_qualification_level, instructor_qualification,
      session_type, assessed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, pilotId,
    originatingAssessmentId, competencyUnitCode, originatingScore,
    originatingSessionId, openedAt, severity, 'OPEN',
    dueAt, instructorId, simulatorId,
    simulatorQualificationLevel, instructorQualification,
    sessionType, assessedAt,
  );

  const deficit = db.prepare('SELECT * FROM deficit WHERE id = ?').get(id) as object;
  ok(res, deficit, 201);
});

/**
 * GET /api/v1/deficits/:id
 * PILOTs may only read their own deficit (403 otherwise).
 */
app.get('/api/v1/deficits/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (role === 'PILOT' && deficit.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You may only view your own deficits');
    return;
  }

  ok(res, deficit);
});

/**
 * PATCH /api/v1/deficits/:id
 * Instructors/CFIs only. Closed deficits return 410.
 */
app.patch('/api/v1/deficits/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may update deficits');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (CLOSED_STATUSES.has(deficit.status as string)) {
    fail(res, 410, 'DEFICIT_CLOSED', 'This deficit is closed and cannot be modified');
    return;
  }

  const parsed = deficitPatchZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const fields = parsed.data;
  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now()];

  if (fields.cfiId    !== undefined) { setClauses.push('cfi_id = ?');       values.push(fields.cfiId); }
  if (fields.instructorId !== undefined) { setClauses.push('instructor_id = ?'); values.push(fields.instructorId); }
  if (fields.dueAt    !== undefined) { setClauses.push('due_at = ?');        values.push(fields.dueAt); }
  if (fields.status   !== undefined) { setClauses.push('status = ?');        values.push(fields.status); }

  if (setClauses.length === 1) {
    // Only updated_at — nothing meaningful to patch
    ok(res, db.prepare('SELECT * FROM deficit WHERE id = ?').get(req.params.id) as object);
    return;
  }

  db.prepare(
    `UPDATE deficit SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).run(...values, req.params.id, tenantId);

  const updated = db.prepare('SELECT * FROM deficit WHERE id = ?').get(req.params.id) as object;
  ok(res, updated);
});

// ─── Remedial Actions ─────────────────────────────────────────────────────────

/**
 * GET /api/v1/deficits/:id/remedial-actions
 */
app.get('/api/v1/deficits/:id/remedial-actions', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  // Pilots may only see remedial actions on their own deficit
  if (role === 'PILOT' && deficit.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You may only view remedial actions for your own deficits');
    return;
  }

  const actions = db.prepare(
    'SELECT * FROM remedial_action WHERE deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY planned_date ASC'
  ).all(req.params.id, tenantId) as object[];

  ok(res, actions);
});

/**
 * POST /api/v1/deficits/:id/remedial-actions
 * Instructor/CFI only.
 */
app.post('/api/v1/deficits/:id/remedial-actions', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may add remedial actions');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (CLOSED_STATUSES.has(deficit.status as string)) {
    fail(res, 410, 'DEFICIT_CLOSED', 'Cannot add remedial actions to a closed deficit');
    return;
  }

  const parsed = remedialActionCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const { actionType, description, plannedDate, instructorId } = parsed.data;
  const id = randomUUID();

  txn(db, () => {
    db.prepare(`
      INSERT INTO remedial_action (id, tenant_id, deficit_id, action_type, description, planned_date, instructor_id)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, tenantId, req.params.id, actionType, description, plannedDate, instructorId);

    // Transition deficit to UNDER_REMEDIATION if it is OPEN
    if (deficit.status === 'OPEN') {
      db.prepare(`UPDATE deficit SET status = 'UNDER_REMEDIATION', updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .run(now(), req.params.id, tenantId);
    }
  });

  const action = db.prepare('SELECT * FROM remedial_action WHERE id = ?').get(id) as object;
  ok(res, action, 201);
});

/**
 * POST /api/v1/deficits/:id/remedial-actions/:aid/complete
 */
app.post('/api/v1/deficits/:id/remedial-actions/:aid/complete', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may complete remedial actions');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  const action = db.prepare(
    'SELECT * FROM remedial_action WHERE id = ? AND deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.aid, req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!action) { fail(res, 404, 'NOT_FOUND', 'Remedial action not found'); return; }

  if (action.completed_date) {
    fail(res, 409, 'ALREADY_COMPLETED', 'This remedial action is already marked complete');
    return;
  }

  const parsed = remedialActionCompleteZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const { completedDate, durationMinutes, notes } = parsed.data;

  db.prepare(`
    UPDATE remedial_action
    SET completed_date = ?, duration_minutes = ?, notes = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(completedDate, durationMinutes, notes ?? null, now(), req.params.aid, tenantId);

  const updated = db.prepare('SELECT * FROM remedial_action WHERE id = ?').get(req.params.aid) as object;
  ok(res, updated);
});

// ─── Reassessments ────────────────────────────────────────────────────────────

/**
 * GET /api/v1/deficits/:id/reassessments
 */
app.get('/api/v1/deficits/:id/reassessments', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (role === 'PILOT' && deficit.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You may only view reassessments for your own deficits');
    return;
  }

  const rows = db.prepare(
    'SELECT * FROM reassessment WHERE deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY scheduled_for ASC'
  ).all(req.params.id, tenantId) as object[];

  ok(res, rows);
});

/**
 * POST /api/v1/deficits/:id/reassessments
 * R-C-2: scheduledFor must be <= due_at (422 if beyond).
 */
app.post('/api/v1/deficits/:id/reassessments', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may schedule reassessments');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (CLOSED_STATUSES.has(deficit.status as string)) {
    fail(res, 410, 'DEFICIT_CLOSED', 'Cannot schedule reassessment for a closed deficit');
    return;
  }

  const parsed = reassessmentScheduleZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const { scheduledFor, scheduledSlotId } = parsed.data;

  // R-C-2: scheduledFor must be <= due_at
  const dueAt = deficit.due_at as string;
  if (new Date(scheduledFor) > new Date(dueAt)) {
    fail(res, 422, 'REASSESSMENT_BEYOND_DUE_DATE',
      `Reassessment must be scheduled on or before the deficit due date (${dueAt})`);
    return;
  }

  const id = randomUUID();

  txn(db, () => {
    db.prepare(`
      INSERT INTO reassessment (id, tenant_id, deficit_id, scheduled_for, scheduled_slot_id)
      VALUES (?,?,?,?,?)
    `).run(id, tenantId, req.params.id, scheduledFor, scheduledSlotId ?? null);

    db.prepare(`UPDATE deficit SET status = 'REASSESSMENT_SCHEDULED', updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(now(), req.params.id, tenantId);
  });

  const reassessment = db.prepare('SELECT * FROM reassessment WHERE id = ?').get(id) as object;
  ok(res, reassessment, 201);
});

/**
 * POST /api/v1/deficits/:id/reassessments/:rid/record-outcome
 * R-C-5: PASS → auto-resolve deficit (status=RESOLVED, resolved_at, resolution_assessment_id).
 *         FAIL keeps deficit OPEN.
 */
app.post('/api/v1/deficits/:id/reassessments/:rid/record-outcome', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may record reassessment outcomes');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  const reassessment = db.prepare(
    'SELECT * FROM reassessment WHERE id = ? AND deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.rid, req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!reassessment) { fail(res, 404, 'NOT_FOUND', 'Reassessment not found'); return; }

  if (reassessment.outcome) {
    fail(res, 409, 'OUTCOME_ALREADY_RECORDED', 'An outcome has already been recorded for this reassessment');
    return;
  }

  const parsed = reassessmentOutcomeZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const {
    conductedAt, conductedByInstructorId, resultingAssessmentId, outcome,
    simulatorId, simulatorQualificationLevel,
  } = parsed.data;

  txn(db, () => {
    db.prepare(`
      UPDATE reassessment
      SET conducted_at = ?, conducted_by_instructor_id = ?, resulting_assessment_id = ?,
          outcome = ?, simulator_id = ?, simulator_qualification_level = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      conductedAt, conductedByInstructorId, resultingAssessmentId,
      outcome, simulatorId ?? null, simulatorQualificationLevel ?? null, now(),
      req.params.rid, tenantId,
    );

    // R-C-5: PASS → auto-resolve deficit
    if (outcome === 'PASS') {
      db.prepare(`
        UPDATE deficit
        SET status = 'RESOLVED', resolved_at = ?, resolution_assessment_id = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(now(), resultingAssessmentId, now(), req.params.id, tenantId);
    } else if (outcome === 'FAIL') {
      // Revert back to OPEN so a new remediation cycle can begin
      db.prepare(`UPDATE deficit SET status = 'OPEN', updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .run(now(), req.params.id, tenantId);
    }
    // NO_SHOW / CANCELLED — leave status unchanged
  });

  const updatedReassessment = db.prepare('SELECT * FROM reassessment WHERE id = ?').get(req.params.rid) as object;
  const updatedDeficit      = db.prepare('SELECT * FROM deficit WHERE id = ?').get(req.params.id) as object;
  ok(res, { reassessment: updatedReassessment, deficit: updatedDeficit });
});

// ─── Escalations ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/deficits/:id/escalations
 */
app.get('/api/v1/deficits/:id/escalations', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (role === 'PILOT' && deficit.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You may only view escalations for your own deficits');
    return;
  }

  const rows = db.prepare(
    'SELECT * FROM deficit_escalation WHERE deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY triggered_at ASC'
  ).all(req.params.id, tenantId) as object[];

  ok(res, rows);
});

/**
 * POST /api/v1/deficits/:id/escalate
 * CFI only. Creates escalation entry and sets deficit status = ESCALATED.
 */
app.post('/api/v1/deficits/:id/escalate', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: callerId, role } = req.user!;

  if (!isCfiOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only CFIs or admins may escalate deficits');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (CLOSED_STATUSES.has(deficit.status as string)) {
    fail(res, 410, 'DEFICIT_CLOSED', 'Cannot escalate a closed deficit');
    return;
  }

  const parsed = escalateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  // Determine next escalation level based on existing escalations
  const existingEscalations = db.prepare(
    'SELECT escalation_level FROM deficit_escalation WHERE deficit_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY triggered_at DESC LIMIT 1'
  ).get(req.params.id, tenantId) as { escalation_level: string } | undefined;

  let nextLevel: string;
  if (!existingEscalations) {
    nextLevel = 'LEVEL_1_CFI';
  } else if (existingEscalations.escalation_level === 'LEVEL_1_CFI') {
    nextLevel = 'LEVEL_2_HEAD_OF_TRAINING';
  } else {
    nextLevel = 'LEVEL_3_AUTHORITY';
  }

  const id       = randomUUID();
  const triggeredAt = now();

  txn(db, () => {
    db.prepare(`
      INSERT INTO deficit_escalation (id, tenant_id, deficit_id, escalation_level, triggered_at, triggered_by, notes)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, tenantId, req.params.id, nextLevel, triggeredAt, 'USER', parsed.data.reason);

    db.prepare(`UPDATE deficit SET status = 'ESCALATED', escalated_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .run(triggeredAt, now(), req.params.id, tenantId);
  });

  const escalation = db.prepare('SELECT * FROM deficit_escalation WHERE id = ?').get(id) as object;
  ok(res, escalation, 201);
});

/**
 * POST /api/v1/deficits/:id/acknowledge-escalation
 * Acknowledges the latest unacknowledged escalation for a deficit.
 */
app.post('/api/v1/deficits/:id/acknowledge-escalation', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: callerId, role } = req.user!;

  if (!isInstructorOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only instructors, CFIs, or admins may acknowledge escalations');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  // Find latest unacknowledged escalation
  const escalation = db.prepare(`
    SELECT * FROM deficit_escalation
    WHERE deficit_id = ? AND tenant_id = ? AND acknowledged_at IS NULL AND deleted_at IS NULL
    ORDER BY triggered_at DESC
    LIMIT 1
  `).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!escalation) {
    fail(res, 404, 'NO_PENDING_ESCALATION', 'No unacknowledged escalation found for this deficit');
    return;
  }

  const acknowledgedAt = now();

  db.prepare(`
    UPDATE deficit_escalation
    SET acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(acknowledgedAt, callerId, now(), escalation.id as string, tenantId);

  const updated = db.prepare('SELECT * FROM deficit_escalation WHERE id = ?').get(escalation.id as string) as object;
  ok(res, updated);
});

// ─── Waive ────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/deficits/:id/waive
 * CFI only.
 * R-C-6: reason >= 50 chars, authorityRef required.
 * Sets status=WAIVED, waived_by, waived_at, waived_reason.
 */
app.post('/api/v1/deficits/:id/waive', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: callerId, role } = req.user!;

  if (!isCfiOrAbove(role)) {
    fail(res, 403, 'FORBIDDEN', 'Only CFIs or admins may waive deficits');
    return;
  }

  const deficit = db.prepare(
    'SELECT * FROM deficit WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!deficit) { fail(res, 404, 'NOT_FOUND', 'Deficit not found'); return; }

  if (CLOSED_STATUSES.has(deficit.status as string)) {
    fail(res, 410, 'DEFICIT_CLOSED', 'This deficit is already closed');
    return;
  }

  const parsed = deficitWaiveZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const { reason, authorityRef } = parsed.data;
  const waivedAt = now();

  // Embed authorityRef in waived_reason for audit trail
  const fullReason = `[Authority: ${authorityRef}] ${reason}`;

  db.prepare(`
    UPDATE deficit
    SET status = 'WAIVED', waived_by = ?, waived_at = ?, waived_reason = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(callerId, waivedAt, fullReason, now(), req.params.id, tenantId);

  const updated = db.prepare('SELECT * FROM deficit WHERE id = ?').get(req.params.id) as object;
  ok(res, updated);
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[deficit-tracking]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[deficit-tracking] ✓  http://localhost:${PORT}`));
