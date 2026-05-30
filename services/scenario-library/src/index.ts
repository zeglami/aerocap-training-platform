import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { createDatabase, txn } from './db';
import { authenticate, requireRole } from './middleware/auth';
import {
  scenarioCreateZ,
  scenarioUpdateZ,
  initialConditionCreateZ,
  injectionCreateZ,
  competencyMappingCreateZ,
  scenarioApproveZ,
  briefTemplateUpsertZ,
  scenarioSearchZ,
} from './schemas';

const PORT = parseInt(process.env.PORT ?? '3008', 10);

const db  = createDatabase();
const app = express();

app.use(express.json({ limit: '2mb' }));
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
    data: null,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

// ─── Row serialisation helpers ─────────────────────────────────────────────────

type RawRow = Record<string, unknown>;

/** Parse JSON text columns and convert SQLite booleans to JS booleans. */
function parseScenarioRow(row: RawRow): RawRow {
  return { ...row };
}

function parseConditionRow(row: RawRow): RawRow {
  return {
    ...row,
    weather:        JSON.parse(row.weather as string),
    ataChapterRefs: JSON.parse(row.ata_chapter_refs as string),
  };
}

function parseInjectionRow(row: RawRow): RawRow {
  return {
    ...row,
    triggerSpec: JSON.parse(row.trigger_spec as string),
  };
}

function parseMappingRow(row: RawRow): RawRow {
  return {
    ...row,
    observableBehaviours: JSON.parse(row.observable_behaviours as string),
  };
}

function parseBriefRow(row: RawRow): RawRow {
  return {
    ...row,
    pilotPrereadRefs: JSON.parse(row.pilot_preread_refs as string),
  };
}

// ─── Scenario lookup helper (tenant-scoped) ───────────────────────────────────

function getScenario(tenantId: string, id: string): RawRow | undefined {
  return db.prepare(
    'SELECT * FROM scenario WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(id, tenantId) as RawRow | undefined;
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'scenario-library', port: PORT });
});

// ─── 1. List scenarios ────────────────────────────────────────────────────────

app.get('/api/v1/scenarios', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const page     = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset   = (page - 1) * pageSize;

  const { aircraftType, category, phaseOfFlight, status } = req.query as Record<string, string>;

  let where = 'WHERE s.tenant_id = ? AND s.deleted_at IS NULL';
  const params: (string | number)[] = [tenantId];

  if (aircraftType)  { where += ' AND s.aircraft_type = ?';     params.push(aircraftType); }
  if (category)      { where += ' AND s.scenario_category = ?'; params.push(category); }
  if (phaseOfFlight) { where += ' AND s.phase_of_flight = ?';   params.push(phaseOfFlight); }
  if (status)        { where += ' AND s.approval_status = ?';   params.push(status); }

  const rows = db.prepare(
    `SELECT * FROM scenario s ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, offset) as RawRow[];

  const { total } = db.prepare(
    `SELECT COUNT(*) AS total FROM scenario s ${where}`,
  ).get(...params) as { total: number };

  ok(res, rows.map(parseScenarioRow), 200, { page, pageSize, total });
});

// ─── 2. Create scenario ───────────────────────────────────────────────────────

app.post(
  '/api/v1/scenarios',
  authenticate,
  requireRole('CFI', 'INSTRUCTOR', 'GLOBAL_ADMIN', 'COUNTRY_ADMIN'),
  (req: Request, res: Response) => {
    const parsed = scenarioCreateZ.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
      return;
    }

    const { tenantId, id: userId } = req.user!;
    const d  = parsed.data;
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO scenario
        (id, tenant_id, code, title, aircraft_type, scenario_category, phase_of_flight,
         minimum_fstd_level, description, duration_minutes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, tenantId, d.code, d.title, d.aircraftType, d.scenarioCategory, d.phaseOfFlight,
      d.minimumFstdLevel, d.description ?? null, d.durationMinutes, userId, now, now,
    );

    const row = db.prepare('SELECT * FROM scenario WHERE id = ?').get(id) as RawRow;
    ok(res, parseScenarioRow(row), 201);
  },
);

// ─── 3. Get scenario by id ────────────────────────────────────────────────────

app.get('/api/v1/scenarios/:id', authenticate, (req: Request, res: Response) => {
  const scenario = getScenario(req.user!.tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }
  ok(res, parseScenarioRow(scenario));
});

// ─── 4. Update scenario ───────────────────────────────────────────────────────

app.patch('/api/v1/scenarios/:id', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  // R-D-3: editing APPROVED scenario returns 410
  if (scenario.approval_status === 'APPROVED') {
    fail(res, 410, 'SCENARIO_APPROVED', 'Approved scenarios cannot be modified. Clone to create a new version.');
    return;
  }

  const parsed = scenarioUpdateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const d   = parsed.data;
  const now = new Date().toISOString();

  const sets: string[]        = ['updated_at = ?'];
  const vals: (string | number | null)[] = [now];

  if (d.title !== undefined)            { sets.push('title = ?');             vals.push(d.title); }
  if (d.description !== undefined)      { sets.push('description = ?');       vals.push(d.description); }
  if (d.durationMinutes !== undefined)  { sets.push('duration_minutes = ?');  vals.push(d.durationMinutes); }
  if (d.minimumFstdLevel !== undefined) { sets.push('minimum_fstd_level = ?'); vals.push(d.minimumFstdLevel); }

  if (sets.length === 1) { ok(res, parseScenarioRow(scenario)); return; }

  db.prepare(
    `UPDATE scenario SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).run(...vals, req.params.id, tenantId);

  const updated = db.prepare('SELECT * FROM scenario WHERE id = ?').get(req.params.id) as RawRow;
  ok(res, parseScenarioRow(updated));
});

