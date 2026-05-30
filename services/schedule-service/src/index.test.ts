import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, db } from './index';

const SECRET = 'dev-secret-change-in-production';
const TENANT = 'tenant-test';
const SIM_ID = '00000000-0000-4000-a000-000000000001'; // valid UUID for test sim

function token(role = 'COUNTRY_ADMIN', tenantId = TENANT) {
  return jwt.sign({ sub: `user-${role}`, id: `user-${role}`, tenantId, email: 'test@test.com', role }, SECRET, { expiresIn: '1h' });
}
const ADMIN   = token('COUNTRY_ADMIN');
const MANAGER = token('MANAGER');
const PILOT   = token('PILOT');

beforeEach(() => {
  // Delete in FK order: children before parents
  db.exec(`DELETE FROM maintenance_record    WHERE tenant_id = '${TENANT}'`);
  db.exec(`DELETE FROM blocked_period        WHERE tenant_id = '${TENANT}'`);
  db.exec(`DELETE FROM operating_schedule   WHERE tenant_id = '${TENANT}'`);
  db.exec(`DELETE FROM availability_override WHERE tenant_id = '${TENANT}'`);
});

// ─── Health ───────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns ok', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });
});

// ─── Operating Schedules ──────────────────────────────────────────────────────

describe('Operating Schedules', () => {
  const dailyWindows = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i, openTime: '06:00', closeTime: '22:00', isOpen: i >= 1 && i <= 5,
  }));

  it('returns 401 without auth', async () => {
    const r = await request(app).get('/api/v1/operating-schedules');
    expect(r.status).toBe(401);
  });

  it('creates a DRAFT schedule', async () => {
    const r = await request(app)
      .post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ name: 'Test Schedule', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('DRAFT');
    expect(r.body.data.tenant_id).toBe(TENANT);
    expect(r.body.error).toBeNull();
  });

  it('PILOT cannot create a schedule', async () => {
    const r = await request(app)
      .post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${PILOT}`)
      .send({ name: 'Pilot Schedule', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    expect(r.status).toBe(403);
  });

  it('rejects dailyWindows with wrong length', async () => {
    const r = await request(app)
      .post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ name: 'Bad', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows: dailyWindows.slice(0, 5) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('activates a schedule and supersedes the previous one', async () => {
    // Create and activate schedule 1
    const c1 = await request(app).post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ name: 'Sched 1', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    const id1 = c1.body.data.id as string;

    await request(app).post(`/api/v1/operating-schedules/${id1}/activate`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ effectiveFrom: '2026-06-01' });

    // Create and activate schedule 2 — should supersede 1
    const c2 = await request(app).post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ name: 'Sched 2', effectiveFrom: '2026-07-01', timeZone: 'UTC', dailyWindows });
    const id2 = c2.body.data.id as string;

    await request(app).post(`/api/v1/operating-schedules/${id2}/activate`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ effectiveFrom: '2026-07-01' });

    const r1 = await request(app).get(`/api/v1/operating-schedules/${id1}`).set('Authorization', `Bearer ${ADMIN}`);
    const r2 = await request(app).get(`/api/v1/operating-schedules/${id2}`).set('Authorization', `Bearer ${ADMIN}`);

    expect(r1.body.data.status).toBe('SUPERSEDED');
    expect(r2.body.data.status).toBe('ACTIVE');
  });

  it('cannot edit an ACTIVE schedule', async () => {
    const c = await request(app).post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ name: 'Active', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    const id = c.body.data.id as string;

    await request(app).post(`/api/v1/operating-schedules/${id}/activate`)
      .set('Authorization', `Bearer ${ADMIN}`).send({ effectiveFrom: '2026-06-01' });

    const r = await request(app).patch(`/api/v1/operating-schedules/${id}`)
      .set('Authorization', `Bearer ${ADMIN}`).send({ name: 'Modified' });
    expect(r.status).toBe(410);
  });

  it('cannot delete an ACTIVE schedule', async () => {
    const c = await request(app).post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ name: 'Active2', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    const id = c.body.data.id as string;

    await request(app).post(`/api/v1/operating-schedules/${id}/activate`)
      .set('Authorization', `Bearer ${ADMIN}`).send({ effectiveFrom: '2026-06-01' });

    const r = await request(app).delete(`/api/v1/operating-schedules/${id}`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(409);
  });

  it('returns 404 for wrong tenant', async () => {
    const c = await request(app).post('/api/v1/operating-schedules')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ name: 'Mine', effectiveFrom: '2026-06-01', timeZone: 'UTC', dailyWindows });
    const id = c.body.data.id as string;

    const otherToken = token('MANAGER', 'other-tenant');
    const r = await request(app).get(`/api/v1/operating-schedules/${id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(r.status).toBe(404);
  });
});

