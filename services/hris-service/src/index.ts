import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createDatabase, generateExpiryNotifications } from './db';
import { authenticate, requireRole } from './middleware/auth';

const PORT = parseInt(process.env.PORT ?? '3004', 10);
const db   = createDatabase();
const app  = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, status = 200, meta: object = {}): void {
  res.status(status).json({ data, meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...meta }, error: null });
}
function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ data: null, meta: { requestId: randomUUID(), timestamp: new Date().toISOString() }, error: { code, message } });
}

function licenceStatus(expiresAt: string): 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' {
  const exp   = new Date(expiresAt).getTime();
  const now   = Date.now();
  const days  = (exp - now) / 86_400_000;
  if (days < 0)  return 'EXPIRED';
  if (days < 60) return 'EXPIRING_SOON';
  return 'VALID';
}

function enrichLicences(rows: object[]): object[] {
  return (rows as Array<Record<string, unknown>>).map(r => ({
    ...r,
    status: licenceStatus(r.expires_at as string),
    days_remaining: Math.ceil((new Date(r.expires_at as string).getTime() - Date.now()) / 86_400_000),
  }));
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'hris-service' }));

// ─── Pilot Profiles ───────────────────────────────────────────────────────────

app.get('/api/v1/profile/:pilotId', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: requesterId } = req.user!;
  const { pilotId } = req.params;

  if (role === 'PILOT' && requesterId !== pilotId) {
    fail(res, 403, 'FORBIDDEN', 'You can only view your own profile'); return;
  }

  const profile = db.prepare(
    'SELECT * FROM pilot_profiles WHERE pilot_id = ? AND tenant_id = ?'
  ).get(pilotId, tenantId) as object | undefined;

  const licences     = enrichLicences(db.prepare('SELECT * FROM licences WHERE pilot_id = ? AND tenant_id = ? ORDER BY type').all(pilotId, tenantId) as object[]);
  const type_ratings = db.prepare('SELECT * FROM type_ratings WHERE pilot_id = ? AND tenant_id = ? ORDER BY rated_at DESC').all(pilotId, tenantId) as object[];

  ok(res, { profile: profile ?? { pilot_id: pilotId, tenant_id: tenantId }, licences, type_ratings });
});

