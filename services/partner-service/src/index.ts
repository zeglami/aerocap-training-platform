import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase } from './db';
import { authenticate, requireRole, requireMinRole } from './middleware/auth';
import {
  CreatePartnerSchema,
  UpdatePartnerSchema,
  AddMemberSchema,
  PaginationSchema,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3012', 10);
const USER_SVC = process.env.USER_SERVICE_URL ?? 'http://localhost:3001';

const db  = createDatabase();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Response helpers ──────────────────────────────────────────────────────────

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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'partner-service' }));

// ─── Helper: verify caller is allowed to access this partnerId ────────────────

function resolvePartner(
  partnerId: string,
  tenantId: string,
  callerId: string,
  callerRole: string,
  callerPartnerId: string | null | undefined,
): { partner: Record<string, unknown> } | { error: string; status: number } {
  const partner = db.prepare(
    'SELECT * FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(partnerId, tenantId) as Record<string, unknown> | undefined;

  if (!partner) return { error: 'Partner not found', status: 404 };

  // PARTNER_ADMIN can only access their own partner
  if (callerRole === 'PARTNER_ADMIN') {
    const membership = db.prepare(
      `SELECT id FROM partner_members
       WHERE partner_id = ? AND user_id = ? AND tenant_id = ? AND status = 'ACTIVE'`
    ).get(partnerId, callerId, tenantId);
    if (!membership) return { error: 'Access denied to this partner', status: 403 };
  }

  return { partner };
}

// ─── Call user-service to sync booking_authorized ────────────────────────────

async function syncUserAuthorization(
  userId: string,
  authorized: boolean,
  bearerToken: string,
): Promise<void> {
  const endpoint = authorized ? 'authorize' : 'revoke';
  try {
    await fetch(`${USER_SVC}/api/v1/users/${userId}/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearerToken}`, 'Content-Type': 'application/json' },
    });
  } catch {
    // Fire-and-forget — partner_members table is the source of truth locally
    console.warn(`[partner-service] user-service sync failed for userId=${userId}`);
  }
}

// ─── Partners CRUD ────────────────────────────────────────────────────────────

// GET /api/v1/partners — MANAGER+, or PARTNER_ADMIN sees only their own
app.get('/api/v1/partners', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const pag = PaginationSchema.safeParse(req.query);
  if (!pag.success) { fail(res, 400, 'VALIDATION_ERROR', 'Invalid pagination'); return; }
  const { page, limit } = pag.data;
  const offset = (page - 1) * limit;

  const status = req.query.status as string | undefined;

  // PARTNER_ADMIN only sees partners they belong to
  if (role === 'PARTNER_ADMIN') {
    const membership = db.prepare(
      `SELECT partner_id FROM partner_members WHERE user_id = ? AND tenant_id = ? AND status = 'ACTIVE'`
    ).get(userId, tenantId) as { partner_id: string } | undefined;

    if (!membership) { ok(res, [], 200, { page, limit, total: 0 }); return; }

    const partner = db.prepare(
      'SELECT * FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
    ).get(membership.partner_id, tenantId);

    ok(res, partner ? [partner] : [], 200, { page, limit, total: partner ? 1 : 0 });
    return;
  }

  let where = 'WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (status) { where += ' AND status = ?'; params.push(status); }

  const rows = db.prepare(
    `SELECT * FROM partners ${where} ORDER BY name ASC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as object[];

  const { c: total } = db.prepare(
    `SELECT COUNT(*) AS c FROM partners ${where}`
  ).get(...params) as { c: number };

  ok(res, rows, 200, { page, limit, total });
});

// POST /api/v1/partners — MANAGER+
app.post('/api/v1/partners', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const parsed = CreatePartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR',
      parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const d = parsed.data;
  const id = randomUUID();

  // Check ICAO uniqueness per tenant
  if (d.icaoCode) {
    const existing = db.prepare(
      'SELECT id FROM partners WHERE tenant_id = ? AND icao_code = ? AND deleted_at IS NULL'
    ).get(tenantId, d.icaoCode);
    if (existing) { fail(res, 409, 'ICAO_CONFLICT', `ICAO code ${d.icaoCode} already used in this tenant`); return; }
  }

  db.prepare(`
    INSERT INTO partners
      (id, tenant_id, name, icao_code, type, contact_name, contact_email,
       contract_ref, contract_start, contract_end, max_pilots, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, d.name, d.icaoCode ?? null, d.type,
    d.contactName, d.contactEmail, d.contractRef ?? null,
    d.contractStart, d.contractEnd ?? null, d.maxPilots ?? null,
    'ACTIVE', d.notes ?? null, userId,
  );

  const created = db.prepare('SELECT * FROM partners WHERE id = ?').get(id) as object;
  ok(res, created, 201);
});