// ─── 5. List initial conditions ───────────────────────────────────────────────

app.get('/api/v1/scenarios/:id/initial-conditions', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM scenario_initial_condition WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at',
  ).all(req.params.id, tenantId) as RawRow[];

  ok(res, rows.map(parseConditionRow));
});

// ─── 6. Create initial condition ──────────────────────────────────────────────

app.post('/api/v1/scenarios/:id/initial-conditions', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  // R-D-3: only DRAFT scenarios accept new sub-resources
  if (scenario.approval_status !== 'DRAFT') {
    fail(res, 410, 'SCENARIO_NOT_DRAFT', 'Only DRAFT scenarios can be modified.');
    return;
  }

  // Only one initial condition allowed per scenario
  const existing = db.prepare(
    'SELECT id FROM scenario_initial_condition WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId);
  if (existing) {
    fail(res, 409, 'INITIAL_CONDITION_EXISTS', 'This scenario already has an initial condition. Delete it first or update it.');
    return;
  }

  const parsed = initialConditionCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const d   = parsed.data;
  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO scenario_initial_condition
      (id, tenant_id, scenario_id, airport_icao, runway, weight_kg, fuel_kg, cg_percent,
       weather, ata_chapter_refs, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, req.params.id,
    d.airportIcao, d.runway, d.weightKg, d.fuelKg, d.cgPercent,
    JSON.stringify(d.weather), JSON.stringify(d.ataChapterRefs),
    now, now,
  );

  const row = db.prepare('SELECT * FROM scenario_initial_condition WHERE id = ?').get(id) as RawRow;
  ok(res, parseConditionRow(row), 201);
});

// ─── 7. List injections ───────────────────────────────────────────────────────

app.get('/api/v1/scenarios/:id/injections', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM scenario_injection WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY sequence',
  ).all(req.params.id, tenantId) as RawRow[];

  ok(res, rows.map(parseInjectionRow));
});

// ─── 8. Create injection ──────────────────────────────────────────────────────

app.post('/api/v1/scenarios/:id/injections', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  if (scenario.approval_status !== 'DRAFT') {
    fail(res, 410, 'SCENARIO_NOT_DRAFT', 'Only DRAFT scenarios can be modified.');
    return;
  }

  const parsed = injectionCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const d   = parsed.data;
  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO scenario_injection
      (id, tenant_id, scenario_id, sequence, trigger_type, trigger_spec,
       malfunction_code, description, expected_crew_response, severity, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, req.params.id,
    d.sequence, d.triggerType, JSON.stringify(d.triggerSpec),
    d.malfunctionCode, d.description, d.expectedCrewResponse, d.severity,
    now, now,
  );

  const row = db.prepare('SELECT * FROM scenario_injection WHERE id = ?').get(id) as RawRow;
  ok(res, parseInjectionRow(row), 201);
});

// ─── 9. Soft-delete injection ─────────────────────────────────────────────────

