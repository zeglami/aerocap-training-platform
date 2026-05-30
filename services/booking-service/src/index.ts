import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase } from './db';
import { authenticate } from './middleware/auth';
import { CreateReservationSchema, CreateSimulatorSchema, CreateSlotSchema } from './schemas';

const PORT = parseInt(process.env.PORT ?? '3002', 10);

export const db  = createDatabase();
export const app = express();

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

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'booking-service' }));

// ─── Simulators ───────────────────────────────────────────────────────────────

app.get('/api/v1/simulators', authenticate, (req: Request, res: Response) => {
  const sims = db.prepare(
    'SELECT * FROM simulators WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name'
  ).all(req.user!.tenantId) as object[];
  ok(res, sims);
});

app.post('/api/v1/simulators', authenticate, (req: Request, res: Response) => {
  const parsed = CreateSimulatorSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const id = randomUUID();
  const { name, type, aircraft, location, capacity } = parsed.data;
  db.prepare(
    'INSERT INTO simulators (id, tenant_id, name, type, aircraft, location, capacity) VALUES (?,?,?,?,?,?,?)'
  ).run(id, req.user!.tenantId, name, type, aircraft, location, capacity);

  const sim = db.prepare('SELECT * FROM simulators WHERE id = ?').get(id) as object;
  ok(res, sim, 201);
});

// ─── Slots ────────────────────────────────────────────────────────────────────

app.get('/api/v1/slots', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const { simulatorId, date, available } = req.query as Record<string, string>;

  let query = 'SELECT s.*, sim.name AS simulator_name, sim.aircraft FROM slots s JOIN simulators sim ON sim.id = s.simulator_id WHERE s.tenant_id = ?';
  const params: (string | number | null)[] = [tenantId];

  if (simulatorId) { query += ' AND s.simulator_id = ?'; params.push(simulatorId); }
  if (date)        { query += ' AND date(s.start_time) = date(?)'; params.push(date); }
  if (available === 'true') { query += ' AND s.is_available = 1'; }

  query += ' AND s.start_time > ? ORDER BY s.start_time';
  params.push(new Date().toISOString());

  const slots = db.prepare(query).all(...params) as object[];
  ok(res, slots);
});

app.post('/api/v1/slots', authenticate, (req: Request, res: Response) => {
  const parsed = CreateSlotSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const id = randomUUID();
  db.prepare(
    'INSERT INTO slots (id, tenant_id, simulator_id, start_time, end_time) VALUES (?,?,?,?,?)'
  ).run(id, req.user!.tenantId, parsed.data.simulatorId, parsed.data.startTime, parsed.data.endTime);

  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(id) as object;
  ok(res, slot, 201);
});

// ─── Reservations ─────────────────────────────────────────────────────────────

app.get('/api/v1/reservations', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;
  const page   = parseInt(req.query.page as string)  || 1;
  const limit  = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;

  // Pilots only see their own; admins/instructors see all
  const pilotFilter = (role === 'PILOT') ? ' AND r.pilot_id = ?' : '';
  const params: (string | number)[] = role === 'PILOT'
    ? [tenantId, userId, limit, offset]
    : [tenantId, limit, offset];

  const reservations = db.prepare(`
    SELECT r.*, s.start_time, s.end_time, sim.name AS simulator_name, sim.aircraft, sim.location
    FROM reservations r
    JOIN slots s ON s.id = r.slot_id
    JOIN simulators sim ON sim.id = r.simulator_id
    WHERE r.tenant_id = ?${pilotFilter}
    AND r.status != 'CANCELLED'
    ORDER BY s.start_time
    LIMIT ? OFFSET ?
  `).all(...params) as object[];

  const countParams: (string | number)[] = role === 'PILOT' ? [tenantId, userId] : [tenantId];
  const { count } = db.prepare(
    `SELECT COUNT(*) AS count FROM reservations r WHERE r.tenant_id = ?${pilotFilter} AND r.status != 'CANCELLED'`
  ).get(...countParams) as { count: number };

  ok(res, reservations, 200, { page, limit, total: count });
});