// GET /api/v1/partners/me — PARTNER_ADMIN
app.get('/api/v1/partners/me', authenticate, requireRole('PARTNER_ADMIN'), (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;

  const membership = db.prepare(
    `SELECT partner_id FROM partner_members WHERE user_id = ? AND tenant_id = ? AND status = 'ACTIVE'`
  ).get(userId, tenantId) as { partner_id: string } | undefined;

  if (!membership) { fail(res, 404, 'NOT_FOUND', 'No partner assigned to this account'); return; }

  const partner = db.prepare(
    'SELECT * FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(membership.partner_id, tenantId);

  if (!partner) { fail(res, 404, 'NOT_FOUND', 'Partner not found'); return; }
  ok(res, partner);
});

// GET /api/v1/partners/:id
app.get('/api/v1/partners/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }
  ok(res, result.partner);
});

// PATCH /api/v1/partners/:id — COUNTRY_ADMIN+
app.patch('/api/v1/partners/:id', authenticate, requireMinRole('COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const existing = db.prepare(
    'SELECT * FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Partner not found'); return; }

  const parsed = UpdatePartnerSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR',
      parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const d = parsed.data;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE partners SET
      name          = COALESCE(?, name),
      contact_name  = COALESCE(?, contact_name),
      contact_email = COALESCE(?, contact_email),
      status        = COALESCE(?, status),
      contract_end  = COALESCE(?, contract_end),
      max_pilots    = COALESCE(?, max_pilots),
      notes         = COALESCE(?, notes),
      updated_at    = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    d.name ?? null, d.contactName ?? null, d.contactEmail ?? null,
    d.status ?? null, d.contractEnd ?? null, d.maxPilots ?? null,
    d.notes ?? null, now, req.params.id, tenantId,
  );

  const updated = db.prepare('SELECT * FROM partners WHERE id = ?').get(req.params.id) as object;
  ok(res, updated);
});

// DELETE /api/v1/partners/:id — GLOBAL_ADMIN only
app.delete('/api/v1/partners/:id', authenticate, requireRole('GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const existing = db.prepare(
    'SELECT id FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, tenantId);
  if (!existing) { fail(res, 404, 'NOT_FOUND', 'Partner not found'); return; }

  db.prepare('UPDATE partners SET deleted_at = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), req.params.id, tenantId);

  res.status(204).end();
});

// ─── Partner Members ──────────────────────────────────────────────────────────

// GET /api/v1/partners/:id/members
app.get('/api/v1/partners/:id/members', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const pag = PaginationSchema.safeParse(req.query);
  if (!pag.success) { fail(res, 400, 'VALIDATION_ERROR', 'Invalid pagination'); return; }
  const { page, limit } = pag.data;
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT * FROM partner_members
    WHERE partner_id = ? AND tenant_id = ? AND status != 'REMOVED'
    ORDER BY joined_at DESC LIMIT ? OFFSET ?
  `).all(req.params.id, tenantId, limit, offset) as object[];

  const { c: total } = db.prepare(
    `SELECT COUNT(*) AS c FROM partner_members WHERE partner_id = ? AND tenant_id = ? AND status != 'REMOVED'`
  ).get(req.params.id, tenantId) as { c: number };

  ok(res, rows, 200, { page, limit, total });
});

// POST /api/v1/partners/:id/members
app.post('/api/v1/partners/:id/members', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const parsed = AddMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR',
      parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
    return;
  }

  const { userId: targetUserId, memberRole, notes } = parsed.data;

  // Pilot can belong to at most one partner per tenant
  const existing = db.prepare(
    `SELECT pm.id, p.name FROM partner_members pm
     JOIN partners p ON p.id = pm.partner_id
     WHERE pm.user_id = ? AND pm.tenant_id = ? AND pm.status != 'REMOVED'`
  ).get(targetUserId, tenantId) as { id: string; name: string } | undefined;

  if (existing) {
    fail(res, 409, 'ALREADY_IN_PARTNER', `This user is already a member of "${existing.name}"`);
    return;
  }

  // Check max_pilots limit
  const partner = result.partner;
  if (partner.max_pilots != null) {
    const { c: currentCount } = db.prepare(
      `SELECT COUNT(*) AS c FROM partner_members WHERE partner_id = ? AND status = 'ACTIVE'`
    ).get(req.params.id) as { c: number };
    if (currentCount >= (partner.max_pilots as number)) {
      fail(res, 409, 'PARTNER_FULL', `Partner has reached its pilot limit of ${partner.max_pilots}`);
      return;
    }
  }

  const memberId = randomUUID();
  db.prepare(`
    INSERT INTO partner_members
      (id, tenant_id, partner_id, user_id, member_role, booking_authorized, status, notes)
    VALUES (?,?,?,?,?,0,?,?)
  `).run(memberId, tenantId, req.params.id, targetUserId, memberRole, 'ACTIVE', notes ?? null);

  const created = db.prepare('SELECT * FROM partner_members WHERE id = ?').get(memberId) as object;
  ok(res, created, 201);
});

// DELETE /api/v1/partners/:id/members/:memberId
app.delete('/api/v1/partners/:id/members/:memberId', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const member = db.prepare(
    `SELECT * FROM partner_members WHERE id = ? AND partner_id = ? AND tenant_id = ? AND status != 'REMOVED'`
  ).get(req.params.memberId, req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!member) { fail(res, 404, 'NOT_FOUND', 'Member not found'); return; }

  db.prepare(`UPDATE partner_members SET status = 'REMOVED' WHERE id = ?`).run(req.params.memberId);
  res.status(204).end();
});

// POST /api/v1/partners/:id/members/:memberId/authorize
app.post('/api/v1/partners/:id/members/:memberId/authorize', authenticate, async (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const member = db.prepare(
    `SELECT * FROM partner_members WHERE id = ? AND partner_id = ? AND tenant_id = ? AND status = 'ACTIVE'`
  ).get(req.params.memberId, req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!member) { fail(res, 404, 'NOT_FOUND', 'Active member not found'); return; }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE partner_members SET booking_authorized = 1, authorized_by = ?, authorized_at = ? WHERE id = ?
  `).run(userId, now, req.params.memberId);

  // Sync to user-service (fire-and-forget)
  const token = req.headers.authorization?.slice(7) ?? '';
  await syncUserAuthorization(member.user_id as string, true, token);

  const updated = db.prepare('SELECT * FROM partner_members WHERE id = ?').get(req.params.memberId) as object;
  ok(res, updated);
});

