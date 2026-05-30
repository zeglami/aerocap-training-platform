import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase } from './db';
import { authenticate, requireRole } from './middleware/auth';
import {
  instructorCreateZ,
  instructorUpdateZ,
  qualificationCreateZ,
  qualificationUpdateZ,
  revokeZ,
  examinerAuthCreateZ,
  instructorTrainingRecordCreateZ,
  restrictionCreateZ,
  eligibilityCheckZ,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3006', 10);

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

type RawQualification = {
  id: string;
  tenant_id: string;
  instructor_record_id: string;
  qualification_type: string;
  aircraft_type: string;
  regulatory_framework: string;
  authority_reference_number: string;
  issued_at: string;
  valid_from: string;
  valid_until: string;
  issuing_authority: string;
  restrictions: string;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RawExaminerAuth = {
  id: string;
  tenant_id: string;
  instructor_record_id: string;
  authorisation_type: string;
  aircraft_type: string;
  valid_from: string;
  valid_until: string;
  authority_reference_number: string;
  conducted_tests_count: number;
  restrictions: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RawRestriction = {
  id: string;
  tenant_id: string;
  instructor_record_id: string;
  restriction_type: string;
  parameters: string;
  valid_until: string | null;
  imposed_by: string;
  reason: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Compute qualification status dynamically on read.
 * REVOKED always wins; then EXPIRED; then EXPIRING (within 60 days); else VALID.
 */
function computeQualStatus(raw: RawQualification): string {
  if (raw.status === 'REVOKED') return 'REVOKED';
  const today = new Date();
  const validUntil = new Date(raw.valid_until);
  if (validUntil < today) return 'EXPIRED';
  const in60 = new Date(today);
  in60.setDate(in60.getDate() + 60);
  if (validUntil <= in60) return 'EXPIRING';
  return 'VALID';
}

function serializeQual(raw: RawQualification): object {
  return {
    ...raw,
    restrictions: JSON.parse(raw.restrictions) as string[],
    status: computeQualStatus(raw),
  };
}

function serializeExaminerAuth(raw: RawExaminerAuth): object {
  return {
    ...raw,
    restrictions: JSON.parse(raw.restrictions) as string[],
  };
}

function serializeRestriction(raw: RawRestriction): object {
  return {
    ...raw,
    parameters: JSON.parse(raw.parameters) as Record<string, unknown>,
  };
}

/** Maps session type to the qualification types that satisfy eligibility. */
const SESSION_TO_QUAL_TYPES: Record<string, string[]> = {
  OPC:          ['TRE', 'EXAMINER_ME', 'EXAMINER_SE'],
  LPC:          ['TRE'],
  RECURRENT:    ['TRI', 'SFI', 'FI'],
  LIFUS:        ['TRI'],
  TYPE_RATING:  ['TRI', 'TRE'],
  UPRT:         ['TRI'],
  EBT:          ['TRI'],
};

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'instructor-records' }));

// ─── Instructors ──────────────────────────────────────────────────────────────

/** GET /api/v1/instructors — paginated list */
app.get('/api/v1/instructors', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;
  const status   = req.query.status as string | undefined;
  const role     = req.query.primaryRole as string | undefined;

  const conditions: string[] = ['tenant_id = ?', 'deleted_at IS NULL'];
  const params: (string | number)[] = [tenantId];

  if (status) { conditions.push('status = ?'); params.push(status); }
  if (role)   { conditions.push('primary_role = ?'); params.push(role); }

  const where = conditions.join(' AND ');
  const rows  = db.prepare(
    `SELECT * FROM instructor_record WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset) as object[];

  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM instructor_record WHERE ${where}`
  ).get(...params) as { total: number };

  ok(res, rows, 200, { page, pageSize, total });
});

/** POST /api/v1/instructors — create (CFI or GLOBAL_ADMIN only) */
app.post('/api/v1/instructors', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const parsed = instructorCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { userId, employeeNumber, primaryRole, hireDate } = parsed.data;
  const { tenantId } = req.user!;
  const id  = randomUUID();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO instructor_record (id, tenant_id, user_id, employee_number, primary_role, hire_date, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, tenantId, userId, employeeNumber, primaryRole, hireDate, now, now);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      fail(res, 409, 'CONFLICT', 'An instructor record with this user_id or employee_number already exists for this tenant');
      return;
    }
    throw e;
  }

  const record = db.prepare('SELECT * FROM instructor_record WHERE id = ?').get(id) as object;
  ok(res, record, 201);
});

