import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createHash, randomUUID } from 'crypto';
import { createDatabase, txn } from './db';
import { authenticate, requireRole } from './middleware/auth';
import {
  programmeCreateZ, programmeUpdateZ, approveProgrammeZ,
  phaseCreateZ, moduleCreateZ, prereqCreateZ, gateCreateZ,
  enrolmentCreateZ, gateOverrideZ, competencyTargetCreateZ,
  sessionCreateZ, upsertAssessmentsZ, signSessionZ, amendSessionZ,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3005', 10);
const db   = createDatabase();
const app  = express();

app.use(express.json({ limit: '2mb' }));
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

function parsePage(q: Record<string, string>): { limit: number; offset: number; page: number } {
  const page     = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '25', 10) || 25));
  return { limit: pageSize, offset: (page - 1) * pageSize, page };
}

function emitEvent(event: string, tenantId: string, payload: Record<string, unknown>): void {
  console.log(`[EventBridge] ${event}`, JSON.stringify({
    tenantId, traceId: randomUUID(), occurredAt: new Date().toISOString(),
    schemaVersion: '1.0', event, payload,
  }));
}

function writeAudit(
  actorId: string, tenantId: string, action: string,
  entityType: string, entityId: string,
  before: unknown, after: unknown, reason?: string,
): void {
  try {
    db.prepare(`
      INSERT INTO ftmc_audit_log (id, tenant_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, reason, request_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      randomUUID(), tenantId, actorId, action, entityType, entityId,
      before ? JSON.stringify(before) : null,
      after  ? JSON.stringify(after)  : null,
      reason ?? null,
      randomUUID(),
    );
  } catch { /* non-fatal */ }
}

// Deserialise helpers
function deserializeProgramme(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    regulatoryBasis:      JSON.parse((r.regulatory_basis     as string) ?? '[]'),
    prerequisiteRatings:  JSON.parse((r.prerequisite_ratings as string) ?? '[]'),
    regulatory_basis:     undefined,
    prerequisite_ratings: undefined,
  };
}

function deserializeModule(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    learningObjectives:    JSON.parse((r.learning_objectives   as string) ?? '[]'),
    competencyUnitCodes:   JSON.parse((r.competency_unit_codes as string) ?? '[]'),
    mandatory:             r.mandatory === 1,
    learning_objectives:   undefined,
    competency_unit_codes: undefined,
  };
}

function deserializeGate(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    parameters:        JSON.parse((r.parameters as string) ?? '{}'),
    blocksProgression: r.blocks_progression === 1,
    blocks_progression: undefined,
  };
}

function deserializeSession(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    examinerRequired: r.examiner_required === 1,
    examiner_required: undefined,
  };
}

function deserializeAssessment(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    behaviouralMarkers: JSON.parse((r.behavioural_markers as string) ?? '[]'),
    behavioural_markers: undefined,
  };
}

function isLocked(row: Record<string, unknown>): boolean {
  if (!row.locked_at) return false;
  return new Date() >= new Date(row.locked_at as string);
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'training-programmes' }));

// ─── Programmes ───────────────────────────────────────────────────────────────

app.get('/api/v1/programmes', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const q = req.query as Record<string, string>;
  const { limit, offset, page } = parsePage(q);

  let query  = 'SELECT * FROM training_programme WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number | null)[] = [tenantId];

  if (q.aircraftType) { query += ' AND aircraft_type = ?';  params.push(q.aircraftType); }
  if (q.type)         { query += ' AND programme_type = ?'; params.push(q.type); }
  if (q.status)       { query += ' AND status = ?';         params.push(q.status); }

  const { count } = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) AS count')).get(...params) as { count: number };
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  ok(res, rows.map(deserializeProgramme), 200, { page, pageSize: limit, total: count });
});

app.post('/api/v1/programmes', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const parsed = programmeCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { tenantId, id: userId } = req.user!;
  const { code, name, aircraftType, type, regulatoryFramework, regulatoryBasis,
    validityMonths, prerequisiteRatings, authorityApprovalRef, approvalValidFrom,
    approvalValidUntil, supersedesProgrammeId } = parsed.data;

  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO training_programme (
        id, tenant_id, code, title, aircraft_type, programme_type,
        regulatory_framework, regulatory_basis, validity_months, prerequisite_ratings,
        authority_approval_ref, approval_valid_from, approval_valid_until,
        supersedes_programme_id, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, tenantId, code, name, aircraftType, type,
      regulatoryFramework, JSON.stringify(regulatoryBasis), validityMonths ?? null,
      JSON.stringify(prerequisiteRatings ?? []),
      authorityApprovalRef, approvalValidFrom, approvalValidUntil ?? null,
      supersedesProgrammeId ?? null, userId,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'Programme code + version already exists'); return; }
    throw e;
  }

  const row = db.prepare('SELECT * FROM training_programme WHERE id = ?').get(id) as Record<string, unknown>;
  emitEvent('training.programme.created', tenantId, { programmeId: id, code, version: 1, createdBy: userId });
  writeAudit(userId, tenantId, 'CREATE', 'training_programme', id, null, row);
  ok(res, deserializeProgramme(row), 201);
});

app.get('/api/v1/programmes/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, req.user!.tenantId) as Record<string, unknown> | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  ok(res, deserializeProgramme(row));
});

app.patch('/api/v1/programmes/:id', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const existing = db.prepare(
    'SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (existing.status !== 'DRAFT') { fail(res, 410, 'PROGRAMME_NOT_EDITABLE', 'Only DRAFT programmes can be updated'); return; }

  const parsed = programmeUpdateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  const { name, approvalValidUntil, authorityApprovalRef, regulatoryBasis, validityMonths, prerequisiteRatings } = parsed.data;
  if (name !== undefined)                { setClauses.push('title = ?');                  values.push(name); }
  if (approvalValidUntil !== undefined)  { setClauses.push('approval_valid_until = ?');   values.push(approvalValidUntil); }
  if (authorityApprovalRef !== undefined){ setClauses.push('authority_approval_ref = ?'); values.push(authorityApprovalRef); }
  if (regulatoryBasis !== undefined)     { setClauses.push('regulatory_basis = ?');       values.push(JSON.stringify(regulatoryBasis)); }
  if (validityMonths !== undefined)      { setClauses.push('validity_months = ?');        values.push(validityMonths); }
  if (prerequisiteRatings !== undefined) { setClauses.push('prerequisite_ratings = ?');   values.push(JSON.stringify(prerequisiteRatings)); }

  db.prepare(`UPDATE training_programme SET ${setClauses.join(', ')} WHERE id = ?`).run(...values, req.params.id);

  const updated = db.prepare('SELECT * FROM training_programme WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  writeAudit(userId, tenantId, 'UPDATE', 'training_programme', req.params.id, existing, updated);
  ok(res, deserializeProgramme(updated));
});

app.post('/api/v1/programmes/:id/approve', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const programme = db.prepare(
    'SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (programme.status !== 'DRAFT') { fail(res, 409, 'INVALID_STATUS', 'Only DRAFT programmes can be approved'); return; }

  const parsed = approveProgrammeZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  // Must have at least one phase and one competency target
  const { count: phaseCount } = db.prepare(
    'SELECT COUNT(*) AS count FROM programme_phase WHERE programme_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as { count: number };
  if (phaseCount === 0) { fail(res, 422, 'NO_PHASES', 'Programme must have at least one phase before approval'); return; }

  const now = new Date().toISOString();
  const { authorityApprovalRef, approvalValidFrom, approvalValidUntil } = parsed.data;

  db.prepare(`
    UPDATE training_programme
    SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?,
        authority_approval_ref = ?, approval_valid_from = ?, approval_valid_until = ?
    WHERE id = ?
  `).run(userId, now, now, authorityApprovalRef, approvalValidFrom, approvalValidUntil ?? null, req.params.id);

  const updated = db.prepare('SELECT * FROM training_programme WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  emitEvent('training.programme.approved', tenantId, {
    programmeId: req.params.id, code: programme.code, version: programme.version,
    approvedBy: userId, authorityApprovalRef,
  });
  writeAudit(userId, tenantId, 'APPROVE', 'training_programme', req.params.id, programme, updated);
  ok(res, deserializeProgramme(updated));
});

app.post('/api/v1/programmes/:id/retire', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const programme = db.prepare(
    'SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (programme.status === 'RETIRED') { fail(res, 409, 'INVALID_STATUS', 'Programme is already retired'); return; }

  const now = new Date().toISOString();
  db.prepare('UPDATE training_programme SET status = \'RETIRED\', updated_at = ? WHERE id = ?').run(now, req.params.id);

  const updated = db.prepare('SELECT * FROM training_programme WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  emitEvent('training.programme.retired', tenantId, { programmeId: req.params.id, retiredBy: userId });
  writeAudit(userId, tenantId, 'RETIRE', 'training_programme', req.params.id, programme, updated);
  ok(res, deserializeProgramme(updated));
});

// ─── Competency Targets ───────────────────────────────────────────────────────

app.get('/api/v1/programmes/:id/competency-targets', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const prog = db.prepare('SELECT id FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId);
  if (!prog) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM competency_target WHERE programme_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY competency_unit_code',
  ).all(req.params.id, tenantId) as object[];
  ok(res, rows);
});

app.post('/api/v1/programmes/:id/competency-targets', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const programme = db.prepare(
    'SELECT status FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (programme.status !== 'DRAFT') { fail(res, 410, 'PROGRAMME_NOT_EDITABLE', 'Targets can only be set on DRAFT programmes'); return; }

  const parsed = competencyTargetCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { competencyUnitCode, phaseId, minimumScore, remedialTriggerScore, requiredAssessmentCount } = parsed.data;
  const id = randomUUID();

  try {
    db.prepare(`
      INSERT INTO competency_target (id, tenant_id, programme_id, phase_id, competency_unit_code, minimum_score, remedial_trigger_score, required_assessment_count)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, tenantId, req.params.id, phaseId ?? null, competencyUnitCode, minimumScore, remedialTriggerScore, requiredAssessmentCount);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'A competency target for this CU already exists on this programme/phase'); return; }
    throw e;
  }

  const row = db.prepare('SELECT * FROM competency_target WHERE id = ?').get(id) as object;
  ok(res, row, 201);
});