// DELETE /api/v1/partners/:id/members/:memberId/authorize — revoke
app.delete('/api/v1/partners/:id/members/:memberId/authorize', authenticate, async (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const member = db.prepare(
    `SELECT * FROM partner_members WHERE id = ? AND partner_id = ? AND tenant_id = ? AND status = 'ACTIVE'`
  ).get(req.params.memberId, req.params.id, tenantId) as Record<string, unknown> | undefined;
  if (!member) { fail(res, 404, 'NOT_FOUND', 'Active member not found'); return; }

  db.prepare(`
    UPDATE partner_members SET booking_authorized = 0, authorized_by = NULL, authorized_at = NULL WHERE id = ?
  `).run(req.params.memberId);

  const token = req.headers.authorization?.slice(7) ?? '';
  await syncUserAuthorization(member.user_id as string, false, token);

  const updated = db.prepare('SELECT * FROM partner_members WHERE id = ?').get(req.params.memberId) as object;
  ok(res, updated);
});

// GET /api/v1/partners/:id/stats
app.get('/api/v1/partners/:id/stats', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: userId, partnerId: jwtPartnerId } = req.user!;

  if (!['GLOBAL_ADMIN','COUNTRY_ADMIN','MANAGER','PARTNER_ADMIN'].includes(role)) {
    fail(res, 403, 'FORBIDDEN', 'Insufficient permissions'); return;
  }

  const result = resolvePartner(req.params.id, tenantId, userId, role, jwtPartnerId);
  if ('error' in result) { fail(res, result.status, 'NOT_FOUND', result.error); return; }

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_members,
      SUM(CASE WHEN booking_authorized = 1 AND status = 'ACTIVE' THEN 1 ELSE 0 END) AS authorized_members,
      SUM(CASE WHEN booking_authorized = 0 AND status = 'ACTIVE' THEN 1 ELSE 0 END) AS pending_members,
      SUM(CASE WHEN status = 'SUSPENDED' THEN 1 ELSE 0 END) AS suspended_members
    FROM partner_members
    WHERE partner_id = ? AND tenant_id = ? AND status != 'REMOVED'
  `).get(req.params.id, tenantId) as Record<string, number>;

  ok(res, {
    partnerId:        req.params.id,
    totalMembers:     stats.total_members ?? 0,
    authorizedMembers: stats.authorized_members ?? 0,
    pendingMembers:   stats.pending_members ?? 0,
    suspendedMembers: stats.suspended_members ?? 0,
  });
});

// ─── Global error handler ──────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[partner-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[partner-service] ✓  http://localhost:${PORT}`));

export { app, db };
