import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { createDatabase } from './db';
import { authenticate, requireRole } from './middleware/auth';
import { LoginSchema, SignupSchema, CreateUserSchema, UpdateUserSchema, CreateTenantSchema, SwitchCompanySchema } from './schemas';
import { REGION_TENANT, TENANT_REGION } from './db';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';
const PORT       = parseInt(process.env.PORT ?? '3001', 10);

const db  = createDatabase();
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type DbUser = Record<string, string | number>;

function ok<T>(res: Response, data: T, status = 200, meta: object = {}): void {
  res.status(status).json({ data, meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...meta }, error: null });
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ data: null, meta: { requestId: randomUUID(), timestamp: new Date().toISOString() }, error: { code, message } });
}

function parseScope(scope: string | null | undefined): string[] | null {
  if (!scope || scope === 'GLOBAL') return null;
  try { return JSON.parse(scope as string) as string[]; } catch { return null; }
}

function issueToken(user: DbUser, overrideTenantId?: string): string {
  const managerRegions = user.role === 'MANAGER' ? parseScope(user.scope as string) : undefined;
  return jwt.sign(
    {
      sub:               user.id,
      tenantId:          overrideTenantId ?? user.tenant_id,
      email:             user.email,
      role:              user.role,
      firstName:         user.first_name,
      lastName:          user.last_name,
      bookingAuthorized: user.booking_authorized === 1,
      ...(user.role === 'MANAGER' && {
        managerRegions,                              // null = global, string[] = scoped
        managerHomeTenant: user.tenant_id,           // original tenant for profile ops
      }),
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function safeUser(user: DbUser) {
  return {
    id:                user.id,
    email:             user.email,
    firstName:         user.first_name,
    lastName:          user.last_name,
    role:              user.role,
    tenantId:          user.tenant_id,
    bookingAuthorized: user.booking_authorized === 1,
    signupMethod:      user.signup_method,
    managerRegions:    user.role === 'MANAGER' ? parseScope(user.scope as string) : undefined,
  };
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'user-service' }));

// ─── Public: countries list (for signup country picker) ───────────────────────

const COUNTRY_NAMES: Record<string, string> = {
  FR: 'France', ZA: 'South Africa', CN: 'China', IN: 'India',
};

app.get('/api/v1/countries', (_req: Request, res: Response) => {
  const tenants = db.prepare(
    'SELECT id, region FROM tenants WHERE deleted_at IS NULL ORDER BY region'
  ).all() as Array<{ id: string; region: string }>;
  ok(res, tenants.map(t => ({
    tenantId: t.id,
    name:     COUNTRY_NAMES[t.region] ?? t.region,
    region:   t.region,
  })));
});

// Keep legacy route for backwards compat
app.get('/api/v1/tenants/public', (_req: Request, res: Response) => {
  const tenants = db.prepare(
    'SELECT id, name, region FROM tenants WHERE deleted_at IS NULL ORDER BY name'
  ).all() as object[];
  ok(res, tenants);
});

// ─── Auth: Login ──────────────────────────────────────────────────────────────

app.post('/api/v1/auth/login', (req: Request, res: Response) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL'
  ).get(parsed.data.email) as DbUser | undefined;

  if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash as string)) {
    fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    return;
  }

  ok(res, { token: issueToken(user), user: safeUser(user) });
});

// ─── Auth: Self-register (pilots only) ───────────────────────────────────────

app.post('/api/v1/auth/signup', (req: Request, res: Response) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { email, password, firstName, lastName, tenantId } = parsed.data;

  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ? AND deleted_at IS NULL').get(tenantId);
  if (!tenant) { fail(res, 404, 'TENANT_NOT_FOUND', 'Organisation not found'); return; }

  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 10);

  try {
    db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, booking_authorized, signup_method) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(id, tenantId, email, hash, firstName, lastName, 'PILOT', 0, 'self');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser;
    ok(res, { token: issueToken(user), user: safeUser(user) }, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      fail(res, 409, 'CONFLICT', 'An account with this email already exists for this organisation');
      return;
    }
    throw e;
  }
});

// ─── Auth: Switch company (MANAGER only) ──────────────────────────────────────

app.post('/api/v1/auth/switch-company', authenticate, (req: Request, res: Response) => {
  if (req.user!.role !== 'MANAGER') { fail(res, 403, 'FORBIDDEN', 'Only managers can switch company'); return; }

  const parsed = SwitchCompanySchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { region } = parsed.data;
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.user!.id) as DbUser | undefined;
  if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }

  const managerRegions = parseScope(user.scope as string);
  if (managerRegions !== null && !managerRegions.includes(region)) {
    fail(res, 403, 'REGION_NOT_IN_SCOPE', `Manager does not have access to region ${region}`);
    return;
  }

  const targetTenantId = REGION_TENANT[region];
  if (!targetTenantId) { fail(res, 400, 'INVALID_REGION', 'Unknown region'); return; }

  ok(res, { token: issueToken(user, targetTenantId), region, tenantId: targetTenantId });
});

app.get('/api/v1/auth/me', authenticate, (req: Request, res: Response) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(req.user!.id) as DbUser | undefined;
  if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }
  ok(res, safeUser(user));
});

