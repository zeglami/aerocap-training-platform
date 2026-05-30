import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createHash, randomUUID } from 'crypto';
import { createDatabase } from './db';
import type {
  ReportTemplateRow,
  ReportRunRow,
  ReportDocumentRow,
  PilotComplianceSnapshotRow,
  InspectorAccessTokenRow,
} from './db';
import { authenticate, requireRole } from './middleware/auth';
import {
  reportTemplateCreateZ,
  reportTemplateUpdateZ,
  reportRunCreateZ,
  inspectorTokenCreateZ,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3009', 10);

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
    data:  null,
    meta:  { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function isoInSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

// Serialize a template row to the API shape (convert INTEGER booleans, parse JSON).
function serializeTemplate(row: ReportTemplateRow) {
  return {
    ...row,
    layoutSpec:          JSON.parse(row.layout_spec) as Record<string, unknown>,
    layout_spec:         undefined,
    isAuthorityApproved: row.is_authority_approved === 1,
    is_authority_approved: undefined,
  };
}

// Serialize a run row (parse scope JSON).
function serializeRun(row: ReportRunRow) {
  return {
    ...row,
    scope: JSON.parse(row.scope) as Record<string, unknown>,
  };
}

// Serialize a document row (no transformations needed but kept consistent).
function serializeDocument(row: ReportDocumentRow) {
  return { ...row };
}

// Serialize a snapshot row (convert INTEGER booleans, parse JSON).
function serializeSnapshot(row: PilotComplianceSnapshotRow) {
  return {
    ...row,
    payload:          JSON.parse(row.payload) as Record<string, unknown>,
    overallCompliant: row.overall_compliant === 1,
    overall_compliant: undefined,
  };
}

// Serialize an inspector token row (parse JSON fields, omit token_hash).
function serializeToken(row: InspectorAccessTokenRow) {
  return {
    ...row,
    scope:      JSON.parse(row.scope) as Record<string, unknown>,
    access_log: JSON.parse(row.access_log) as unknown[],
    token_hash: undefined, // never expose the hash
  };
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'regulatory-reports' });
});

// ─── Report Templates ─────────────────────────────────────────────────────────

// GET /api/v1/report-templates — paginated list
app.get('/api/v1/report-templates', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;

  const rows = db.prepare(
    'SELECT * FROM report_template WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ).all(tenantId, pageSize, offset) as ReportTemplateRow[];

  const { total } = db.prepare(
    'SELECT COUNT(*) AS total FROM report_template WHERE tenant_id = ? AND deleted_at IS NULL',
  ).get(tenantId) as { total: number };

  ok(res, rows.map(serializeTemplate), 200, { page, pageSize, total });
});