// ─── Phases ───────────────────────────────────────────────────────────────────

app.get('/api/v1/programmes/:id/phases', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const prog = db.prepare('SELECT id FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId);
  if (!prog) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  const phases = db.prepare('SELECT * FROM programme_phase WHERE programme_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY sequence').all(req.params.id, tenantId) as object[];
  ok(res, phases);
});

app.post('/api/v1/programmes/:id/phases', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const programme = db.prepare('SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (programme.status !== 'DRAFT') { fail(res, 409, 'PROGRAMME_NOT_EDITABLE', 'Phases can only be added to DRAFT programmes'); return; }

  const parsed = phaseCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { sequence, code, name, deliveryMode, minimumSessions, plannedDurationMinutes, gateStrategy } = parsed.data;
  const id = randomUUID();

  try {
    db.prepare(`
      INSERT INTO programme_phase (id, tenant_id, programme_id, sequence, code, title, duration_hours, minimum_sessions, delivery_mode, planned_duration_minutes, gate_strategy)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, tenantId, req.params.id, sequence, code, name, plannedDurationMinutes / 60, minimumSessions, deliveryMode, plannedDurationMinutes, gateStrategy);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'A phase with this sequence already exists'); return; }
    throw e;
  }

  const phase = db.prepare('SELECT * FROM programme_phase WHERE id = ?').get(id) as object;
  ok(res, phase, 201);
});

// ─── Modules ──────────────────────────────────────────────────────────────────

app.get('/api/v1/phases/:phaseId/modules', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const phase = db.prepare('SELECT id FROM programme_phase WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.phaseId, tenantId);
  if (!phase) { fail(res, 404, 'NOT_FOUND', 'Phase not found'); return; }
  const rows = db.prepare('SELECT * FROM programme_module WHERE phase_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY sequence').all(req.params.phaseId, tenantId) as Record<string, unknown>[];
  ok(res, rows.map(deserializeModule));
});

app.post('/api/v1/phases/:phaseId/modules', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const phase = db.prepare(`
    SELECT pp.*, tp.status AS programme_status FROM programme_phase pp
    JOIN training_programme tp ON tp.id = pp.programme_id
    WHERE pp.id = ? AND pp.tenant_id = ? AND pp.deleted_at IS NULL
  `).get(req.params.phaseId, tenantId) as Record<string, unknown> | undefined;

  if (!phase) { fail(res, 404, 'NOT_FOUND', 'Phase not found'); return; }
  if (phase.programme_status !== 'DRAFT') { fail(res, 409, 'PROGRAMME_NOT_EDITABLE', 'Modules can only be added to DRAFT programmes'); return; }

  const parsed = moduleCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { sequence, code, name, sessionType, minimumDurationMinutes, competencyUnitCodes, learningObjectives, mandatory, minimumOverallScore } = parsed.data;
  const id = randomUUID();

  db.prepare(`
    INSERT INTO programme_module (id, tenant_id, phase_id, sequence, code, title, session_type, minimum_duration_minutes, competency_unit_codes, learning_objectives, mandatory, minimum_overall_score)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, req.params.phaseId, sequence, code, name, sessionType ?? null, minimumDurationMinutes, JSON.stringify(competencyUnitCodes), JSON.stringify(learningObjectives), mandatory ? 1 : 0, minimumOverallScore ?? null);

  const row = db.prepare('SELECT * FROM programme_module WHERE id = ?').get(id) as Record<string, unknown>;
  ok(res, deserializeModule(row), 201);
});

// ─── Prerequisites ────────────────────────────────────────────────────────────

app.get('/api/v1/modules/:moduleId/prerequisites', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const mod = db.prepare('SELECT id FROM programme_module WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.moduleId, tenantId);
  if (!mod) { fail(res, 404, 'NOT_FOUND', 'Module not found'); return; }
  const rows = db.prepare('SELECT * FROM prerequisite WHERE module_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at').all(req.params.moduleId, tenantId) as object[];
  ok(res, rows);
});

app.post('/api/v1/modules/:moduleId/prerequisites', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const mod = db.prepare('SELECT id FROM programme_module WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.moduleId, tenantId);
  if (!mod) { fail(res, 404, 'NOT_FOUND', 'Module not found'); return; }

  const parsed = prereqCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { prerequisiteModuleId, prerequisiteProgrammeId, prerequisiteRatingCode, type, waiverAllowedByRole } = parsed.data;

  if (prerequisiteModuleId) {
    if (req.params.moduleId === prerequisiteModuleId) { fail(res, 409, 'SELF_REFERENCE', 'A module cannot be a prerequisite of itself'); return; }
    const preqMod = db.prepare('SELECT id FROM programme_module WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(prerequisiteModuleId, tenantId);
    if (!preqMod) { fail(res, 404, 'NOT_FOUND', 'Prerequisite module not found'); return; }
  }

  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO prerequisite (id, tenant_id, module_id, prerequisite_module_id, type, waiver_allowed_by_role)
      VALUES (?,?,?,?,?,?)
    `).run(id, tenantId, req.params.moduleId, prerequisiteModuleId ?? prerequisiteProgrammeId ?? prerequisiteRatingCode ?? null, type, waiverAllowedByRole);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'This prerequisite relationship already exists'); return; }
    throw e;
  }

  const row = db.prepare('SELECT * FROM prerequisite WHERE id = ?').get(id) as object;
  ok(res, row, 201);
});

// ─── Gate Criteria ────────────────────────────────────────────────────────────

app.get('/api/v1/phases/:phaseId/gates', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const phase = db.prepare('SELECT id FROM programme_phase WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.phaseId, tenantId);
  if (!phase) { fail(res, 404, 'NOT_FOUND', 'Phase not found'); return; }
  const rows = db.prepare('SELECT * FROM gate_criterion WHERE phase_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at').all(req.params.phaseId, tenantId) as Record<string, unknown>[];
  ok(res, rows.map(deserializeGate));
});

app.post('/api/v1/phases/:phaseId/gates', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const phase = db.prepare(`
    SELECT pp.*, tp.status AS programme_status FROM programme_phase pp
    JOIN training_programme tp ON tp.id = pp.programme_id
    WHERE pp.id = ? AND pp.tenant_id = ? AND pp.deleted_at IS NULL
  `).get(req.params.phaseId, tenantId) as Record<string, unknown> | undefined;

  if (!phase) { fail(res, 404, 'NOT_FOUND', 'Phase not found'); return; }
  if (phase.programme_status !== 'DRAFT') { fail(res, 409, 'PROGRAMME_NOT_EDITABLE', 'Gate criteria can only be added to DRAFT programmes'); return; }

  const parsed = gateCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { criterionType, parameters, blocksProgression, evidenceService } = parsed.data;
  const id = randomUUID();

  db.prepare(`
    INSERT INTO gate_criterion (id, tenant_id, phase_id, criterion_type, parameters, blocks_progression, evidence_service)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, tenantId, req.params.phaseId, criterionType, JSON.stringify(parameters), blocksProgression ? 1 : 0, evidenceService ?? null);

  const row = db.prepare('SELECT * FROM gate_criterion WHERE id = ?').get(id) as Record<string, unknown>;
  ok(res, deserializeGate(row), 201);
});

// ─── Enrolments ───────────────────────────────────────────────────────────────

app.get('/api/v1/enrolments', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const q = req.query as Record<string, string>;
  const { limit, offset, page } = parsePage(q);

  let query  = 'SELECT * FROM programme_enrolment WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number | null)[] = [tenantId];

  if (q.pilotId) { query += ' AND pilot_id = ?'; params.push(q.pilotId); }
  if (q.status)  { query += ' AND status = ?';   params.push(q.status); }

  const { count } = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) AS count')).get(...params) as { count: number };
  query += ' ORDER BY enrolled_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as object[];
  ok(res, rows, 200, { page, pageSize: limit, total: count });
});