/** GET /api/v1/instructors/:id */
app.get('/api/v1/instructors/:id', authenticate, (req: Request, res: Response) => {
  const record = db.prepare(
    'SELECT * FROM instructor_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, req.user!.tenantId) as object | undefined;

  if (!record) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }
  ok(res, record);
});

/** PATCH /api/v1/instructors/:id */
app.patch('/api/v1/instructors/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const existing = db.prepare(
    'SELECT * FROM instructor_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as object | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const parsed = instructorUpdateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (parsed.data.primaryRole !== undefined) { updates.push('primary_role = ?'); values.push(parsed.data.primaryRole); }
  if (parsed.data.status !== undefined)      { updates.push('status = ?');       values.push(parsed.data.status); }

  if (updates.length === 0) { fail(res, 400, 'NO_FIELDS', 'No updatable fields provided'); return; }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id);

  db.prepare(`UPDATE instructor_record SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const record = db.prepare('SELECT * FROM instructor_record WHERE id = ?').get(req.params.id) as object;
  ok(res, record);
});

// ─── Qualifications ───────────────────────────────────────────────────────────

function getInstructor(id: string, tenantId: string): object | undefined {
  return db.prepare(
    'SELECT * FROM instructor_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(id, tenantId) as object | undefined;
}

/** GET /api/v1/instructors/:id/qualifications */
app.get('/api/v1/instructors/:id/qualifications', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM instructor_qualification WHERE instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).all(req.params.id, tenantId) as RawQualification[];

  ok(res, rows.map(serializeQual));
});

/** POST /api/v1/instructors/:id/qualifications */
app.post('/api/v1/instructors/:id/qualifications', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const parsed = qualificationCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const {
    qualificationType, aircraftType, regulatoryFramework, authorityReferenceNumber,
    issuedAt, validFrom, validUntil, issuingAuthority, restrictions,
  } = parsed.data;

  const id  = randomUUID();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO instructor_qualification
        (id, tenant_id, instructor_record_id, qualification_type, aircraft_type,
         regulatory_framework, authority_reference_number, issued_at, valid_from, valid_until,
         issuing_authority, restrictions, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, tenantId, req.params.id, qualificationType, aircraftType,
      regulatoryFramework, authorityReferenceNumber, issuedAt, validFrom, validUntil,
      issuingAuthority, JSON.stringify(restrictions), 'VALID', now, now,
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      fail(res, 409, 'CONFLICT', 'A qualification with this authority reference number already exists for this tenant');
      return;
    }
    throw e;
  }

  const row = db.prepare('SELECT * FROM instructor_qualification WHERE id = ?').get(id) as RawQualification;
  ok(res, serializeQual(row), 201);
});

/** GET /api/v1/instructors/:id/qualifications/:qid */
app.get('/api/v1/instructors/:id/qualifications/:qid', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const row = db.prepare(
    'SELECT * FROM instructor_qualification WHERE id = ? AND instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.qid, req.params.id, tenantId) as RawQualification | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Qualification not found'); return; }
  ok(res, serializeQual(row));
});

/** PATCH /api/v1/instructors/:id/qualifications/:qid — update validUntil and/or restrictions only */
app.patch('/api/v1/instructors/:id/qualifications/:qid', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const existing = db.prepare(
    'SELECT * FROM instructor_qualification WHERE id = ? AND instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.qid, req.params.id, tenantId) as RawQualification | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Qualification not found'); return; }
  if (existing.status === 'REVOKED') { fail(res, 409, 'ALREADY_REVOKED', 'Cannot update a revoked qualification'); return; }

  const parsed = qualificationUpdateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (parsed.data.validUntil !== undefined)   { updates.push('valid_until = ?');   values.push(parsed.data.validUntil); }
  if (parsed.data.restrictions !== undefined) { updates.push('restrictions = ?');   values.push(JSON.stringify(parsed.data.restrictions)); }

  if (updates.length === 0) { fail(res, 400, 'NO_FIELDS', 'No updatable fields provided'); return; }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.qid);

  db.prepare(`UPDATE instructor_qualification SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const row = db.prepare('SELECT * FROM instructor_qualification WHERE id = ?').get(req.params.qid) as RawQualification;
  ok(res, serializeQual(row));
});

