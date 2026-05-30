/**
 * AeroCap Microservice Template
 * Copy this file as a starting point for any new service.
 * Replace all occurrences of: Domain, Entity, domain, entity
 */

import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Entity {
  id: string;
  tenantId: string;
  // Add domain fields here
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface ApiResponse<T> {
  data: T | null;
  meta: {
    requestId: string;
    timestamp: string;
    page?: number;
    limit?: number;
    total?: number;
  };
  error: { code: string; message: string } | null;
}

export type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'INSTRUCTOR' | 'PILOT';

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const CreateEntitySchema = z.object({
  // Add fields — tenantId is NOT here, it comes from JWT
});

export const UpdateEntitySchema = CreateEntitySchema.partial();

export type CreateEntityInput = z.infer<typeof CreateEntitySchema>;
export type UpdateEntityInput = z.infer<typeof UpdateEntitySchema>;

// ─── Repository ──────────────────────────────────────────────────────────────

export class EntityRepository {
  constructor(private db: Pool) {}

  async findAll(
    tenantId: string,
    opts: { page: number; limit: number }
  ): Promise<{ rows: Entity[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;

    // CRITICAL: always filter by tenant_id
    const [rows, countResult] = await Promise.all([
      this.db.query<Entity>(
        `SELECT * FROM tenant_${tenantId}.entities
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [opts.limit, offset]
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) FROM tenant_${tenantId}.entities WHERE deleted_at IS NULL`
      ),
    ]);

    return {
      rows: rows.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async findById(tenantId: string, id: string): Promise<Entity | null> {
    const result = await this.db.query<Entity>(
      `SELECT * FROM tenant_${tenantId}.entities
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async create(tenantId: string, data: CreateEntityInput): Promise<Entity> {
    const result = await this.db.query<Entity>(
      `INSERT INTO tenant_${tenantId}.entities (id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING *`,
      [randomUUID(), tenantId]
    );

    await this.writeAuditLog(tenantId, 'CREATE', result.rows[0].id);
    return result.rows[0];
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    await this.db.query(
      `UPDATE tenant_${tenantId}.entities SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );
    await this.writeAuditLog(tenantId, 'DELETE', id);
  }

  private async writeAuditLog(tenantId: string, action: string, entityId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (id, tenant_id, entity_type, entity_id, action, created_at)
       VALUES ($1, $2, 'entity', $3, $4, NOW())`,
      [randomUUID(), tenantId, entityId, action]
    );
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class EntityService {
  constructor(
    private repo: EntityRepository,
    private events: EventBridgeClient
  ) {}

  async list(tenantId: string, opts: { page: number; limit: number }) {
    return this.repo.findAll(tenantId, opts);
  }

  async getById(tenantId: string, id: string): Promise<Entity> {
    const entity = await this.repo.findById(tenantId, id);
    if (!entity) throw new NotFoundError(`Entity ${id} not found`);
    return entity;
  }

  async create(tenantId: string, data: CreateEntityInput): Promise<Entity> {
    const entity = await this.repo.create(tenantId, data);

    await this.publishEvent('Domain.Entity.Created', tenantId, { entityId: entity.id });
    return entity;
  }

  private async publishEvent(
    eventName: string,
    tenantId: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.events.send(
      new PutEventsCommand({
        Entries: [{
          Source: 'aerocap.domain-service',
          DetailType: eventName,
          Detail: JSON.stringify({
            tenantId,
            eventId: randomUUID(),
            timestamp: new Date().toISOString(),
            version: 1,
            ...detail,
          }),
          EventBusName: process.env.EVENT_BUS_NAME,
        }],
      })
    );
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function respond<T>(res: Response, data: T, status = 200, meta: Partial<ApiResponse<T>['meta']> = {}): void {
  res.status(status).json({
    data,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString(), ...meta },
    error: null,
  } satisfies ApiResponse<T>);
}

function respondError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    data: null,
    meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
    error: { code, message },
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function createEntityRouter(service: EntityService) {
  const router = express.Router();

  router.get('/', async (req: Request, res: Response) => {
    const tenantId = req.user!.tenantId; // ALWAYS from JWT middleware
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { rows, total } = await service.list(tenantId, { page, limit });
    respond(res, rows, 200, { page, limit, total });
  });

  router.get('/:id', async (req: Request, res: Response) => {
    const tenantId = req.user!.tenantId;
    const entity = await service.getById(tenantId, req.params.id);
    respond(res, entity);
  });

  router.post('/', async (req: Request, res: Response) => {
    const tenantId = req.user!.tenantId;
    const body = CreateEntitySchema.parse(req.body); // throws ZodError if invalid
    const entity = await service.create(tenantId, body);
    respond(res, entity, 201);
  });

  return router;
}

// ─── Error Classes ────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(message: string) { super(message); }
}

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = 'FORBIDDEN';
  constructor(message: string) { super(message); }
}

// ─── Global Error Handler ────────────────────────────────────────────────────

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof z.ZodError) {
    respondError(res, 400, 'VALIDATION_ERROR', err.errors.map(e => e.message).join(', '));
    return;
  }
  if (err instanceof NotFoundError) {
    respondError(res, 404, err.code, err.message);
    return;
  }
  if (err instanceof ForbiddenError) {
    respondError(res, 403, err.code, err.message);
    return;
  }
  // Never expose internal error details to clients
  console.error('[ERROR]', err);
  respondError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

// ─── App Bootstrap ───────────────────────────────────────────────────────────

export function createApp(service: EntityService): express.Application {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  // app.use(jwtMiddleware);  // Mount your JWT + tenant extraction middleware here

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/entities', createEntityRouter(service));
  app.use(errorHandler);

  return app;
}