app.post('/api/v1/enrolments', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  // Accept both old and new schema
  const bodyWithProgramme = { ...req.body };
  if (req.body.programmeId && !bodyWithProgramme.pilotId) {
    fail(res, 400, 'VALIDATION_ERROR', 'pilotId is required'); return;
  }

  const programmeId = req.body.programmeId as string;
  if (!programmeId) { fail(res, 400, 'VALIDATION_ERROR', 'programmeId is required'); return; }

  const parsed = enrolmentCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { pilotId, expectedCompletionAt } = parsed.data;

  const programme = db.prepare('SELECT * FROM training_programme WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(programmeId, tenantId) as Record<string, unknown> | undefined;
  if (!programme) { fail(res, 404, 'NOT_FOUND', 'Programme not found'); return; }
  if (programme.status !== 'APPROVED') { fail(res, 422, 'PROGRAMME_NOT_APPROVED', 'Pilots can only be enrolled in APPROVED programmes'); return; }

  // Check for duplicate active enrolment
  const dupe = db.prepare(
    "SELECT id FROM programme_enrolment WHERE tenant_id = ? AND programme_id = ? AND pilot_id = ? AND status IN ('ENROLLED','IN_PROGRESS','GATE_BLOCKED') AND deleted_at IS NULL"
  ).get(tenantId, programmeId, pilotId);
  if (dupe) { fail(res, 409, 'CONFLICT', 'Pilot already has an active enrolment for this programme'); return; }

  const id  = randomUUID();
  const now = new Date().toISOString();
  const phases = db.prepare('SELECT id FROM programme_phase WHERE programme_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY sequence').all(programmeId, tenantId) as { id: string }[];

  txn(db, () => {
    db.prepare(`
      INSERT INTO programme_enrolment (id, tenant_id, programme_id, pilot_id, enrolled_by, enrolled_at, expected_completion_at, status)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, tenantId, programmeId, pilotId, userId, now, expectedCompletionAt ?? null, 'ENROLLED');

    for (const phase of phases) {
      db.prepare('INSERT INTO programme_progress (id, tenant_id, enrolment_id, phase_id, status) VALUES (?,?,?,?,?)').run(randomUUID(), tenantId, id, phase.id, 'NOT_STARTED');
    }
  });

  const enrolment = db.prepare('SELECT * FROM programme_enrolment WHERE id = ?').get(id) as object;
  emitEvent('training.enrolment.created', tenantId, { enrolmentId: id, programmeId, pilotId, enrolledBy: userId });
  ok(res, enrolment, 201);
});

app.get('/api/v1/enrolments/:id', authenticate, (req: Request, res: Response) => {
  const enrolment = db.prepare('SELECT * FROM programme_enrolment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, req.user!.tenantId) as object | undefined;
  if (!enrolment) { fail(res, 404, 'NOT_FOUND', 'Enrolment not found'); return; }
  ok(res, enrolment);
});

app.get('/api/v1/enrolments/:id/progress', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const enrolment = db.prepare('SELECT id FROM programme_enrolment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as { id: string } | undefined;
  if (!enrolment) { fail(res, 404, 'NOT_FOUND', 'Enrolment not found'); return; }

  const rows = db.prepare(`
    SELECT pp.*, ph.sequence, ph.code AS phase_code, ph.title AS phase_title, ph.delivery_mode, ph.gate_strategy
    FROM programme_progress pp
    JOIN programme_phase ph ON ph.id = pp.phase_id
    WHERE pp.enrolment_id = ? AND pp.tenant_id = ? AND pp.deleted_at IS NULL
    ORDER BY ph.sequence
  `).all(req.params.id, tenantId) as object[];
  ok(res, rows);
});

app.post('/api/v1/enrolments/:id/gate-override', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const enrolment = db.prepare('SELECT * FROM programme_enrolment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!enrolment) { fail(res, 404, 'NOT_FOUND', 'Enrolment not found'); return; }

  const parsed = gateOverrideZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { phaseId, reason } = parsed.data;
  const phase = db.prepare('SELECT id FROM programme_phase WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(phaseId, tenantId);
  if (!phase) { fail(res, 404, 'NOT_FOUND', 'Phase not found'); return; }

  const progressRow = db.prepare('SELECT * FROM programme_progress WHERE enrolment_id = ? AND phase_id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, phaseId, tenantId) as Record<string, unknown> | undefined;
  if (!progressRow) { fail(res, 404, 'NOT_FOUND', 'Progress record not found for this enrolment and phase'); return; }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE programme_progress SET status = 'IN_PROGRESS', gate_override_by = ?, gate_override_reason = ?, gate_override_at = ?, updated_at = ?
    WHERE enrolment_id = ? AND phase_id = ? AND tenant_id = ?
  `).run(userId, reason, now, now, req.params.id, phaseId, tenantId);

  const updated = db.prepare('SELECT * FROM programme_progress WHERE enrolment_id = ? AND phase_id = ? AND tenant_id = ?').get(req.params.id, phaseId, tenantId) as object;
  writeAudit(userId, tenantId, 'GATE_OVERRIDE', 'programme_progress', req.params.id, progressRow, updated, reason);
  emitEvent('training.enrolment.gate_blocked', tenantId, { enrolmentId: req.params.id, phaseId, overrideBy: userId, reason });
  ok(res, updated);
});

// ─── Training Session Records ─────────────────────────────────────────────────

app.get('/api/v1/sessions', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const q = req.query as Record<string, string>;
  const { limit, offset, page } = parsePage(q);

  let query = 'SELECT * FROM training_session_record WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number | null)[] = [tenantId];

  // Pilots can only see their own sessions
  if (role === 'PILOT') { query += ' AND pilot_id = ?'; params.push(userId); }
  else if (q.pilotId)   { query += ' AND pilot_id = ?'; params.push(q.pilotId); }

  if (q.sessionType)  { query += ' AND session_type = ?';  params.push(q.sessionType); }
  if (q.enrolmentId)  { query += ' AND enrolment_id = ?';  params.push(q.enrolmentId); }
  if (q.outcome)      { query += ' AND outcome = ?';       params.push(q.outcome); }

  const { count } = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) AS count')).get(...params) as { count: number };
  query += ' ORDER BY assessed_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  ok(res, rows.map(deserializeSession), 200, { page, pageSize: limit, total: count });
});