/** POST /api/v1/instructors/:id/qualifications/:qid/revoke — R-B-5 */
app.post('/api/v1/instructors/:id/qualifications/:qid/revoke', authenticate, requireRole('CFI', 'GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const existing = db.prepare(
    'SELECT * FROM instructor_qualification WHERE id = ? AND instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.qid, req.params.id, tenantId) as RawQualification | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Qualification not found'); return; }
  if (existing.status === 'REVOKED') { fail(res, 409, 'ALREADY_REVOKED', 'Qualification is already revoked'); return; }

  const parsed = revokeZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE instructor_qualification
    SET status = 'REVOKED', revoked_at = ?, revoked_by = ?, revocation_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(now, userId, parsed.data.reason, now, req.params.qid);

  const row = db.prepare('SELECT * FROM instructor_qualification WHERE id = ?').get(req.params.qid) as RawQualification;
  ok(res, serializeQual(row));
});

// ─── Examiner Authorisations ──────────────────────────────────────────────────

/** GET /api/v1/instructors/:id/examiner-authorisations */
app.get('/api/v1/instructors/:id/examiner-authorisations', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM examiner_authorisation WHERE instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).all(req.params.id, tenantId) as RawExaminerAuth[];

  ok(res, rows.map(serializeExaminerAuth));
});

/** POST /api/v1/instructors/:id/examiner-authorisations */
app.post('/api/v1/instructors/:id/examiner-authorisations', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const parsed = examinerAuthCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { authorisationType, aircraftType, validFrom, validUntil, authorityReferenceNumber, restrictions } = parsed.data;
  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO examiner_authorisation
      (id, tenant_id, instructor_record_id, authorisation_type, aircraft_type,
       valid_from, valid_until, authority_reference_number, conducted_tests_count, restrictions, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, req.params.id, authorisationType, aircraftType, validFrom, validUntil, authorityReferenceNumber, 0, JSON.stringify(restrictions), now, now);

  const row = db.prepare('SELECT * FROM examiner_authorisation WHERE id = ?').get(id) as RawExaminerAuth;
  ok(res, serializeExaminerAuth(row), 201);
});

// ─── Training Records ─────────────────────────────────────────────────────────

/** GET /api/v1/instructors/:id/training-records */
app.get('/api/v1/instructors/:id/training-records', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM instructor_training_record WHERE instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY event_date DESC'
  ).all(req.params.id, tenantId) as object[];

  ok(res, rows);
});

/** POST /api/v1/instructors/:id/training-records */
app.post('/api/v1/instructors/:id/training-records', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const parsed = instructorTrainingRecordCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const {
    eventType, eventDate, validUntil, conductedByExaminerId,
    simulatorId, simulatorQualificationLevel, outcome, documentRef,
  } = parsed.data;

  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO instructor_training_record
      (id, tenant_id, instructor_record_id, event_type, event_date, valid_until,
       conducted_by_examiner_id, simulator_id, simulator_qualification_level, outcome, document_ref, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, req.params.id, eventType, eventDate, validUntil,
    conductedByExaminerId, simulatorId, simulatorQualificationLevel, outcome,
    documentRef ?? null, now, now,
  );

  const row = db.prepare('SELECT * FROM instructor_training_record WHERE id = ?').get(id) as object;
  ok(res, row, 201);
});

// ─── Assignment Restrictions ──────────────────────────────────────────────────

/** GET /api/v1/instructors/:id/restrictions */
app.get('/api/v1/instructors/:id/restrictions', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM instructor_assignment_restriction WHERE instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).all(req.params.id, tenantId) as RawRestriction[];

  ok(res, rows.map(serializeRestriction));
});

/** POST /api/v1/instructors/:id/restrictions */
app.post('/api/v1/instructors/:id/restrictions', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const parsed = restrictionCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { restrictionType, parameters, validUntil, reason } = parsed.data;
  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO instructor_assignment_restriction
      (id, tenant_id, instructor_record_id, restriction_type, parameters, valid_until, imposed_by, reason, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, req.params.id, restrictionType,
    JSON.stringify(parameters),
    validUntil ?? null,
    userId,
    reason, now, now,
  );

  const row = db.prepare('SELECT * FROM instructor_assignment_restriction WHERE id = ?').get(id) as RawRestriction;
  ok(res, serializeRestriction(row), 201);
});