app.put('/api/v1/profile/:pilotId', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id: requesterId } = req.user!;
  const { pilotId } = req.params;

  if (role === 'PILOT' && requesterId !== pilotId) { fail(res, 403, 'FORBIDDEN', 'Forbidden'); return; }

  const schema = z.object({
    licenceNumber:  z.string().optional(),
    nationality:    z.string().optional(),
    dateOfBirth:    z.string().optional(),
    homeBase:       z.string().optional(),
    totalHours:     z.number().int().min(0).optional(),
    notes:          z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pilot_profiles (pilot_id, tenant_id, licence_number, nationality, date_of_birth, home_base, total_hours, notes, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(pilot_id) DO UPDATE SET
      licence_number = COALESCE(excluded.licence_number, licence_number),
      nationality    = COALESCE(excluded.nationality, nationality),
      date_of_birth  = COALESCE(excluded.date_of_birth, date_of_birth),
      home_base      = COALESCE(excluded.home_base, home_base),
      total_hours    = COALESCE(excluded.total_hours, total_hours),
      notes          = COALESCE(excluded.notes, notes),
      updated_at     = excluded.updated_at
  `).run(
    pilotId, tenantId,
    parsed.data.licenceNumber ?? null, parsed.data.nationality ?? null,
    parsed.data.dateOfBirth ?? null, parsed.data.homeBase ?? null,
    parsed.data.totalHours ?? null, parsed.data.notes ?? null, now
  );

  const updated = db.prepare('SELECT * FROM pilot_profiles WHERE pilot_id = ?').get(pilotId) as object;
  ok(res, updated);
});

// ─── Licences ─────────────────────────────────────────────────────────────────

app.get('/api/v1/licences', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id } = req.user!;
  const pilotId = role === 'PILOT' ? id : (req.query.pilotId as string | undefined);

  const rows = pilotId
    ? db.prepare('SELECT * FROM licences WHERE tenant_id = ? AND pilot_id = ? ORDER BY type').all(tenantId, pilotId) as object[]
    : db.prepare('SELECT * FROM licences WHERE tenant_id = ? ORDER BY pilot_id, type').all(tenantId) as object[];

  ok(res, enrichLicences(rows));
});

const LicenceSchema = z.object({
  type:             z.enum(['ATPL','CPL','IR','MEDICAL_CLASS1','MEDICAL_CLASS2','ENGLISH_LANGUAGE','LAPL','PPL']),
  number:           z.string().optional(),
  issuingAuthority: z.string().optional(),
  issuedAt:         z.string().optional(),
  expiresAt:        z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

app.post('/api/v1/licences/:pilotId', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR'), (req: Request, res: Response) => {
  const parsed = LicenceSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const id = randomUUID();
  db.prepare('INSERT INTO licences (id, tenant_id, pilot_id, type, number, issuing_authority, issued_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.user!.tenantId, req.params.pilotId, parsed.data.type, parsed.data.number ?? null, parsed.data.issuingAuthority ?? null, parsed.data.issuedAt ?? null, parsed.data.expiresAt);

  generateExpiryNotifications(db);
  const lic = db.prepare('SELECT * FROM licences WHERE id = ?').get(id) as object;
  ok(res, { ...lic as Record<string, unknown>, status: licenceStatus((lic as Record<string, string>).expires_at) }, 201);
});

app.put('/api/v1/licences/:licenceId', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR'), (req: Request, res: Response) => {
  const parsed = LicenceSchema.partial().safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  db.prepare('UPDATE licences SET type=COALESCE(?,type), number=COALESCE(?,number), issuing_authority=COALESCE(?,issuing_authority), expires_at=COALESCE(?,expires_at), updated_at=? WHERE id=? AND tenant_id=?')
    .run(parsed.data.type ?? null, parsed.data.number ?? null, parsed.data.issuingAuthority ?? null, parsed.data.expiresAt ?? null, new Date().toISOString(), req.params.licenceId, req.user!.tenantId);

  const lic = db.prepare('SELECT * FROM licences WHERE id = ?').get(req.params.licenceId) as object | undefined;
  if (!lic) { fail(res, 404, 'NOT_FOUND', 'Licence not found'); return; }
  ok(res, { ...lic as Record<string, unknown>, status: licenceStatus((lic as Record<string, string>).expires_at) });
});

app.delete('/api/v1/licences/:licenceId', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN'), (req: Request, res: Response) => {
  db.prepare('DELETE FROM licences WHERE id = ? AND tenant_id = ?').run(req.params.licenceId, req.user!.tenantId);
  res.status(204).end();
});

// ─── Type Ratings ─────────────────────────────────────────────────────────────

app.get('/api/v1/type-ratings/:pilotId', authenticate, (req: Request, res: Response) => {
  const { tenantId, role, id } = req.user!;
  if (role === 'PILOT' && id !== req.params.pilotId) { fail(res, 403, 'FORBIDDEN', 'Forbidden'); return; }
  const rows = db.prepare('SELECT * FROM type_ratings WHERE tenant_id = ? AND pilot_id = ? ORDER BY rated_at DESC').all(tenantId, req.params.pilotId) as object[];
  ok(res, rows);
});

app.post('/api/v1/type-ratings/:pilotId', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR'), (req: Request, res: Response) => {
  const schema = z.object({ aircraftType: z.string().min(2), aircraftFull: z.string().min(3), ratedAt: z.string(), expiresAt: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const id = randomUUID();
  db.prepare('INSERT INTO type_ratings (id, tenant_id, pilot_id, aircraft_type, aircraft_full, rated_at, expires_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.user!.tenantId, req.params.pilotId, parsed.data.aircraftType, parsed.data.aircraftFull, parsed.data.ratedAt, parsed.data.expiresAt ?? null);
  ok(res, db.prepare('SELECT * FROM type_ratings WHERE id = ?').get(id) as object, 201);
});

// ─── Notifications ────────────────────────────────────────────────────────────

app.get('/api/v1/notifications', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: pilotId, role } = req.user!;
  const limit  = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const unread = req.query.unread === 'true';

  // Refresh expiry notifications on every fetch
  generateExpiryNotifications(db);

  let query  = 'WHERE tenant_id = ?';
  const args: (string | number)[] = [tenantId];

  if (role === 'PILOT') { query += ' AND pilot_id = ?'; args.push(pilotId); }
  if (unread)           { query += ' AND is_read = 0'; }

  const rows  = db.prepare(`SELECT * FROM notifications ${query} ORDER BY created_at DESC LIMIT ?`).all(...args, limit) as object[];
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM notifications ${query} AND is_read = 0`).get(...args) as { c: number };
  ok(res, rows, 200, { unreadCount: c });
});