app.post('/api/v1/sessions', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const parsed = sessionCreateZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const data = parsed.data;

  // Examiner required for OPC/LPC/ITR
  const requiresExaminer = ['ITR','OPC','LPC'].includes(data.sessionType);
  if (requiresExaminer && !data.examinerId) {
    fail(res, 422, 'EXAMINER_REQUIRED', `Session type ${data.sessionType} requires an examiner ID and authorisation reference`);
    return;
  }

  // Same-day simulator guard
  if (data.simulatorId) {
    const sessionDate = data.startedAt.slice(0, 10);
    const sameDay = db.prepare(`
      SELECT id FROM training_session_record
      WHERE tenant_id = ? AND pilot_id = ? AND simulator_id IS NOT NULL AND deleted_at IS NULL
      AND date(started_at) = ?
    `).get(tenantId, data.pilotId, sessionDate);

    if (sameDay) {
      fail(res, 422, 'SAME_DAY_SESSION', 'Pilot already has a simulator session on this date (fatigue guard — FCL.060)');
      return;
    }
  }

  // Duration check against module minimum if linked
  const durationMinutes = Math.round((new Date(data.endedAt).getTime() - new Date(data.startedAt).getTime()) / 60000);
  if (data.programmeModuleId) {
    const mod = db.prepare('SELECT minimum_duration_minutes FROM programme_module WHERE id = ? AND tenant_id = ?').get(data.programmeModuleId, tenantId) as { minimum_duration_minutes: number } | undefined;
    if (mod && durationMinutes < mod.minimum_duration_minutes) {
      fail(res, 422, 'DURATION_TOO_SHORT', `Session duration (${durationMinutes} min) is below module minimum (${mod.minimum_duration_minutes} min)`);
      return;
    }
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO training_session_record (
      id, tenant_id, enrolment_id, programme_module_id, reservation_id,
      pilot_id, instructor_id, instructor_qualification,
      examiner_required, examiner_id, examiner_authorisation_ref,
      session_type, scenario_id, aircraft_type,
      simulator_id, simulator_qualification_level, simulator_approval_ref,
      started_at, ended_at, duration_minutes, assessed_at, outcome
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId,
    data.enrolmentId ?? null, data.programmeModuleId ?? null, data.reservationId ?? null,
    data.pilotId, data.instructorId, data.instructorQualification,
    requiresExaminer ? 1 : 0, data.examinerId ?? null, data.examinerAuthorisationRef ?? null,
    data.sessionType, data.scenarioId ?? null, data.aircraftType,
    data.simulatorId ?? null, data.simulatorQualificationLevel ?? null, data.simulatorApprovalRef ?? null,
    data.startedAt, data.endedAt, durationMinutes, data.assessedAt, data.outcome,
  );

  const row = db.prepare('SELECT * FROM training_session_record WHERE id = ?').get(id) as Record<string, unknown>;
  emitEvent('training.session.recorded', tenantId, { sessionRecordId: id, pilotId: data.pilotId, sessionType: data.sessionType, instructorId: data.instructorId, assessedAt: data.assessedAt });
  writeAudit(userId, tenantId, 'CREATE', 'training_session_record', id, null, row);
  ok(res, deserializeSession(row), 201);
});

