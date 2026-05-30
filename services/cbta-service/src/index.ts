import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase } from './db';
import { authenticate, requireRole } from './middleware/auth';
import { CreateAssessmentSchema, BulkAssessmentSchema } from './schemas';

const PORT = parseInt(process.env.PORT ?? '3003', 10);

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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cbta-service' }));

// ─── Competency Units ─────────────────────────────────────────────────────────

app.get('/api/v1/competency-units', authenticate, (req: Request, res: Response) => {
  const units = db.prepare(
    'SELECT * FROM competency_units WHERE tenant_id = ? ORDER BY category, code'
  ).all(req.user!.tenantId) as object[];
  ok(res, units);
});

// ─── Assessments ─────────────────────────────────────────────────────────────

app.get('/api/v1/assessments', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const page   = parseInt(req.query.page as string)  || 1;
  const limit  = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  const pilotId = (role === 'PILOT') ? userId : (req.query.pilotId as string | undefined);

  let query = `
    SELECT a.*, cu.code, cu.name AS unit_name, cu.category
    FROM assessments a
    JOIN competency_units cu ON cu.id = a.competency_unit_id
    WHERE a.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (pilotId) { query += ' AND a.pilot_id = ?'; params.push(pilotId); }

  query += ' ORDER BY a.assessed_at DESC, a.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const assessments = db.prepare(query).all(...params) as object[];
  const countParams: string[] = pilotId ? [tenantId, pilotId] : [tenantId];
  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM assessments WHERE tenant_id = ?${pilotId ? ' AND pilot_id = ?' : ''}`
  ).get(...countParams) as { count: number };

  ok(res, assessments, 200, { page, limit, total: count });
});

app.post('/api/v1/assessments', authenticate, requireRole('INSTRUCTOR', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const parsed = CreateAssessmentSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { tenantId, id: instructorId } = req.user!;
  const { pilotId, competencyUnitId, score, markers, notes, assessedAt } = parsed.data;

  const unit = db.prepare(
    'SELECT id FROM competency_units WHERE id = ? AND tenant_id = ?'
  ).get(competencyUnitId, tenantId);

  if (!unit) { fail(res, 404, 'NOT_FOUND', 'Competency unit not found'); return; }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO assessments (id, tenant_id, pilot_id, instructor_id, competency_unit_id, score, markers, notes, assessed_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, tenantId, pilotId, instructorId, competencyUnitId, score, markers ? JSON.stringify(markers) : null, notes ?? null, assessedAt ?? new Date().toISOString());

  const assessment = db.prepare('SELECT a.*, cu.code, cu.name AS unit_name FROM assessments a JOIN competency_units cu ON cu.id = a.competency_unit_id WHERE a.id = ?').get(id) as object;
  ok(res, assessment, 201);
});

app.post('/api/v1/assessments/bulk', authenticate, requireRole('INSTRUCTOR', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const parsed = BulkAssessmentSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { tenantId, id: instructorId } = req.user!;
  const { pilotId, assessedAt, scores } = parsed.data;
  const date = assessedAt ?? new Date().toISOString();

  const ins = db.prepare(
    'INSERT INTO assessments (id, tenant_id, pilot_id, instructor_id, competency_unit_id, score, notes, assessed_at) VALUES (?,?,?,?,?,?,?,?)'
  );

  const ids: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of scores) {
      const id = randomUUID();
      ids.push(id);
      ins.run(id, tenantId, pilotId, instructorId, s.competencyUnitId, s.score, s.notes ?? null, date);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const created = db.prepare(
    `SELECT a.*, cu.code, cu.name AS unit_name FROM assessments a JOIN competency_units cu ON cu.id = a.competency_unit_id WHERE a.id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids) as object[];

  ok(res, created, 201);
});

// ─── Progress ─────────────────────────────────────────────────────────────────

app.get('/api/v1/progress/:pilotId', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: requesterId, role } = req.user!;
  const { pilotId } = req.params;

  if (role === 'PILOT' && requesterId !== pilotId) {
    fail(res, 403, 'FORBIDDEN', 'Pilots can only view their own progress');
    return;
  }

  // Latest score per competency unit
  const progress = db.prepare(`
    SELECT
      cu.id, cu.code, cu.name, cu.category,
      a.score AS latest_score,
      a.assessed_at AS last_assessed,
      COUNT(all_a.id) AS total_assessments,
      ROUND(AVG(all_a.score), 2) AS average_score
    FROM competency_units cu
    LEFT JOIN assessments a ON a.competency_unit_id = cu.id
      AND a.pilot_id = ? AND a.tenant_id = ?
      AND a.assessed_at = (
        SELECT MAX(a2.assessed_at) FROM assessments a2
        WHERE a2.competency_unit_id = cu.id AND a2.pilot_id = ? AND a2.tenant_id = ?
      )
    LEFT JOIN assessments all_a ON all_a.competency_unit_id = cu.id
      AND all_a.pilot_id = ? AND all_a.tenant_id = ?
    WHERE cu.tenant_id = ?
    GROUP BY cu.id, cu.code, cu.name, cu.category, a.score, a.assessed_at
    ORDER BY cu.category, cu.code
  `).all(pilotId, tenantId, pilotId, tenantId, pilotId, tenantId, tenantId) as object[];

  // History: last 6 sessions
  const history = db.prepare(`
    SELECT a.assessed_at, cu.code, a.score
    FROM assessments a
    JOIN competency_units cu ON cu.id = a.competency_unit_id
    WHERE a.tenant_id = ? AND a.pilot_id = ?
    ORDER BY a.assessed_at DESC
    LIMIT 48
  `).all(tenantId, pilotId) as object[];

  ok(res, { progress, history });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/v1/stats', authenticate, (_req: Request, res: Response) => {
  const { tenantId } = _req.user!;
  const totalAssessments = (db.prepare('SELECT COUNT(*) AS c FROM assessments WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
  const pilotsAssessed   = (db.prepare('SELECT COUNT(DISTINCT pilot_id) AS c FROM assessments WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
  const avgScore         = (db.prepare('SELECT ROUND(AVG(score),2) AS avg FROM assessments WHERE tenant_id = ?').get(tenantId) as { avg: number | null }).avg;
  ok(res, { totalAssessments, pilotsAssessed, averageScore: avgScore ?? 0 });
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[cbta-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[cbta-service] ✓  http://localhost:${PORT}`));