// ─── Users ────────────────────────────────────────────────────────────────────

app.get('/api/v1/users', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'MANAGER', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const page    = parseInt(req.query.page as string)  || 1;
  const limit   = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset  = (page - 1) * limit;
  const role    = req.query.role as string | undefined;
  const pending = req.query.pending === 'true';

  let where = 'WHERE tenant_id = ? AND deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (role)    { where += ' AND role = ?';               params.push(role); }
  if (pending) { where += ' AND booking_authorized = 0 AND signup_method = ?'; params.push('self'); }

  const users = db.prepare(
    `SELECT id, tenant_id, email, first_name, last_name, role, booking_authorized, signup_method, created_at
     FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as object[];

  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...params) as { count: number };

  ok(res, users, 200, { page, limit, total: count });
});

app.get('/api/v1/users/:id', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'MANAGER', 'INSTRUCTOR'), (req: Request, res: Response) => {
  const user = db.prepare(
    'SELECT id, tenant_id, email, first_name, last_name, role, booking_authorized, signup_method, created_at FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).get(req.params.id, req.user!.tenantId) as object | undefined;
  if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }
  ok(res, user);
});

app.post('/api/v1/users', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { tenantId } = req.user!;
  const { email, password, firstName, lastName, role, managerScope } = parsed.data;
  const id   = randomUUID();
  const hash = bcrypt.hashSync(password, 10);

  // Resolve scope string for DB storage
  const scopeValue = role === 'MANAGER'
    ? (managerScope === 'GLOBAL' ? 'GLOBAL' : JSON.stringify(managerScope))
    : null;

  try {
    db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, role, booking_authorized, signup_method, scope) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(id, tenantId, email, hash, firstName, lastName, role, 1, 'admin', scopeValue);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser;
    ok(res, safeUser(user), 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'Email already exists for this organisation'); return; }
    throw e;
  }
});

// ─── Authorize pilot (admin action) ───────────────────────────────────────────

app.post('/api/v1/users/:id/authorize', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'MANAGER', 'PARTNER_ADMIN'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const now = new Date().toISOString();

  const changes = db.prepare(
    'UPDATE users SET booking_authorized = 1, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).run(now, req.params.id, tenantId);

  if ((changes as { changes: number }).changes === 0) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as DbUser;
  ok(res, safeUser(user));
});

// ─── Revoke pilot booking access (admin action) ───────────────────────────────

app.post('/api/v1/users/:id/revoke', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'MANAGER', 'PARTNER_ADMIN'), (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE users SET booking_authorized = 0, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).run(now, req.params.id, tenantId);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as DbUser;
  if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }
  ok(res, safeUser(user));
});

app.put('/api/v1/users/:id', authenticate, (req: Request, res: Response) => {
  const parsed = UpdateUserSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { tenantId } = req.user!;
  const now = new Date().toISOString();
  const { firstName, lastName, role } = parsed.data;

  db.prepare(
    'UPDATE users SET first_name = COALESCE(?,first_name), last_name = COALESCE(?,last_name), role = COALESCE(?,role), updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL'
  ).run(firstName ?? null, lastName ?? null, role ?? null, now, req.params.id, tenantId);

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(req.params.id, tenantId) as DbUser | undefined;
  if (!user) { fail(res, 404, 'NOT_FOUND', 'User not found'); return; }
  ok(res, safeUser(user));
});

app.delete('/api/v1/users/:id', authenticate, requireRole('GLOBAL_ADMIN', 'COUNTRY_ADMIN'), (req: Request, res: Response) => {
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ? AND tenant_id = ?')
    .run(new Date().toISOString(), req.params.id, req.user!.tenantId);
  res.status(204).end();
});

// ─── Tenants ──────────────────────────────────────────────────────────────────

app.get('/api/v1/tenants', authenticate, requireRole('GLOBAL_ADMIN'), (_req: Request, res: Response) => {
  const tenants = db.prepare('SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY name').all() as object[];
  ok(res, tenants);
});

app.post('/api/v1/tenants', authenticate, requireRole('GLOBAL_ADMIN'), (req: Request, res: Response) => {
  const parsed = CreateTenantSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const id = randomUUID();
  try {
    db.prepare('INSERT INTO tenants (id, name, slug, region, plan) VALUES (?,?,?,?,?)').run(id, parsed.data.name, parsed.data.slug, parsed.data.region, parsed.data.plan);
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as object;
    ok(res, tenant, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('UNIQUE')) { fail(res, 409, 'CONFLICT', 'Slug already taken'); return; }
    throw e;
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/v1/stats', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const total       = (db.prepare('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND deleted_at IS NULL').get(tenantId) as { c: number }).c;
  const pilots      = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = 'PILOT' AND deleted_at IS NULL").get(tenantId) as { c: number }).c;
  const instructors = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = 'INSTRUCTOR' AND deleted_at IS NULL").get(tenantId) as { c: number }).c;
  const pending     = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND role = 'PILOT' AND booking_authorized = 0 AND deleted_at IS NULL").get(tenantId) as { c: number }).c;
  ok(res, { total, pilots, instructors, pending });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[user-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[user-service] ✓  http://localhost:${PORT}`));