app.get('/api/v1/notifications/count', authenticate, (req: Request, res: Response) => {
  generateExpiryNotifications(db);
  const { tenantId, id: pilotId, role } = req.user!;
  const query = role === 'PILOT' ? 'WHERE tenant_id = ? AND pilot_id = ? AND is_read = 0' : 'WHERE tenant_id = ? AND is_read = 0';
  const args  = role === 'PILOT' ? [tenantId, pilotId] : [tenantId];
  const { c } = db.prepare(`SELECT COUNT(*) AS c FROM notifications ${query}`).get(...args) as { c: number };
  ok(res, { unreadCount: c });
});

app.post('/api/v1/notifications/:id/read', authenticate, (req: Request, res: Response) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND tenant_id = ?').run(req.params.id, req.user!.tenantId);
  res.status(204).end();
});

app.post('/api/v1/notifications/read-all', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: pilotId, role } = req.user!;
  if (role === 'PILOT') db.prepare('UPDATE notifications SET is_read = 1 WHERE tenant_id = ? AND pilot_id = ?').run(tenantId, pilotId);
  else                  db.prepare('UPDATE notifications SET is_read = 1 WHERE tenant_id = ?').run(tenantId);
  res.status(204).end();
});

// ─── Expiring soon (admin) ────────────────────────────────────────────────────

app.get('/api/v1/expiring', authenticate, requireRole('GLOBAL_ADMIN','COUNTRY_ADMIN','INSTRUCTOR'), (req: Request, res: Response) => {
  const days = parseInt(req.query.days as string) || 90;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
  const rows = db.prepare(
    'SELECT l.*, pp.home_base FROM licences l LEFT JOIN pilot_profiles pp ON pp.pilot_id = l.pilot_id WHERE l.tenant_id = ? AND l.expires_at <= ? ORDER BY l.expires_at'
  ).all(req.user!.tenantId, cutoff.toISOString().slice(0, 10)) as object[];
  ok(res, enrichLicences(rows));
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/v1/stats', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const today   = new Date().toISOString().slice(0, 10);
  const in30    = new Date(); in30.setDate(in30.getDate() + 30);
  const in90    = new Date(); in90.setDate(in90.getDate() + 90);

  const expired    = (db.prepare("SELECT COUNT(*) AS c FROM licences WHERE tenant_id = ? AND expires_at < ?").get(tenantId, today) as { c: number }).c;
  const expiring30 = (db.prepare("SELECT COUNT(*) AS c FROM licences WHERE tenant_id = ? AND expires_at >= ? AND expires_at <= ?").get(tenantId, today, in30.toISOString().slice(0,10)) as { c: number }).c;
  const expiring90 = (db.prepare("SELECT COUNT(*) AS c FROM licences WHERE tenant_id = ? AND expires_at >= ? AND expires_at <= ?").get(tenantId, today, in90.toISOString().slice(0,10)) as { c: number }).c;
  const ratings    = (db.prepare("SELECT COUNT(*) AS c FROM type_ratings WHERE tenant_id = ?").get(tenantId) as { c: number }).c;
  const { totalSim } = (db.prepare("SELECT COALESCE(SUM(simulator_hours),0) AS totalSim FROM pilot_profiles WHERE tenant_id = ?").get(tenantId) as { totalSim: number });

  ok(res, { expired, expiring30, expiring90, totalTypeRatings: ratings, totalSimulatorHours: totalSim });
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[hris-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[hris-service] ✓  http://localhost:${PORT}`));
