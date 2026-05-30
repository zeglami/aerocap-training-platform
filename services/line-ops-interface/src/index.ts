import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase, txn } from './db';
import { authenticate, requireRole, isCfiOrAbove, UserRole } from './middleware/auth';
import {
  ltaCreateZ,
  ltaUpdateZ,
  sectorCreateZ,
  sectorBulkCreateZ,
  sectorAssessmentUpsertZ,
  lineCheckReleaseCreateZ,
  SectorCreateInput,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3010', 10);
const db   = createDatabase();
const app  = express();

app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Response helpers ─────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, status = 200, extra: object = {}): void {
  res.status(status).json({
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...extra },
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

function validationFail(res: Response, err: { errors: Array<{ message: string }> }): void {
  fail(res, 400, 'VALIDATION_ERROR', err.errors.map(e => e.message).join('; '));
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function parsePage(query: Record<string, string>) {
  const page     = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize ?? '20', 10) || 20));
  const offset   = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

// ─── Sector insert helper (shared by single + bulk) ───────────────────────────

interface InsertSectorResult {
  id: string;
  status: 'created' | 'existing';
}

function insertSector(
  tenantId: string,
  input: SectorCreateInput,
): InsertSectorResult {
  const blockTimeMinutes  = Math.round(
    (new Date(input.blockInAt).getTime() - new Date(input.blockOutAt).getTime()) / 60000,
  );
  const flightTimeMinutes = Math.round(
    (new Date(input.landingAt).getTime() - new Date(input.takeoffAt).getTime()) / 60000,
  );
  const immutableAfter = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  // Check for existing row first (idempotency key = unique constraint columns)
  const existing = db.prepare(`
    SELECT id FROM sector_log
    WHERE tenant_id = ? AND pilot_id = ? AND flight_date = ?
      AND flight_number = ? AND departure_icao = ? AND arrival_icao = ?
      AND deleted_at IS NULL
  `).get(
    tenantId,
    input.pilotId,
    input.flightDate,
    input.flightNumber,
    input.departureIcao,
    input.arrivalIcao,
  ) as { id: string } | undefined;

  if (existing) {
    return { id: existing.id, status: 'existing' };
  }

  const id = randomUUID();

  db.prepare(`
    INSERT INTO sector_log (
      id, tenant_id, pilot_id, line_training_assignment_id,
      flight_date, flight_number, aircraft_registration, aircraft_type,
      departure_icao, arrival_icao,
      block_out_at, takeoff_at, landing_at, block_in_at,
      block_time_minutes, flight_time_minutes,
      pilot_flying_role, commander_id, instructor_id,
      landings_count, takeoffs_count,
      night_flight_minutes, ifr_time_minutes, pic_time_minutes, sic_time_minutes,
      source, immutable_after
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    tenantId,
    input.pilotId,
    input.lineTrainingAssignmentId ?? null,
    input.flightDate,
    input.flightNumber,
    input.aircraftRegistration,
    input.aircraftType,
    input.departureIcao,
    input.arrivalIcao,
    input.blockOutAt,
    input.takeoffAt,
    input.landingAt,
    input.blockInAt,
    blockTimeMinutes,
    flightTimeMinutes,
    input.pilotFlyingRole,
    input.commanderId,
    input.instructorId ?? null,
    input.landingsCount,
    input.takeoffsCount,
    input.nightFlightMinutes,
    input.ifrTimeMinutes,
    input.picTimeMinutes,
    input.sicTimeMinutes,
    input.source,
    immutableAfter,
  );

  // Auto-create recency_event rows inside the same transaction context
  const insRecency = db.prepare(`
    INSERT INTO recency_event (id, tenant_id, pilot_id, event_type, event_at, sector_log_id)
    VALUES (?,?,?,?,?,?)
  `);

  for (let i = 0; i < input.landingsCount; i++) {
    insRecency.run(randomUUID(), tenantId, input.pilotId, 'LANDING', input.landingAt, id);
  }
  for (let i = 0; i < input.takeoffsCount; i++) {
    insRecency.run(randomUUID(), tenantId, input.pilotId, 'TAKEOFF', input.takeoffAt, id);
  }

  return { id, status: 'created' };
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'line-ops-interface', port: PORT });
});

// ─── Line Training Assignments ────────────────────────────────────────────────

// GET /api/v1/line-training-assignments — paginated list (?pilotId, ?status)
app.get('/api/v1/line-training-assignments', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { pilotId, status } = req.query as Record<string, string>;
  const { page, pageSize, offset } = parsePage(req.query as Record<string, string>);

  let where = 'WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (pilotId) { where += ' AND pilot_id = ?';  params.push(pilotId); }
  if (status)  { where += ' AND status = ?';     params.push(status); }

  const rows = db.prepare(
    `SELECT * FROM line_training_assignment ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as object[];

  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM line_training_assignment ${where}`,
  ).get(...params) as { count: number };

  ok(res, rows, 200, { page, pageSize, total: count });
});

// POST /api/v1/line-training-assignments — create (CFI/INSTRUCTOR only)
app.post(
  '/api/v1/line-training-assignments',
  authenticate,
  requireRole('GLOBAL_ADMIN', 'CFI', 'INSTRUCTOR'),
  (req: Request, res: Response) => {
    const parsed = ltaCreateZ.safeParse(req.body);
    if (!parsed.success) { validationFail(res, parsed.error); return; }

    const { tenantId } = req.user!;
    const { pilotId, programmeEnrolmentId, lineTrainingCaptainId, startDate, plannedSectors } = parsed.data;

    const id = randomUUID();
    db.prepare(`
      INSERT INTO line_training_assignment
        (id, tenant_id, pilot_id, programme_enrolment_id, line_training_captain_id,
         start_date, planned_sectors, status)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, tenantId, pilotId, programmeEnrolmentId, lineTrainingCaptainId, startDate, plannedSectors, 'PLANNED');

    const row = db.prepare('SELECT * FROM line_training_assignment WHERE id = ?').get(id) as object;
    ok(res, row, 201);
  },
);