// POST /api/v1/report-templates — CFI/GLOBAL_ADMIN only
app.post(
  '/api/v1/report-templates',
  authenticate,
  requireRole('CFI', 'GLOBAL_ADMIN'),
  (req: Request, res: Response) => {
    const parsed = reportTemplateCreateZ.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
      return;
    }

    const { code, title, regulatoryFramework, templateType, layoutSpec, isAuthorityApproved, authorityApprovalRef } = parsed.data;
    const { tenantId } = req.user!;
    const id  = randomUUID();
    const now = nowIso();

    try {
      db.prepare(`
        INSERT INTO report_template
          (id, tenant_id, code, title, regulatory_framework, template_type,
           layout_spec, is_authority_approved, authority_approval_ref, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, tenantId, code, title, regulatoryFramework, templateType,
        JSON.stringify(layoutSpec), isAuthorityApproved ? 1 : 0,
        authorityApprovalRef ?? null, now, now,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        fail(res, 409, 'CONFLICT', 'A template with this code and schema_version already exists for this tenant');
        return;
      }
      throw err;
    }

    const row = db.prepare('SELECT * FROM report_template WHERE id = ?').get(id) as ReportTemplateRow;
    ok(res, serializeTemplate(row), 201);
  },
);

// GET /api/v1/report-templates/:id
app.get('/api/v1/report-templates/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const row = db.prepare(
    'SELECT * FROM report_template WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as ReportTemplateRow | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Report template not found'); return; }
  ok(res, serializeTemplate(row));
});

// PATCH /api/v1/report-templates/:id
app.patch('/api/v1/report-templates/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const existing = db.prepare(
    'SELECT * FROM report_template WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as ReportTemplateRow | undefined;

  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Report template not found'); return; }

  const parsed = reportTemplateUpdateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { title, layoutSpec, isAuthorityApproved, authorityApprovalRef } = parsed.data;
  const now = nowIso();

  const newTitle               = title               ?? existing.title;
  const newLayoutSpec          = layoutSpec           !== undefined ? JSON.stringify(layoutSpec) : existing.layout_spec;
  const newIsAuthorityApproved = isAuthorityApproved  !== undefined ? (isAuthorityApproved ? 1 : 0) : existing.is_authority_approved;
  const newAuthorityApprovalRef = authorityApprovalRef !== undefined ? authorityApprovalRef : existing.authority_approval_ref;

  db.prepare(`
    UPDATE report_template
    SET title = ?, layout_spec = ?, is_authority_approved = ?, authority_approval_ref = ?, updated_at = ?
    WHERE id = ?
  `).run(newTitle, newLayoutSpec, newIsAuthorityApproved, newAuthorityApprovalRef, now, req.params.id);

  const updated = db.prepare('SELECT * FROM report_template WHERE id = ?').get(req.params.id) as ReportTemplateRow;
  ok(res, serializeTemplate(updated));
});

// ─── Report Runs ──────────────────────────────────────────────────────────────

// GET /api/v1/report-runs — paginated list with optional ?status filter
app.get('/api/v1/report-runs', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;
  const status   = req.query.status as string | undefined;

  const validStatuses = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'];

  let query      = 'SELECT * FROM report_run WHERE tenant_id = ? AND deleted_at IS NULL';
  let countQuery = 'SELECT COUNT(*) AS total FROM report_run WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[]      = [tenantId];
  const countParams: (string | number)[] = [tenantId];

  if (status && validStatuses.includes(status)) {
    query      += ' AND status = ?';
    countQuery += ' AND status = ?';
    params.push(status);
    countParams.push(status);
  }

  query += ' ORDER BY requested_at DESC LIMIT ? OFFSET ?';
  params.push(pageSize, offset);

  const rows = db.prepare(query).all(...params) as ReportRunRow[];
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

  ok(res, rows.map(serializeRun), 200, { page, pageSize, total });
});

// POST /api/v1/report-runs — create and simulate sync completion
app.post('/api/v1/report-runs', authenticate, (req: Request, res: Response) => {
  const parsed = reportRunCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
    return;
  }

  const { templateId, scope, outputFormats } = parsed.data;
  const { tenantId, id: userId } = req.user!;

  // Verify template exists and belongs to this tenant
  const template = db.prepare(
    'SELECT id FROM report_template WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(templateId, tenantId);

  if (!template) {
    fail(res, 404, 'NOT_FOUND', 'Report template not found');
    return;
  }

  const runId  = randomUUID();
  const now    = nowIso();

  db.exec('BEGIN IMMEDIATE');
  try {
    // Insert with QUEUED status
    db.prepare(`
      INSERT INTO report_run
        (id, tenant_id, template_id, scope, requested_by, requested_at, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(runId, tenantId, templateId, JSON.stringify(scope), userId, now, 'QUEUED', now, now);

    // Immediately transition: QUEUED -> RUNNING
    db.prepare(
      'UPDATE report_run SET status = ?, started_at = ?, updated_at = ? WHERE id = ?',
    ).run('RUNNING', now, now, runId);

    // Immediately transition: RUNNING -> SUCCEEDED
    db.prepare(
      'UPDATE report_run SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?',
    ).run('SUCCEEDED', now, now, runId);

    // Create a report_document for each requested format
    for (const format of outputFormats) {
      const ext = format.toLowerCase();
      const docId      = randomUUID();
      const storageKey = `${tenantId}/reports/${runId}/report.${ext}`;
      db.prepare(`
        INSERT INTO report_document
          (id, tenant_id, report_run_id, format, storage_key, size_bytes, sha256, generated_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(docId, tenantId, runId, format, storageKey, 0, '0'.repeat(64), now, now, now);

      // Track the first document as output_document_id (JSON preferred, else first)
      if (format === 'JSON') {
        db.prepare('UPDATE report_run SET output_document_id = ?, updated_at = ? WHERE id = ?')
          .run(docId, now, runId);
      }
    }

    // If no JSON format was in the list, set the first document as output
    const runCheck = db.prepare(
      'SELECT output_document_id FROM report_run WHERE id = ?',
    ).get(runId) as { output_document_id: string | null };

    if (!runCheck.output_document_id) {
      const firstDoc = db.prepare(
        'SELECT id FROM report_document WHERE report_run_id = ? ORDER BY created_at LIMIT 1',
      ).get(runId) as { id: string } | undefined;
      if (firstDoc) {
        db.prepare('UPDATE report_run SET output_document_id = ?, updated_at = ? WHERE id = ?')
          .run(firstDoc.id, now, runId);
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const run = db.prepare('SELECT * FROM report_run WHERE id = ?').get(runId) as ReportRunRow;
  ok(res, serializeRun(run), 201);
});

// GET /api/v1/report-runs/:id
app.get('/api/v1/report-runs/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const row = db.prepare(
    'SELECT * FROM report_run WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as ReportRunRow | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Report run not found'); return; }
  ok(res, serializeRun(row));
});

// POST /api/v1/report-runs/:id/cancel
app.post('/api/v1/report-runs/:id/cancel', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const run = db.prepare(
    'SELECT * FROM report_run WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as ReportRunRow | undefined;

  if (!run) { fail(res, 404, 'NOT_FOUND', 'Report run not found'); return; }

  if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
    fail(res, 409, 'INVALID_STATE', `Cannot cancel a run with status '${run.status}'`);
    return;
  }

  const now = nowIso();
  db.prepare(
    "UPDATE report_run SET status = 'FAILED', error = 'Cancelled by user', updated_at = ? WHERE id = ?",
  ).run(now, req.params.id);

  const updated = db.prepare('SELECT * FROM report_run WHERE id = ?').get(req.params.id) as ReportRunRow;
  ok(res, serializeRun(updated));
});

// POST /api/v1/report-runs/:id/sign — CFI only
app.post(
  '/api/v1/report-runs/:id/sign',
  authenticate,
  requireRole('CFI'),
  (req: Request, res: Response) => {
    const { tenantId, id: userId } = req.user!;

    const run = db.prepare(
      'SELECT * FROM report_run WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as ReportRunRow | undefined;

    if (!run) { fail(res, 404, 'NOT_FOUND', 'Report run not found'); return; }

    // 410 Gone if already signed
    if (run.signed_at !== null) {
      res.status(410).json({
        data:  null,
        meta:  { requestId: randomUUID(), timestamp: nowIso() },
        error: { code: 'ALREADY_SIGNED', message: 'This report run has already been signed' },
      });
      return;
    }

    if (run.status !== 'SUCCEEDED') {
      fail(res, 409, 'INVALID_STATE', 'Only SUCCEEDED runs can be signed');
      return;
    }

    const signedAt      = nowIso();
    const signatureHash = createHash('sha256').update(run.id + signedAt).digest('hex');

    db.prepare(
      'UPDATE report_run SET signed_at = ?, signed_by = ?, signature_hash = ?, updated_at = ? WHERE id = ?',
    ).run(signedAt, userId, signatureHash, signedAt, req.params.id);

    const updated = db.prepare('SELECT * FROM report_run WHERE id = ?').get(req.params.id) as ReportRunRow;
    ok(res, serializeRun(updated));
  },
);

// GET /api/v1/report-runs/:id/documents
app.get('/api/v1/report-runs/:id/documents', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const run = db.prepare(
    'SELECT id FROM report_run WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId);

  if (!run) { fail(res, 404, 'NOT_FOUND', 'Report run not found'); return; }

  const docs = db.prepare(
    'SELECT * FROM report_document WHERE report_run_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY generated_at',
  ).all(req.params.id, tenantId) as ReportDocumentRow[];

  ok(res, docs.map(serializeDocument));
});

// ─── Report Documents ─────────────────────────────────────────────────────────

// GET /api/v1/report-documents/:id/download — 302 redirect to mock S3 URL
app.get('/api/v1/report-documents/:id/download', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const doc = db.prepare(
    'SELECT * FROM report_document WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as ReportDocumentRow | undefined;

  if (!doc) { fail(res, 404, 'NOT_FOUND', 'Report document not found'); return; }

  const redirectUrl = `https://s3.amazonaws.com/${doc.storage_key}?token=mock`;
  res.redirect(302, redirectUrl);
});

// ─── Pilot Compliance Snapshots ───────────────────────────────────────────────

function createFreshSnapshot(
  tenantId: string,
  pilotId:  string,
  overrides?: Partial<{
    q1: string; q2: string; q3: string; q4: string;
    q5: string; q6: string; q7: string;
    payload: Record<string, unknown>;
    overallCompliant: number;
  }>,
): PilotComplianceSnapshotRow {
  const id        = randomUUID();
  const now       = nowIso();
  const expiresAt = isoInHours(24);

  const q1 = overrides?.q1 ?? 'UNKNOWN';
  const q2 = overrides?.q2 ?? 'UNKNOWN';
  const q3 = overrides?.q3 ?? 'UNKNOWN';
  const q4 = overrides?.q4 ?? 'UNKNOWN';
  const q5 = overrides?.q5 ?? 'UNKNOWN';
  const q6 = overrides?.q6 ?? 'UNKNOWN';
  const q7 = overrides?.q7 ?? 'UNKNOWN';
  const payload         = JSON.stringify(overrides?.payload ?? {});
  const overallCompliant = overrides?.overallCompliant ?? 0;

  db.prepare(`
    INSERT INTO pilot_compliance_snapshot
      (id, tenant_id, pilot_id,
       q1_training_cycle_status, q2_medical_status, q3_recency_status,
       q4_cu_coverage_status, q5_open_deficits_status,
       q6_instructor_qual_status, q7_simulator_qual_status,
       payload, overall_compliant, expires_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, tenantId, pilotId, q1, q2, q3, q4, q5, q6, q7, payload, overallCompliant, expiresAt, now, now);

  return db.prepare(
    'SELECT * FROM pilot_compliance_snapshot WHERE id = ?',
  ).get(id) as PilotComplianceSnapshotRow;
}

// GET /api/v1/pilots/:pilotId/compliance-snapshot — get latest unexpired; auto-refresh if stale
app.get('/api/v1/pilots/:pilotId/compliance-snapshot', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { pilotId }  = req.params;
  const now          = nowIso();

  const latest = db.prepare(`
    SELECT * FROM pilot_compliance_snapshot
    WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL
    ORDER BY snapshot_at DESC
    LIMIT 1
  `).get(tenantId, pilotId) as PilotComplianceSnapshotRow | undefined;

  if (latest && latest.expires_at > now) {
    ok(res, serializeSnapshot(latest));
    return;
  }

  // Expired or missing — auto-refresh (placeholder computation)
  const fresh = createFreshSnapshot(tenantId, pilotId);
  ok(res, serializeSnapshot(fresh));
});

// POST /api/v1/pilots/:pilotId/compliance-snapshot — force refresh
app.post('/api/v1/pilots/:pilotId/compliance-snapshot', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { pilotId }  = req.params;

  const fresh = createFreshSnapshot(tenantId, pilotId);
  ok(res, serializeSnapshot(fresh), 201);
});

// GET /api/v1/pilots/:pilotId/compliance-snapshot/history — paginated
app.get('/api/v1/pilots/:pilotId/compliance-snapshot/history', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { pilotId }  = req.params;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;

  const rows = db.prepare(`
    SELECT * FROM pilot_compliance_snapshot
    WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL
    ORDER BY snapshot_at DESC
    LIMIT ? OFFSET ?
  `).all(tenantId, pilotId, pageSize, offset) as PilotComplianceSnapshotRow[];

  const { total } = db.prepare(
    'SELECT COUNT(*) AS total FROM pilot_compliance_snapshot WHERE tenant_id = ? AND pilot_id = ? AND deleted_at IS NULL',
  ).get(tenantId, pilotId) as { total: number };

  ok(res, rows.map(serializeSnapshot), 200, { page, pageSize, total });
});

// ─── Inspector Access Tokens ──────────────────────────────────────────────────

// GET /api/v1/inspector-tokens — list (CFI only)
app.get(
  '/api/v1/inspector-tokens',
  authenticate,
  requireRole('CFI'),
  (req: Request, res: Response) => {
    const { tenantId } = req.user!;
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset   = (page - 1) * pageSize;

    const rows = db.prepare(
      'SELECT * FROM inspector_access_token WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY issued_at DESC LIMIT ? OFFSET ?',
    ).all(tenantId, pageSize, offset) as InspectorAccessTokenRow[];

    const { total } = db.prepare(
      'SELECT COUNT(*) AS total FROM inspector_access_token WHERE tenant_id = ? AND deleted_at IS NULL',
    ).get(tenantId) as { total: number };

    ok(res, rows.map(serializeToken), 200, { page, pageSize, total });
  },
);

// POST /api/v1/inspector-tokens — create (CFI only); returns plain token once
app.post(
  '/api/v1/inspector-tokens',
  authenticate,
  requireRole('CFI'),
  (req: Request, res: Response) => {
    const parsed = inspectorTokenCreateZ.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', '));
      return;
    }

    const { inspectorEmail, inspectorName, authority, scope, validForHours } = parsed.data;
    const { tenantId } = req.user!;

    // Generate a cryptographically random 64-char hex token
    const plainToken = Array.from(
      { length: 4 },
      () => randomUUID().replace(/-/g, ''),
    ).join('').slice(0, 64);

    const tokenHash  = createHash('sha256').update(plainToken).digest('hex');
    const id         = randomUUID();
    const now        = nowIso();
    const validUntil = isoInSeconds(validForHours * 3600);

    try {
      db.prepare(`
        INSERT INTO inspector_access_token
          (id, tenant_id, inspector_email, inspector_name, authority,
           scope, token_hash, issued_at, valid_until, access_log, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id, tenantId, inspectorEmail, inspectorName, authority,
        JSON.stringify(scope), tokenHash, now, validUntil, '[]', now, now,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        fail(res, 409, 'CONFLICT', 'Token hash collision — please retry');
        return;
      }
      throw err;
    }

    const row = db.prepare(
      'SELECT * FROM inspector_access_token WHERE id = ?',
    ).get(id) as InspectorAccessTokenRow;

    // Return the plain token once (never stored, only the hash is)
    ok(res, { ...serializeToken(row), plainToken }, 201);
  },
);

// POST /api/v1/inspector-tokens/:id/revoke — CFI only
app.post(
  '/api/v1/inspector-tokens/:id/revoke',
  authenticate,
  requireRole('CFI'),
  (req: Request, res: Response) => {
    const { tenantId, id: userId } = req.user!;

    const token = db.prepare(
      'SELECT * FROM inspector_access_token WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(req.params.id, tenantId) as InspectorAccessTokenRow | undefined;

    if (!token) { fail(res, 404, 'NOT_FOUND', 'Inspector access token not found'); return; }

    if (token.revoked_at !== null) {
      fail(res, 409, 'ALREADY_REVOKED', 'This token has already been revoked');
      return;
    }

    const now = nowIso();
    db.prepare(
      'UPDATE inspector_access_token SET revoked_at = ?, revoked_by = ?, updated_at = ? WHERE id = ?',
    ).run(now, userId, now, req.params.id);

    const updated = db.prepare(
      'SELECT * FROM inspector_access_token WHERE id = ?',
    ).get(req.params.id) as InspectorAccessTokenRow;

    ok(res, serializeToken(updated));
  },
);

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[regulatory-reports]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[regulatory-reports] ✓  http://localhost:${PORT}`));