// ─── Blocked Periods ──────────────────────────────────────────────────────────

describe('Blocked Periods', () => {
  const validBlock = {
    blockType: 'HOLIDAY', title: 'Test Holiday',
    startAt: '2026-12-25T00:00:00.000Z', endAt: '2026-12-25T23:59:59.000Z',
    isPublic: true, affectsSlots: true,
  };

  it('creates a blocked period', async () => {
    const r = await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`).send(validBlock);
    expect(r.status).toBe(201);
    expect(r.body.data.block_type).toBe('HOLIDAY');
    expect(r.body.data.tenant_id).toBe(TENANT);
  });

  it('PILOT cannot create a blocked period', async () => {
    const r = await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${PILOT}`).send(validBlock);
    expect(r.status).toBe(403);
  });

  it('rejects when endAt <= startAt', async () => {
    const r = await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ ...validBlock, endAt: '2026-12-25T00:00:00.000Z' });
    expect(r.status).toBe(400);
  });

  it('prevents overlapping maintenance blocks on same simulator', async () => {
    await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ blockType: 'MAINTENANCE', title: 'First', simulatorId: SIM_ID,
        startAt: '2026-06-10T06:00:00Z', endAt: '2026-06-10T14:00:00Z', isPublic: false, affectsSlots: true });

    const r = await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ blockType: 'MAINTENANCE', title: 'Overlap', simulatorId: SIM_ID,
        startAt: '2026-06-10T08:00:00Z', endAt: '2026-06-10T16:00:00Z', isPublic: false, affectsSlots: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('lists only own-tenant blocks', async () => {
    await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`).send(validBlock);

    const other = token('MANAGER', 'other-tenant');
    const r = await request(app).get('/api/v1/blocked-periods').set('Authorization', `Bearer ${other}`);
    expect(r.body.data.every((b: { tenant_id: string }) => b.tenant_id === 'other-tenant')).toBe(true);
  });

  it('soft-deletes a block', async () => {
    const c = await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${ADMIN}`).send(validBlock);
    const id = c.body.data.id as string;

    await request(app).delete(`/api/v1/blocked-periods/${id}`).set('Authorization', `Bearer ${ADMIN}`);

    const r = await request(app).get(`/api/v1/blocked-periods/${id}`).set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(404);
  });
});

// ─── Maintenance Records ──────────────────────────────────────────────────────