app.get('/api/v1/sessions/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const row = db.prepare('SELECT * FROM training_session_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!row) { fail(res, 404, 'NOT_FOUND', 'Session not found'); return; }
  if (role === 'PILOT' && row.pilot_id !== userId) { fail(res, 403, 'FORBIDDEN', 'You can only view your own session records'); return; }
  ok(res, deserializeSession(row));
});

// ─── Competency Assessments ───────────────────────────────────────────────────

app.get('/api/v1/sessions/:id/assessments', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const session = db.prepare('SELECT * FROM training_session_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!session) { fail(res, 404, 'NOT_FOUND', 'Session not found'); return; }
  if (role === 'PILOT' && session.pilot_id !== userId) { fail(res, 403, 'FORBIDDEN', 'You can only view your own assessments'); return; }

  const rows = db.prepare('SELECT * FROM competency_assessment WHERE session_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY competency_unit_code').all(req.params.id, tenantId) as Record<string, unknown>[];
  ok(res, rows.map(deserializeAssessment));
});

app.put('/api/v1/sessions/:id/assessments', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const session = db.prepare('SELECT * FROM training_session_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!session) { fail(res, 404, 'NOT_FOUND', 'Session not found'); return; }

  // 48h immutability check
  if (isLocked(session)) {
    fail(res, 410, 'IMMUTABLE_RECORD', 'This session record is locked (signed and past 48h). A CFI/TRE override with documented reason is required.');
    return;
  }

  const parsed = upsertAssessmentsZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const now = new Date().toISOString();
  const deficitTriggers: { cuCode: string; score: number }[] = [];

  txn(db, () => {
    for (const a of parsed.data.assessments) {
      const asmId = randomUUID();
      db.prepare(`
        INSERT INTO competency_assessment (id, tenant_id, session_record_id, competency_unit_code, score, behavioural_markers, notes, assessed_by, assessed_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id, session_record_id, competency_unit_code) DO UPDATE SET
          score = excluded.score, behavioural_markers = excluded.behavioural_markers,
          notes = excluded.notes, assessed_by = excluded.assessed_by,
          assessed_at = excluded.assessed_at, updated_at = excluded.assessed_at
      `).run(asmId, tenantId, req.params.id, a.competencyUnitCode, a.score, JSON.stringify(a.behaviouralMarkers), a.notes ?? null, userId, now);

      if (a.score <= 2) {
        deficitTriggers.push({ cuCode: a.competencyUnitCode, score: a.score });
      }
    }
  });

  // Emit deficit events for scores <= remedial trigger
  for (const d of deficitTriggers) {
    const dueAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    emitEvent('training.deficit.triggered', tenantId, {
      sessionRecordId: req.params.id,
      pilotId: session.pilot_id,
      competencyUnitCode: d.cuCode,
      score: d.score,
      dueAt,
    });
  }

  const scores = parsed.data.assessments.reduce<Record<string, number>>((acc, a) => {
    acc[a.competencyUnitCode] = a.score;
    return acc;
  }, {});
  emitEvent('training.competency.assessed', tenantId, { sessionRecordId: req.params.id, pilotId: session.pilot_id, scores });

  const rows = db.prepare('SELECT * FROM competency_assessment WHERE session_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY competency_unit_code').all(req.params.id, tenantId) as Record<string, unknown>[];
  ok(res, rows.map(deserializeAssessment));
});