// GET /api/v1/line-training-assignments/:id
app.get('/api/v1/line-training-assignments/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM line_training_assignment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, req.user!.tenantId) as object | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Line training assignment not found'); return; }
  ok(res, row);
});

// PATCH /api/v1/line-training-assignments/:id — update status/completedSectors
app.patch(
  '/api/v1/line-training-assignments/:id',
  authenticate,
  requireRole('GLOBAL_ADMIN', 'CFI', 'INSTRUCTOR'),
  (req: Request, res: Response) => {
    const parsed = ltaUpdateZ.safeParse(req.body);
    if (!parsed.success) { validationFail(res, parsed.error); return; }

    const { tenantId } = req.user!;
    const existing = db.prepare(
      'SELECT * FROM line_training_assignment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

    if (!existing) { fail(res, 404, 'NOT_FOUND', 'Line training assignment not found'); return; }

    const { status, completedSectors } = parsed.data;
    const newStatus           = status           ?? (existing.status           as string);
    const newCompletedSectors = completedSectors ?? (existing.completed_sectors as number);

    db.prepare(`
      UPDATE line_training_assignment
      SET status = ?, completed_sectors = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(newStatus, newCompletedSectors, new Date().toISOString(), req.params.id, tenantId);

    const row = db.prepare('SELECT * FROM line_training_assignment WHERE id = ?').get(req.params.id) as object;
    ok(res, row);
  },
);

// POST /api/v1/line-training-assignments/:id/terminate
app.post(
  '/api/v1/line-training-assignments/:id/terminate',
  authenticate,
  requireRole('GLOBAL_ADMIN', 'CFI', 'INSTRUCTOR'),
  (req: Request, res: Response) => {
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      fail(res, 400, 'VALIDATION_ERROR', 'reason is required for termination');
      return;
    }

    const { tenantId } = req.user!;
    const existing = db.prepare(
      'SELECT * FROM line_training_assignment WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

    if (!existing) { fail(res, 404, 'NOT_FOUND', 'Line training assignment not found'); return; }
    if (existing.status === 'TERMINATED') {
      fail(res, 409, 'ALREADY_TERMINATED', 'Assignment is already terminated');
      return;
    }

    db.prepare(`
      UPDATE line_training_assignment
      SET status = 'TERMINATED', termination_reason = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run(reason.trim(), new Date().toISOString(), req.params.id, tenantId);

    const row = db.prepare('SELECT * FROM line_training_assignment WHERE id = ?').get(req.params.id) as object;
    ok(res, row);
  },
);

// ─── Sectors ──────────────────────────────────────────────────────────────────

// GET /api/v1/sectors — paginated list
app.get('/api/v1/sectors', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const { pilotId, flightDate } = req.query as Record<string, string>;
  const { page, pageSize, offset } = parsePage(req.query as Record<string, string>);

  let where = 'WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  // PILOT role may only see own sectors
  if (role === 'PILOT') {
    where += ' AND pilot_id = ?';
    params.push(userId);
  } else if (pilotId) {
    where += ' AND pilot_id = ?';
    params.push(pilotId);
  }

  if (flightDate) { where += ' AND flight_date = ?'; params.push(flightDate); }

  const rows = db.prepare(
    `SELECT * FROM sector_log ${where} ORDER BY flight_date DESC, block_out_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as object[];

  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM sector_log ${where}`,
  ).get(...params) as { count: number };

  ok(res, rows, 200, { page, pageSize, total: count });
});

// POST /api/v1/sectors — create sector
app.post('/api/v1/sectors', authenticate, (req: Request, res: Response) => {
  const parsed = sectorCreateZ.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId } = req.user!;
  let result: InsertSectorResult;

  txn(db, () => {
    result = insertSector(tenantId, parsed.data);
  });

  const row = db.prepare(
    'SELECT * FROM sector_log WHERE id = ?',
  ).get(result!.id) as object;

  ok(res, row, result!.status === 'created' ? 201 : 200);
});