/** DELETE /api/v1/instructors/:id/restrictions/:rid — soft delete */
app.delete('/api/v1/instructors/:id/restrictions/:rid', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  if (!getInstructor(req.params.id, tenantId)) { fail(res, 404, 'NOT_FOUND', 'Instructor record not found'); return; }

  const existing = db.prepare(
    'SELECT * FROM instructor_assignment_restriction WHERE id = ? AND instructor_record_id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.rid, req.params.id, tenantId) as object | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Restriction not found'); return; }

  db.prepare(
    "UPDATE instructor_assignment_restriction SET deleted_at = ?, updated_at = ? WHERE id = ?"
  ).run(new Date().toISOString(), new Date().toISOString(), req.params.rid);

  res.status(204).end();
});

// ─── Eligibility Check ────────────────────────────────────────────────────────

/**
 * POST /api/v1/instructors/eligibility-check
 *
 * Determines whether the instructor holds a valid (non-revoked, non-expired)
 * qualification that satisfies the requested session type and aircraft type.
 */
app.post('/api/v1/instructors/eligibility-check', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const parsed = eligibilityCheckZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { instructorId, sessionType, aircraftType, sessionStartAt } = parsed.data;

  // Resolve by user_id if it's not a UUID, otherwise try record id
  const instrRecord = db.prepare(
    'SELECT * FROM instructor_record WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(instructorId, tenantId) as Record<string, string> | undefined;

  if (!instrRecord) {
    ok(res, {
      eligible: false,
      matchedQualificationId: null,
      matchedAuthorisationId: null,
      reasons: ['Instructor record not found for this tenant'],
    });
    return;
  }

  if (instrRecord.status !== 'ACTIVE') {
    ok(res, {
      eligible: false,
      matchedQualificationId: null,
      matchedAuthorisationId: null,
      reasons: [`Instructor is not ACTIVE (current status: ${instrRecord.status})`],
    });
    return;
  }

  const allowedQualTypes = SESSION_TO_QUAL_TYPES[sessionType] ?? [];
  const sessionDate = sessionStartAt.substring(0, 10); // YYYY-MM-DD for date comparison

  // Find a valid qualification matching aircraft type and one of the allowed qual types
  const qualRows = db.prepare(`
    SELECT * FROM instructor_qualification
    WHERE instructor_record_id = ?
      AND tenant_id = ?
      AND aircraft_type = ?
      AND deleted_at IS NULL
      AND status != 'REVOKED'
      AND valid_until >= ?
    ORDER BY valid_until DESC
  `).all(instrRecord.id, tenantId, aircraftType, sessionDate) as RawQualification[];

  // Filter by allowed qual types (dynamically computed status must also be valid)
  const matchedQual = qualRows.find(q => {
    const computedStatus = computeQualStatus(q);
    return allowedQualTypes.includes(q.qualification_type) && computedStatus !== 'EXPIRED' && computedStatus !== 'REVOKED';
  });

  const reasons: string[] = [];

  if (!matchedQual) {
    const qualTypes = allowedQualTypes.join(', ');
    reasons.push(
      `No valid qualification found for aircraft type '${aircraftType}' and session type '${sessionType}' ` +
      `(requires one of: ${qualTypes})`,
    );
  }

  // For examiner session types also check examiner authorisations
  let matchedAuth: RawExaminerAuth | undefined;

  if (sessionType === 'OPC' || sessionType === 'LPC') {
    // Map session type to examiner authorisation type
    const authType = sessionType; // OPC → OPC, LPC → LPC
    const authRows = db.prepare(`
      SELECT * FROM examiner_authorisation
      WHERE instructor_record_id = ?
        AND tenant_id = ?
        AND aircraft_type = ?
        AND authorisation_type = ?
        AND deleted_at IS NULL
        AND valid_until >= ?
      ORDER BY valid_until DESC
    `).all(instrRecord.id, tenantId, aircraftType, authType, sessionDate) as RawExaminerAuth[];

    matchedAuth = authRows[0];

    if (!matchedAuth) {
      reasons.push(
        `No valid examiner authorisation of type '${authType}' found for aircraft type '${aircraftType}'`,
      );
    }
  }

  const eligible = matchedQual !== undefined &&
    (sessionType !== 'OPC' && sessionType !== 'LPC' ? true : matchedAuth !== undefined);

  ok(res, {
    eligible,
    matchedQualificationId:  matchedQual?.id ?? null,
    matchedAuthorisationId:  matchedAuth?.id ?? null,
    reasons,
  });
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[instructor-records]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[instructor-records] ✓  http://localhost:${PORT}`));