app.post('/api/v1/reservations', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: requesterId, role, bookingAuthorized } = req.user!;

  // Pilots must be booking-authorized
  if (!bookingAuthorized && role === 'PILOT') {
    fail(res, 403, 'BOOKING_NOT_AUTHORIZED',
      'Your account is pending administrator approval. You will be able to book once authorized.');
    return;
  }

  const parsed = CreateReservationSchema.safeParse(req.body);
  if (!parsed.success) { fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join(', ')); return; }

  const { slotId, sessionType, notes, forPilotId } = parsed.data;

  // Resolve who the reservation is for
  let pilotId: string;
  if (role === 'PILOT') {
    pilotId = requesterId;
  } else {
    if (!forPilotId) {
      fail(res, 400, 'PILOT_REQUIRED',
        'Administrators and instructors must specify a pilot when creating a reservation.');
      return;
    }
    pilotId = forPilotId;
  }

  const slot = db.prepare(
    'SELECT * FROM slots WHERE id = ? AND tenant_id = ? AND is_available = 1'
  ).get(slotId, tenantId) as Record<string, string> | undefined;

  if (!slot) { fail(res, 409, 'SLOT_UNAVAILABLE', 'Slot is not available'); return; }

  // ── R-8: No pilot double-booking on the same calendar day ─────────────────
  const canOverrideR8 = ['GLOBAL_ADMIN', 'COUNTRY_ADMIN'].includes(role);
  if (!canOverrideR8) {
    const sameDay = db.prepare(`
      SELECT r.id FROM reservations r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.tenant_id = ? AND r.pilot_id = ?
      AND date(s.start_time) = date(?)
      AND r.status = 'CONFIRMED'
    `).get(tenantId, pilotId, slot.start_time);
    if (sameDay) {
      fail(res, 422, 'PILOT_DOUBLE_BOOKING',
        `Pilot already has a confirmed session on ${(slot.start_time as string).slice(0, 10)}. ` +
        'Only one simulator session per day is permitted (ORO.FC fatigue rules).');
      return;
    }
  }

  // ── R-9: LPC/OPC 30-day minimum gap ───────────────────────────────────────
  if (['LPC', 'OPC'].includes(sessionType)) {
    const recentCheck = db.prepare(`
      SELECT s.start_time FROM reservations r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.tenant_id = ? AND r.pilot_id = ?
      AND r.session_type IN ('LPC','OPC')
      AND r.status = 'CONFIRMED'
      AND julianday(s.start_time) > julianday('now') - 30
      ORDER BY s.start_time DESC LIMIT 1
    `).get(tenantId, pilotId) as Record<string, string> | undefined;

    if (recentCheck) {
      const lastDate = (recentCheck.start_time as string).slice(0, 10);
      fail(res, 422, 'CHECK_INTERVAL_VIOLATION',
        `LPC/OPC cannot be scheduled within 30 days of a previous check (last: ${lastDate}).`);
      return;
    }
  }

  // ── R-12: Recency gap warning (FCL.060 — non-blocking) ────────────────────
  const simulator = db.prepare('SELECT * FROM simulators WHERE id = ?').get(slot.simulator_id) as Record<string, string> | undefined;
  let recencyWarning = false;
  if (simulator) {
    const lastSession = db.prepare(`
      SELECT s.start_time FROM reservations r
      JOIN slots s ON s.id = r.slot_id
      WHERE r.tenant_id = ? AND r.pilot_id = ? AND r.simulator_id = ?
      AND r.status = 'CONFIRMED'
      ORDER BY s.start_time DESC LIMIT 1
    `).get(tenantId, pilotId, slot.simulator_id) as Record<string, string> | undefined;

    if (lastSession) {
      const daysSince = (Date.now() - new Date(lastSession.start_time).getTime()) / 86_400_000;
      recencyWarning = daysSince > 90;
    }
  }

  const id = randomUUID();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO reservations
        (id, tenant_id, pilot_id, slot_id, simulator_id, session_type, status, notes,
         session_type_at_booking, simulator_qualification_level_at_booking, recency_warning)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, tenantId, pilotId, slotId, slot.simulator_id, sessionType, 'CONFIRMED',
      notes ?? null, sessionType, simulator?.type ?? null, recencyWarning ? 1 : 0);
    db.prepare('UPDATE slots SET is_available = 0 WHERE id = ?').run(slotId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  const reservation = db.prepare(
    'SELECT r.*, s.start_time, s.end_time, sim.name AS simulator_name FROM reservations r JOIN slots s ON s.id = r.slot_id JOIN simulators sim ON sim.id = r.simulator_id WHERE r.id = ?'
  ).get(id) as object;

  const warnings: { code: string; message: string }[] = [];
  if (recencyWarning && simulator) {
    warnings.push({
      code: 'RECENCY_GAP',
      message: `Pilot has not flown ${simulator.aircraft ?? 'this type'} in the last 90 days. Verify FCL.060 recent experience requirements.`,
    });
  }

  ok(res, { ...reservation as Record<string, unknown>, warnings }, 201);
});