// POST /api/v1/sectors/bulk — R-F-8: idempotent bulk create
app.post('/api/v1/sectors/bulk', authenticate, (req: Request, res: Response) => {
  const parsed = sectorBulkCreateZ.safeParse(req.body);
  if (!parsed.success) { validationFail(res, parsed.error); return; }

  const { tenantId } = req.user!;
  const results: Array<{ id: string; status: 'created' | 'existing' }> = [];
  let inserted = 0;
  let skipped  = 0;

  txn(db, () => {
    for (const sector of parsed.data.sectors) {
      const r = insertSector(tenantId, sector);
      results.push(r);
      if (r.status === 'created') { inserted++; } else { skipped++; }
    }
  });

  ok(res, { inserted, skipped, results }, 207);
});

// GET /api/v1/sectors/:id
app.get('/api/v1/sectors/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  let row = db.prepare(
    'SELECT * FROM sector_log WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Sector not found'); return; }

  // PILOT can only fetch their own sectors
  if (role === 'PILOT' && row.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'Access denied');
    return;
  }

  ok(res, row);
});

// PATCH /api/v1/sectors/:id — R-F-1: immutability guard
app.patch('/api/v1/sectors/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, role } = req.user!;

  const existing = db.prepare(
    'SELECT * FROM sector_log WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Sector not found'); return; }

  const isImmutable = new Date() > new Date(existing.immutable_after as string);
  const elevated    = isCfiOrAbove(role as UserRole);

  if (isImmutable && !elevated) {
    fail(res, 410, 'IMMUTABLE', 'Sector is past the 48-hour edit window');
    return;
  }

  if (isImmutable && elevated) {
    const { overrideReason } = req.body as { overrideReason?: string };
    if (!overrideReason || overrideReason.trim().length < 30) {
      fail(res, 400, 'OVERRIDE_REASON_REQUIRED', 'overrideReason must be at least 30 characters for CFI edits past the immutable window');
      return;
    }
  }

  // Build dynamic UPDATE from allowed mutable fields
  const MUTABLE: Array<[string, string]> = [
    ['flightDate',           'flight_date'],
    ['flightNumber',         'flight_number'],
    ['aircraftRegistration', 'aircraft_registration'],
    ['aircraftType',         'aircraft_type'],
    ['pilotFlyingRole',      'pilot_flying_role'],
    ['instructorId',         'instructor_id'],
    ['nightFlightMinutes',   'night_flight_minutes'],
    ['ifrTimeMinutes',       'ifr_time_minutes'],
    ['picTimeMinutes',       'pic_time_minutes'],
    ['sicTimeMinutes',       'sic_time_minutes'],
    ['source',               'source'],
  ];

  const setClauses: string[]             = [];
  const values: (string | number | null)[] = [];
  const body = req.body as Record<string, unknown>;

  for (const [camel, snake] of MUTABLE) {
    if (camel in body && body[camel] !== undefined) {
      setClauses.push(`${snake} = ?`);
      values.push(body[camel] as string | number | null);
    }
  }

  if (setClauses.length === 0) {
    fail(res, 400, 'NO_FIELDS', 'No updatable fields provided');
    return;
  }

  setClauses.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id, tenantId);

  db.prepare(
    `UPDATE sector_log SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).run(...values);

  const row = db.prepare('SELECT * FROM sector_log WHERE id = ?').get(req.params.id) as object;
  ok(res, row);
});

// ─── Sector Assessments ───────────────────────────────────────────────────────

// GET /api/v1/sectors/:id/assessment
app.get('/api/v1/sectors/:id/assessment', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  // Confirm sector belongs to tenant
  const sector = db.prepare(
    'SELECT id FROM sector_log WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as { id: string } | undefined;
  if (!sector) { fail(res, 404, 'NOT_FOUND', 'Sector not found'); return; }

  const row = db.prepare(
    'SELECT * FROM sector_assessment WHERE sector_log_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'No assessment found for this sector'); return; }

  // Parse competency_scores JSON string → object
  const result = {
    ...row,
    competency_scores: JSON.parse(row.competency_scores as string) as Record<string, number>,
  };
  ok(res, result);
});

// PUT /api/v1/sectors/:id/assessment — R-F-2: upsert
app.put(
  '/api/v1/sectors/:id/assessment',
  authenticate,
  requireRole('GLOBAL_ADMIN', 'CFI', 'INSTRUCTOR', 'TRE'),
  (req: Request, res: Response) => {
    const parsed = sectorAssessmentUpsertZ.safeParse(req.body);
    if (!parsed.success) { validationFail(res, parsed.error); return; }

    const { tenantId, id: instructorId, role } = req.user!;

    const sector = db.prepare(
      'SELECT * FROM sector_log WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
    if (!sector) { fail(res, 404, 'NOT_FOUND', 'Sector not found'); return; }

    const existing = db.prepare(
      'SELECT * FROM sector_assessment WHERE sector_log_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;

    // Immutability check for existing assessment
    if (existing) {
      const isImmutable = new Date() > new Date(existing.immutable_after as string);
      const elevated    = isCfiOrAbove(role as UserRole);
      if (isImmutable && !elevated) {
        fail(res, 410, 'IMMUTABLE', 'Assessment is past the 48-hour edit window');
        return;
      }
    }

    const {
      debriefAt, overallOutcome, competencyScores, narrative,
      instructorQualification, sessionType, assessedAt,
    } = parsed.data;

    const competencyScoresJson = JSON.stringify(competencyScores);
    const newImmutableAfter    = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const now                  = new Date().toISOString();

    let assessmentId: string;

    if (existing) {
      assessmentId = existing.id as string;
      db.prepare(`
        UPDATE sector_assessment
        SET debrief_at = ?, overall_outcome = ?, competency_scores = ?, narrative = ?,
            instructor_qualification = ?, session_type = ?, assessed_at = ?,
            immutable_after = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(
        debriefAt, overallOutcome, competencyScoresJson, narrative,
        instructorQualification, sessionType, assessedAt,
        newImmutableAfter, now,
        assessmentId, tenantId,
      );
    } else {
      assessmentId = randomUUID();
      db.prepare(`
        INSERT INTO sector_assessment
          (id, tenant_id, sector_log_id, instructor_id, debrief_at, overall_outcome,
           competency_scores, narrative, instructor_qualification, session_type,
           assessed_at, immutable_after)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        assessmentId, tenantId, req.params.id, instructorId,
        debriefAt, overallOutcome, competencyScoresJson, narrative,
        instructorQualification, sessionType, assessedAt, newImmutableAfter,
      );
    }

    // R-F-2: if UNSATISFACTORY, do NOT count this sector toward completed_sectors.
    // If SATISFACTORY or RECOMMENDED_FOR_RELEASE and sector has an LTA, increment.
    if (
      sector.line_training_assignment_id &&
      overallOutcome !== 'UNSATISFACTORY'
    ) {
      // Only increment if this is a new assessment (not an edit that already counted)
      if (!existing) {
        db.prepare(`
          UPDATE line_training_assignment
          SET completed_sectors = completed_sectors + 1, updated_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now, sector.line_training_assignment_id as string, tenantId);
      }
    }

    const row = db.prepare('SELECT * FROM sector_assessment WHERE id = ?').get(assessmentId) as Record<string, unknown>;
    const result = {
      ...row,
      competency_scores: JSON.parse(row.competency_scores as string) as Record<string, number>,
    };

    ok(res, result, existing ? 200 : 201);
  },
);