app.delete('/api/v1/scenarios/:id/injections/:injId', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  if (scenario.approval_status !== 'DRAFT') {
    fail(res, 410, 'SCENARIO_NOT_DRAFT', 'Only DRAFT scenario injections can be deleted.');
    return;
  }

  const injection = db.prepare(
    'SELECT id FROM scenario_injection WHERE id = ? AND scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.injId, req.params.id, tenantId);

  if (!injection) { fail(res, 404, 'NOT_FOUND', 'Injection not found'); return; }

  db.prepare(
    'UPDATE scenario_injection SET deleted_at = ?, updated_at = ? WHERE id = ?',
  ).run(new Date().toISOString(), new Date().toISOString(), req.params.injId);

  res.status(204).end();
});

// ─── 10. List competency mappings ─────────────────────────────────────────────

app.get('/api/v1/scenarios/:id/competency-mapping', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const rows = db.prepare(
    'SELECT * FROM scenario_competency_mapping WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY competency_unit_code',
  ).all(req.params.id, tenantId) as RawRow[];

  ok(res, rows.map(parseMappingRow));
});

// ─── 11. Upsert competency mapping ───────────────────────────────────────────

app.post('/api/v1/scenarios/:id/competency-mapping', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const parsed = competencyMappingCreateZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const d   = parsed.data;
  const now = new Date().toISOString();

  // Check if a mapping already exists for this CU code
  const existing = db.prepare(
    'SELECT id FROM scenario_competency_mapping WHERE scenario_id = ? AND tenant_id = ? AND competency_unit_code = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId, d.competencyUnitCode) as { id: string } | undefined;

  let mappingId: string;

  if (existing) {
    // Update existing
    mappingId = existing.id;
    db.prepare(`
      UPDATE scenario_competency_mapping
        SET weight = ?, observable_behaviours = ?, updated_at = ?
      WHERE id = ?
    `).run(d.weight, JSON.stringify(d.observableBehaviours), now, mappingId);
  } else {
    // Insert new
    mappingId = randomUUID();
    db.prepare(`
      INSERT INTO scenario_competency_mapping
        (id, tenant_id, scenario_id, competency_unit_code, weight, observable_behaviours, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(mappingId, tenantId, req.params.id, d.competencyUnitCode, d.weight, JSON.stringify(d.observableBehaviours), now, now);
  }

  const row = db.prepare('SELECT * FROM scenario_competency_mapping WHERE id = ?').get(mappingId) as RawRow;
  ok(res, parseMappingRow(row), existing ? 200 : 201);
});

// ─── 12. Get brief template ───────────────────────────────────────────────────

app.get('/api/v1/scenarios/:id/brief-template', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const row = db.prepare(
    'SELECT * FROM scenario_brief_template WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as RawRow | undefined;

  if (!row) { fail(res, 404, 'NOT_FOUND', 'Brief template not found for this scenario'); return; }
  ok(res, parseBriefRow(row));
});

// ─── 13. Upsert brief template ────────────────────────────────────────────────

app.put('/api/v1/scenarios/:id/brief-template', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;
  const scenario = getScenario(tenantId, req.params.id);
  if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const parsed = briefTemplateUpsertZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const d   = parsed.data;
  const now = new Date().toISOString();

  const existing = db.prepare(
    'SELECT id FROM scenario_brief_template WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
  ).get(req.params.id, tenantId) as { id: string } | undefined;

  let templateId: string;

  if (existing) {
    templateId = existing.id;
    db.prepare(`
      UPDATE scenario_brief_template
        SET brief_markdown = ?, debrief_markdown = ?, instructor_notes = ?,
            pilot_preread_refs = ?, updated_at = ?
      WHERE id = ?
    `).run(d.briefMarkdown, d.debriefMarkdown, d.instructorNotes ?? null, JSON.stringify(d.pilotPrereadRefs), now, templateId);
  } else {
    templateId = randomUUID();
    db.prepare(`
      INSERT INTO scenario_brief_template
        (id, tenant_id, scenario_id, brief_markdown, debrief_markdown, instructor_notes,
         pilot_preread_refs, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(templateId, tenantId, req.params.id, d.briefMarkdown, d.debriefMarkdown, d.instructorNotes ?? null, JSON.stringify(d.pilotPrereadRefs), now, now);
  }

  const row = db.prepare('SELECT * FROM scenario_brief_template WHERE id = ?').get(templateId) as RawRow;
  ok(res, parseBriefRow(row), existing ? 200 : 201);
});

// ─── 14. Approve scenario ─────────────────────────────────────────────────────

app.post(
  '/api/v1/scenarios/:id/approve',
  authenticate,
  requireRole('CFI', 'GLOBAL_ADMIN'),
  (req: Request, res: Response) => {
    const { tenantId, id: userId } = req.user!;
    const scenario = getScenario(tenantId, req.params.id);
    if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

    if (scenario.approval_status === 'APPROVED') {
      fail(res, 409, 'ALREADY_APPROVED', 'Scenario is already approved.');
      return;
    }

    // R-D-2: must have ≥1 competency_mapping
    const mappings = db.prepare(
      'SELECT competency_unit_code FROM scenario_competency_mapping WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).all(req.params.id, tenantId) as RawRow[];

    if (mappings.length === 0) {
      fail(res, 422, 'MISSING_COMPETENCY_MAPPINGS', 'Scenario must have at least one competency mapping before approval.');
      return;
    }

    // R-D-5: EBT category requires ≥3 distinct CU mappings
    if (scenario.scenario_category === 'EBT' && mappings.length < 3) {
      fail(res, 422, 'INSUFFICIENT_EBT_MAPPINGS', 'EBT scenarios require at least 3 distinct competency unit mappings.');
      return;
    }

    const parsed = scenarioApproveZ.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
      return;
    }

    const d   = parsed.data;
    const now = new Date().toISOString();

    txn(db, () => {
      db.prepare(
        `UPDATE scenario SET approval_status = 'APPROVED', authority_approval_ref = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(d.authorityReference, now, req.params.id, tenantId);

      db.prepare(`
        INSERT INTO scenario_approval
          (id, tenant_id, scenario_id, approved_by, approved_at, authority_reference,
           valid_from, valid_until, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(), tenantId, req.params.id,
        userId, now, d.authorityReference,
        d.validFrom, d.validUntil, now, now,
      );
    });

    const updated = db.prepare('SELECT * FROM scenario WHERE id = ?').get(req.params.id) as RawRow;
    ok(res, parseScenarioRow(updated));
  },
);

// ─── 15. Revoke approval ──────────────────────────────────────────────────────

app.post(
  '/api/v1/scenarios/:id/revoke-approval',
  authenticate,
  requireRole('CFI', 'GLOBAL_ADMIN'),
  (req: Request, res: Response) => {
    const { tenantId, id: userId } = req.user!;
    const scenario = getScenario(tenantId, req.params.id);
    if (!scenario) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

    if (scenario.approval_status !== 'APPROVED') {
      fail(res, 409, 'NOT_APPROVED', 'Scenario is not currently approved.');
      return;
    }

    const revokeReason = (req.body as Record<string, string>).revokeReason ?? null;
    const now          = new Date().toISOString();

    txn(db, () => {
      db.prepare(
        `UPDATE scenario SET approval_status = 'DRAFT', updated_at = ? WHERE id = ? AND tenant_id = ?`,
      ).run(now, req.params.id, tenantId);

      // Find the active (non-revoked) approval record and revoke it
      const approval = db.prepare(
        'SELECT id FROM scenario_approval WHERE scenario_id = ? AND tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
      ).get(req.params.id, tenantId) as { id: string } | undefined;

      if (approval) {
        db.prepare(`
          UPDATE scenario_approval
            SET revoked_at = ?, revoked_by = ?, revoke_reason = ?, updated_at = ?
          WHERE id = ?
        `).run(now, userId, revokeReason, now, approval.id);
      }
    });

    const updated = db.prepare('SELECT * FROM scenario WHERE id = ?').get(req.params.id) as RawRow;
    ok(res, parseScenarioRow(updated));
  },
);

// ─── 16. Clone scenario ───────────────────────────────────────────────────────

app.post('/api/v1/scenarios/:id/clone', authenticate, (req: Request, res: Response) => {
  const { tenantId, id: userId } = req.user!;
  const original = getScenario(tenantId, req.params.id);
  if (!original) { fail(res, 404, 'NOT_FOUND', 'Scenario not found'); return; }

  const newId  = randomUUID();
  const now    = new Date().toISOString();
  const newVer = (original.version as number) + 1;

  txn(db, () => {
    // Insert cloned scenario
    db.prepare(`
      INSERT INTO scenario
        (id, tenant_id, code, title, aircraft_type, scenario_category, phase_of_flight,
         minimum_fstd_level, approval_status, version, supersedes_scenario_id, description,
         duration_minutes, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      newId, tenantId,
      original.code, original.title, original.aircraft_type, original.scenario_category,
      original.phase_of_flight, original.minimum_fstd_level,
      'DRAFT', newVer, original.id,
      original.description ?? null, original.duration_minutes,
      userId, now, now,
    );

    // Clone initial conditions
    const conditions = db.prepare(
      'SELECT * FROM scenario_initial_condition WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).all(original.id as string, tenantId) as RawRow[];

    for (const c of conditions) {
      db.prepare(`
        INSERT INTO scenario_initial_condition
          (id, tenant_id, scenario_id, airport_icao, runway, weight_kg, fuel_kg, cg_percent,
           weather, ata_chapter_refs, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(), tenantId, newId,
        c.airport_icao, c.runway, c.weight_kg, c.fuel_kg, c.cg_percent,
        c.weather, c.ata_chapter_refs,
        now, now,
      );
    }

    // Clone injections
    const injections = db.prepare(
      'SELECT * FROM scenario_injection WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY sequence',
    ).all(original.id as string, tenantId) as RawRow[];

    for (const inj of injections) {
      db.prepare(`
        INSERT INTO scenario_injection
          (id, tenant_id, scenario_id, sequence, trigger_type, trigger_spec,
           malfunction_code, description, expected_crew_response, severity, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(), tenantId, newId,
        inj.sequence, inj.trigger_type, inj.trigger_spec,
        inj.malfunction_code, inj.description, inj.expected_crew_response, inj.severity,
        now, now,
      );
    }

    // Clone competency mappings
    const mappings = db.prepare(
      'SELECT * FROM scenario_competency_mapping WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).all(original.id as string, tenantId) as RawRow[];

    for (const m of mappings) {
      db.prepare(`
        INSERT INTO scenario_competency_mapping
          (id, tenant_id, scenario_id, competency_unit_code, weight, observable_behaviours, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(), tenantId, newId,
        m.competency_unit_code, m.weight, m.observable_behaviours,
        now, now,
      );
    }

    // Clone brief template if present
    const brief = db.prepare(
      'SELECT * FROM scenario_brief_template WHERE scenario_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    ).get(original.id as string, tenantId) as RawRow | undefined;

    if (brief) {
      db.prepare(`
        INSERT INTO scenario_brief_template
          (id, tenant_id, scenario_id, brief_markdown, debrief_markdown, instructor_notes,
           pilot_preread_refs, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        randomUUID(), tenantId, newId,
        brief.brief_markdown, brief.debrief_markdown, brief.instructor_notes ?? null,
        brief.pilot_preread_refs, now, now,
      );
    }
  });

  const cloned = db.prepare('SELECT * FROM scenario WHERE id = ?').get(newId) as RawRow;
  ok(res, parseScenarioRow(cloned), 201);
});

// ─── 17. Search scenarios ─────────────────────────────────────────────────────

app.post('/api/v1/scenarios/search', authenticate, (req: Request, res: Response) => {
  const { tenantId } = req.user!;

  const parsed = scenarioSearchZ.safeParse(req.body);
  if (!parsed.success) {
    fail(res, 400, 'VALIDATION_ERROR', parsed.error.errors.map(e => e.message).join('; '));
    return;
  }

  const { competencyUnitCodes, aircraftType, minimumFstdLevel, category } = parsed.data;

  // Build SQLite placeholders for the IN clause
  const cuPlaceholders = competencyUnitCodes.map(() => '?').join(',');

  let where = `
    WHERE s.tenant_id = ?
      AND s.deleted_at IS NULL
      AND s.aircraft_type = ?
      AND EXISTS (
        SELECT 1 FROM scenario_competency_mapping scm
        WHERE scm.scenario_id = s.id
          AND scm.tenant_id = s.tenant_id
          AND scm.deleted_at IS NULL
          AND scm.competency_unit_code IN (${cuPlaceholders})
      )
  `;
  const params: (string | number)[] = [tenantId, aircraftType, ...competencyUnitCodes];

  if (minimumFstdLevel) { where += ' AND s.minimum_fstd_level = ?'; params.push(minimumFstdLevel); }
  if (category)         { where += ' AND s.scenario_category = ?';  params.push(category); }

  const rows = db.prepare(
    `SELECT s.* FROM scenario s ${where} ORDER BY s.created_at DESC`,
  ).all(...params) as RawRow[];

  ok(res, rows.map(parseScenarioRow));
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[scenario-library]', err);
  fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
});

app.listen(PORT, () => console.log(`[scenario-library] ✓  http://localhost:${PORT}`));