// ─── Sign session ─────────────────────────────────────────────────────────────

app.post('/api/v1/sessions/:id/sign', authenticate, requireRole('CFI', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const session = db.prepare('SELECT * FROM training_session_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!session) { fail(res, 404, 'NOT_FOUND', 'Session not found'); return; }
  if (session.signed_at) { fail(res, 422, 'ALREADY_SIGNED', 'Session has already been signed'); return; }

  // Must have at least one competency assessment before signing
  const { count: asmCount } = db.prepare('SELECT COUNT(*) AS count FROM competency_assessment WHERE session_record_id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as { count: number };
  if (asmCount === 0) { fail(res, 422, 'NO_ASSESSMENTS', 'At least one competency assessment is required before signing'); return; }

  const parsed = signSessionZ.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const now      = new Date().toISOString();
  const lockedAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  // Compute a canonical signature hash = SHA256(sessionId + signatureHash + signedAt)
  const canonicalHash = createHash('sha256')
    .update(`${req.params.id}:${parsed.data.signatureHash}:${now}`)
    .digest('hex');

  db.prepare(`
    UPDATE training_session_record
    SET instructor_signature_hash = ?, signed_at = ?, locked_at = ?, updated_at = ?
    WHERE id = ?
  `).run(canonicalHash, now, lockedAt, now, req.params.id);

  const updated = db.prepare('SELECT * FROM training_session_record WHERE id = ?').get(req.params.id) as Record<string, unknown>;
  emitEvent('training.session.signed', tenantId, { sessionRecordId: req.params.id, signedBy: userId, signedAt: now, outcome: session.outcome });
  writeAudit(userId, tenantId, 'SIGN', 'training_session_record', req.params.id, session, updated);
  ok(res, deserializeSession(updated));
});

// Amend a locked session (CFI/TRE only)
app.patch('/api/v1/sessions/:id', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const session = db.prepare('SELECT * FROM training_session_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!session) { fail(res, 404, 'NOT_FOUND', 'Session not found'); return; }

  if (isLocked(session)) {
    const parsed = amendSessionZ.safeParse(req.body);
    if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

    const { outcome, amendmentReason } = parsed.data;
    const now = new Date().toISOString();

    const setClauses = ['amendment_reason = ?', 'updated_at = ?'];
    const values: (string | null)[] = [amendmentReason, now];
    if (outcome) { setClauses.push('outcome = ?'); values.push(outcome); }

    db.prepare(`UPDATE training_session_record SET ${setClauses.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    const updated = db.prepare('SELECT * FROM training_session_record WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    emitEvent('training.session.amended', tenantId, { sessionRecordId: req.params.id, amendedBy: userId, reason: amendmentReason });
    writeAudit(userId, tenantId, 'AMEND_LOCKED', 'training_session_record', req.params.id, session, updated, amendmentReason);
    ok(res, deserializeSession(updated));
  } else {
    // Pre-sign edit — just update outcome
    if (!req.body.outcome) { fail(res, 400, 'VALIDATION_ERROR', 'outcome is required'); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE training_session_record SET outcome = ?, updated_at = ? WHERE id = ?').run(req.body.outcome as string, now, req.params.id);
    const updated = db.prepare('SELECT * FROM training_session_record WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    ok(res, deserializeSession(updated));
  }
});

// ─── Pilot-scoped sessions ────────────────────────────────────────────────────

app.get('/api/v1/pilots/:pilotId/sessions', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  // Pilots can only view their own
  if (role === 'PILOT' && req.params.pilotId !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You can only view your own session records'); return;
  }

  const q = req.query as Record<string, string>;
  const { limit, offset, page } = parsePage(q);

  const { count } = db.prepare(
    'SELECT COUNT(*) AS count FROM training_session_record WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL',
  ).get(tenantId, req.params.pilotId) as { count: number };

  const rows = db.prepare(
    'SELECT * FROM training_session_record WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL ORDER BY assessed_at DESC LIMIT ? OFFSET ?',
  ).all(tenantId, req.params.pilotId, limit, offset) as Record<string, unknown>[];

  ok(res, rows.map(deserializeSession), 200, { page, pageSize: limit, total: count });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[training-programmes]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[training-programmes] ✓  http://localhost:${PORT}`));