// ─── Pilot recency (FCL.060) ──────────────────────────────────────────────────

// GET /api/v1/pilots/:pilotId/recency — R-F-5
app.get('/api/v1/pilots/:pilotId/recency', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const { pilotId } = req.params;

  // PILOT can only check their own recency
  if (role === 'PILOT' && pilotId !== userId) {
    fail(res, 403, 'FORBIDDEN', 'Pilots may only view their own recency');
    return;
  }

  const cutoff90 = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const cutoff75 = new Date(Date.now() - 75 * 24 * 3600 * 1000).toISOString();

  type CountRow = { cnt: number };

  const count = (eventType: string, since: string): number => {
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt FROM recency_event
      WHERE tenant_id = ? AND pilot_id = ? AND event_type = ?
        AND event_at >= ? AND deleted_at IS NULL
    `).get(tenantId, pilotId, eventType, since) as CountRow;
    return row.cnt;
  };

  const landings90d      = count('LANDING',      cutoff90);
  const takeoffs90d      = count('TAKEOFF',       cutoff90);
  const nightLandings90d = count('NIGHT_LANDING', cutoff90);
  const ifrApproaches90d = count('IFR_APPROACH',  cutoff90);

  // Find the most recent LANDING event_at
  const lastLandingRow = db.prepare(`
    SELECT event_at FROM recency_event
    WHERE tenant_id = ? AND pilot_id = ? AND event_type = 'LANDING' AND deleted_at IS NULL
    ORDER BY event_at DESC LIMIT 1
  `).get(tenantId, pilotId) as { event_at: string } | undefined;

  const lastLandingAt = lastLandingRow?.event_at ?? null;
  const meetsFcl060   = landings90d >= 3;

  // warning75d: true if last landing was more than 75 days ago (or never)
  let warning75d = false;
  if (!lastLandingAt) {
    warning75d = true;
  } else {
    warning75d = lastLandingAt < cutoff75;
  }

  ok(res, {
    pilotId,
    landings90d,
    takeoffs90d,
    nightLandings90d,
    ifrApproaches90d,
    lastLandingAt,
    meetsFcl060,
    warning75d,
  });
});

// ─── Pilot sector summary ─────────────────────────────────────────────────────

// GET /api/v1/pilots/:pilotId/sector-summary — aggregate totals
app.get('/api/v1/pilots/:pilotId/sector-summary', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const { pilotId } = req.params;
  const { dateFrom, dateTo } = req.query as Record<string, string>;

  if (role === 'PILOT' && pilotId !== userId) {
    fail(res, 403, 'FORBIDDEN', 'Pilots may only view their own sector summary');
    return;
  }

  let where = 'WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId, pilotId];

  if (dateFrom) { where += ' AND flight_date >= ?'; params.push(dateFrom); }
  if (dateTo)   { where += ' AND flight_date <= ?'; params.push(dateTo); }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_sectors,
      COALESCE(SUM(block_time_minutes),   0) AS total_block_time_minutes,
      COALESCE(SUM(flight_time_minutes),  0) AS total_flight_time_minutes,
      COALESCE(SUM(landings_count),       0) AS total_landings,
      COALESCE(SUM(takeoffs_count),       0) AS total_takeoffs,
      COALESCE(SUM(night_flight_minutes), 0) AS total_night_minutes,
      COALESCE(SUM(ifr_time_minutes),     0) AS total_ifr_minutes,
      COALESCE(SUM(pic_time_minutes),     0) AS total_pic_minutes,
      COALESCE(SUM(sic_time_minutes),     0) AS total_sic_minutes
    FROM sector_log ${where}
  `).get(...params) as {
    total_sectors:            number;
    total_block_time_minutes: number;
    total_flight_time_minutes: number;
    total_landings:           number;
    total_takeoffs:           number;
    total_night_minutes:      number;
    total_ifr_minutes:        number;
    total_pic_minutes:        number;
    total_sic_minutes:        number;
  };

  ok(res, {
    pilotId,
    totalSectors:           row.total_sectors,
    totalBlockTimeMinutes:  row.total_block_time_minutes,
    totalFlightTimeMinutes: row.total_flight_time_minutes,
    totalLandings:          row.total_landings,
    totalTakeoffs:          row.total_takeoffs,
    totalNightMinutes:      row.total_night_minutes,
    totalIfrMinutes:        row.total_ifr_minutes,
    totalPicMinutes:        row.total_pic_minutes,
    totalSicMinutes:        row.total_sic_minutes,
    dateFrom:               dateFrom ?? null,
    dateTo:                 dateTo   ?? null,
  });
});