// Slot-cancellation guard: query schedule-service to check for active BlockedPeriod.
// Falls back to true (restore) on any error so cancellation is never blocked by
// an unavailable schedule-service.
async function shouldRestoreSlot(slot: Record<string, string>): Promise<boolean> {
  const scheduleUrl = process.env.SCHEDULE_SERVICE_URL ?? 'http://localhost:3011';
  try {
    const res = await fetch(
      `${scheduleUrl}/api/v1/availability?simulatorId=${slot.simulator_id}&startAt=${encodeURIComponent(slot.start_time)}&endAt=${encodeURIComponent(slot.end_time)}`,
      { headers: { Authorization: 'Bearer dev-internal' } }
    );
    if (!res.ok) return true;
    const json = await res.json() as { data: { available: boolean } };
    return json.data?.available ?? true;
  } catch {
    return true; // schedule-service offline — restore optimistically
  }
}

app.delete('/api/v1/reservations/:id', authenticate, async (req: Request, res: Response) => {
  const { tenantId, id: userId, role } = req.user!;

  const reservation = db.prepare(
    'SELECT * FROM reservations WHERE id = ? AND tenant_id = ?'
  ).get(req.params.id, tenantId) as Record<string, string> | undefined;

  if (!reservation) { fail(res, 404, 'NOT_FOUND', 'Reservation not found'); return; }
  if (role === 'PILOT' && reservation.pilot_id !== userId) {
    fail(res, 403, 'FORBIDDEN', 'You can only cancel your own reservations');
    return;
  }

  // Slot-cancellation guard: only restore is_available if the schedule service
  // confirms the slot window is not covered by an active BlockedPeriod.
  // In dev we optimistically restore unless we can detect an obvious block.
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?')
    .get(reservation.slot_id) as Record<string, string> | undefined;
  const restoreSlot = slot ? await shouldRestoreSlot(slot) : true;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?')
      .run('CANCELLED', new Date().toISOString(), req.params.id);
    if (restoreSlot) {
      db.prepare('UPDATE slots SET is_available = 1 WHERE id = ?').run(reservation.slot_id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  res.status(204).end();
});

// ─── Stats ────────────────────────────────────────────────────────────────────

app.get('/api/v1/stats', authenticate, (_req: Request, res: Response) => {
  const { tenantId } = _req.user!;
  const now = new Date().toISOString();
  const upcoming = (db.prepare(
    "SELECT COUNT(*) AS c FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.tenant_id = ? AND s.start_time > ? AND r.status = 'CONFIRMED'"
  ).get(tenantId, now) as { c: number }).c;

  const totalSims = (db.prepare(
    'SELECT COUNT(*) AS c FROM simulators WHERE tenant_id = ? AND deleted_at IS NULL'
  ).get(tenantId) as { c: number }).c;

  const availableSlots = (db.prepare(
    'SELECT COUNT(*) AS c FROM slots WHERE tenant_id = ? AND is_available = 1 AND start_time > ?'
  ).get(tenantId, now) as { c: number }).c;

  ok(res, { upcomingReservations: upcoming, totalSimulators: totalSims, availableSlots });
});

// ─── Error handler ─────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[booking-service]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[booking-service] ✓  http://localhost:${PORT}`));
}