describe('Maintenance Records', () => {
  const validMaint = {
    simulatorId: SIM_ID, maintenanceType: 'SCHEDULED_100H',
    title: '100h Check', plannedStartAt: '2026-07-01T06:00:00Z',
    plannedEndAt: '2026-07-01T14:00:00Z', autoCreateBlockedPeriod: true,
  };

  it('creates maintenance and auto-creates a blocked period', async () => {
    const r = await request(app).post('/api/v1/maintenance')
      .set('Authorization', `Bearer ${ADMIN}`).send(validMaint);
    expect(r.status).toBe(201);
    expect(r.body.data.blocked_period_id).toBeTruthy();

    // The linked blocked_period should exist
    const bp = await request(app)
      .get(`/api/v1/blocked-periods/${r.body.data.blocked_period_id as string}`)
      .set('Authorization', `Bearer ${ADMIN}`);
    expect(bp.status).toBe(200);
    expect(bp.body.data.block_type).toBe('MAINTENANCE');
  });

  it('prevents overlapping maintenance for same simulator', async () => {
    await request(app).post('/api/v1/maintenance').set('Authorization', `Bearer ${ADMIN}`).send(validMaint);

    const r = await request(app).post('/api/v1/maintenance')
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ ...validMaint, title: 'Overlap', plannedStartAt: '2026-07-01T08:00:00Z', plannedEndAt: '2026-07-01T16:00:00Z' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('completes maintenance and shortens the blocked period', async () => {
    const c = await request(app).post('/api/v1/maintenance')
      .set('Authorization', `Bearer ${ADMIN}`).send(validMaint);
    const id = c.body.data.id as string;

    // actualEndAt must be within the planned window (06:00→14:00 on 2026-07-01)
    const r = await request(app).post(`/api/v1/maintenance/${id}/complete`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ completionNotes: 'All checks passed. Simulator back in service.', actualEndAt: '2026-07-01T12:00:00Z' });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('COMPLETED');
    // SQLite stores without .000Z suffix — accept either format
    expect(r.body.data.actual_end_at).toMatch(/2026-07-01T12:00:00/);
  });

  it('cannot complete an already-complete record', async () => {
    const c = await request(app).post('/api/v1/maintenance')
      .set('Authorization', `Bearer ${ADMIN}`).send(validMaint);
    const id = c.body.data.id as string;

    // Complete within the planned window so the blocked_period CHECK constraint is satisfied
    await request(app).post(`/api/v1/maintenance/${id}/complete`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ completionNotes: 'Done first time.', actualEndAt: '2026-07-01T12:00:00Z' });

    const r = await request(app).post(`/api/v1/maintenance/${id}/complete`)
      .set('Authorization', `Bearer ${ADMIN}`)
      .send({ completionNotes: 'Done again.', actualEndAt: '2026-07-01T13:00:00Z' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('ALREADY_COMPLETE');
  });
});

// ─── Availability Check ───────────────────────────────────────────────────────

describe('GET /api/v1/availability', () => {
  it('returns available when no blocks exist', async () => {
    const r = await request(app)
      .get(`/api/v1/availability?simulatorId=${SIM_ID}&startAt=2026-08-01T10:00:00Z&endAt=2026-08-01T14:00:00Z`)
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.status).toBe(200);
    expect(r.body.data.available).toBe(true);
  });

  it('returns unavailable when a blocked period covers the slot', async () => {
    await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ blockType: 'HOLIDAY', title: 'Summer Shutdown',
        startAt: '2026-08-02T00:00:00Z', endAt: '2026-08-02T23:59:59Z',
        isPublic: true, affectsSlots: true });

    const r = await request(app)
      .get(`/api/v1/availability?simulatorId=${SIM_ID}&startAt=2026-08-02T10:00:00Z&endAt=2026-08-02T14:00:00Z`)
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.status).toBe(200);
    expect(r.body.data.available).toBe(false);
    expect(r.body.data.blockType).toBe('HOLIDAY');
  });

  it('returns 400 when endAt <= startAt', async () => {
    const r = await request(app)
      .get(`/api/v1/availability?simulatorId=${SIM_ID}&startAt=2026-08-01T14:00:00Z&endAt=2026-08-01T10:00:00Z`)
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.status).toBe(400);
  });
});

// ─── Calendar ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar', () => {
  it('returns day-by-day grid for the requested range', async () => {
    const r = await request(app)
      .get('/api/v1/calendar?from=2026-09-01&until=2026-09-03')
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(3);
    expect(r.body.data[0].date).toBe('2026-09-01');
  });

  it('marks a day as HOLIDAY when a holiday block covers it', async () => {
    await request(app).post('/api/v1/blocked-periods')
      .set('Authorization', `Bearer ${MANAGER}`)
      .send({ blockType: 'HOLIDAY', title: 'National Day',
        startAt: '2026-09-15T00:00:00Z', endAt: '2026-09-15T23:59:59Z',
        isPublic: true, affectsSlots: true });

    const r = await request(app)
      .get('/api/v1/calendar?from=2026-09-15&until=2026-09-15')
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.body.data[0].status).toBe('HOLIDAY');
  });

  it('rejects ranges exceeding 92 days', async () => {
    const r = await request(app)
      .get('/api/v1/calendar?from=2026-01-01&until=2026-05-01')
      .set('Authorization', `Bearer ${PILOT}`);
    expect(r.status).toBe(400);
  });
});