// ─── Line Check Releases ──────────────────────────────────────────────────────

// GET /api/v1/line-check-releases — list (?pilotId)
app.get('/api/v1/line-check-releases', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { pilotId }  = req.query as Record<string, string>;

  let where = 'WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (pilotId) { where += ' AND pilot_id = ?'; params.push(pilotId); }

  const rows = db.prepare(
    `SELECT * FROM line_check_release ${where} ORDER BY released_at DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  // pic_requirement_met: INTEGER 0/1 → boolean
  const mapped = rows.map(r => ({
    ...r,
    pic_requirement_met: r.pic_requirement_met === 1,
  }));

  ok(res, mapped);
});

// POST /api/v1/line-check-releases — create (CFI only)
app.post(
  '/api/v1/line-check-releases',
  authenticate,
  requireRole('GLOBAL_ADMIN', 'CFI'),
  (req: Request, res: Response) => {
    const parsed = lineCheckReleaseCreateZ.safeParse(req.body);
    if (!parsed.success) { validationFail(res, parsed.error); return; }

    const { tenantId, id: releasedBy } = req.user!;
    const { pilotId, programmeEnrolmentId, releasedAt, narrative, documentRef } = parsed.data;

    // Check UNIQUE constraint (tenant_id, programme_enrolment_id)
    const dup = db.prepare(
      'SELECT id FROM line_check_release WHERE tenant_id = ? AND programme_enrolment_id = ? AND deleted_at IS NULL',
    ).get(tenantId, programmeEnrolmentId) as { id: string } | undefined;

    if (dup) {
      fail(res, 409, 'DUPLICATE_RELEASE', 'A line check release already exists for this programme enrolment');
      return;
    }

    // Compute sectors_accumulated: count SATISFACTORY or RECOMMENDED_FOR_RELEASE assessments
    // for the pilot's sectors linked to any LTA with this enrolment_id.
    const accRow = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM sector_assessment sa
      JOIN sector_log sl ON sl.id = sa.sector_log_id
      JOIN line_training_assignment lta ON lta.id = sl.line_training_assignment_id
      WHERE lta.tenant_id = ? AND lta.pilot_id = ? AND lta.programme_enrolment_id = ?
        AND sa.overall_outcome IN ('SATISFACTORY','RECOMMENDED_FOR_RELEASE')
        AND sa.deleted_at IS NULL
        AND sl.deleted_at IS NULL
    `).get(tenantId, pilotId, programmeEnrolmentId) as { cnt: number };

    const sectorsAccumulated = accRow.cnt;

    // pic_requirement_met: pilot accumulated at least 1 sector as PF
    const picRow = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM sector_log sl
      JOIN line_training_assignment lta ON lta.id = sl.line_training_assignment_id
      WHERE lta.tenant_id = ? AND lta.pilot_id = ? AND lta.programme_enrolment_id = ?
        AND sl.pilot_flying_role = 'PF' AND sl.deleted_at IS NULL
    `).get(tenantId, pilotId, programmeEnrolmentId) as { cnt: number };

    const picRequirementMet = picRow.cnt > 0 ? 1 : 0;

    const id = randomUUID();
    db.prepare(`
      INSERT INTO line_check_release
        (id, tenant_id, pilot_id, programme_enrolment_id, released_at, released_by,
         sectors_accumulated, pic_requirement_met, narrative, document_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, tenantId, pilotId, programmeEnrolmentId,
      releasedAt, releasedBy,
      sectorsAccumulated, picRequirementMet,
      narrative, documentRef ?? null,
    );

    const row = db.prepare('SELECT * FROM line_check_release WHERE id = ?').get(id) as Record<string, unknown>;
    ok(res, { ...row, pic_requirement_met: row.pic_requirement_met === 1 }, 201);
  },
);

// GET /api/v1/line-check-releases/:id
app.get('/api/v1/line-check-releases/:id', authenticate, (req: Request, res: Response) => {
  const row = db.prepare(
    'SELECT * FROM line_check_release WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, req.user!.tenantId) as Record<string, unknown> | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Line check release not found'); return; }

  ok(res, { ...row, pic_requirement_met: row.pic_requirement_met === 1 });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[line-ops-interface]', err);
  res.status(500).json({
    data: null,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});

app.listen(PORT, () => {
  console.log(`[line-ops-interface] listening on http://localhost:${PORT}`);
});
