# Generate Microservice

Generate a complete, production-ready AeroCap microservice scaffold from a plain-language description.

## Usage
```
/generate-microservice <domain> <description>
```
Example: `/generate-microservice booking "Simulator slot reservation with conflict detection and waiting list"`

## What to produce

Given the domain name and description, generate the full file tree for `services/{domain}-service/` following the AeroCap file structure defined in CLAUDE.md.

### Step 1 — Plan
Before writing any code, output:
- List of entities (with fields + types)
- List of API endpoints (method, path, auth required, tenant-scoped)
- List of EventBridge events emitted
- DB schema (tables, columns, indexes)

Ask the user to confirm before proceeding.

### Step 2 — Generate files in this order

1. **`openapi.yaml`** — Full OpenAPI 3.0 spec. Include all endpoints, request/response schemas, security (bearerAuth), and error responses (400, 401, 403, 404, 500).

2. **`src/types/index.ts`** — TypeScript interfaces for all domain entities. Include `tenantId: string` on every entity.

3. **`src/schemas/index.ts`** — Zod schemas for all request bodies and event payloads. Export inferred TypeScript types.

4. **`src/repositories/{entity}.repository.ts`** — One file per entity. All queries MUST include `WHERE tenant_id = $tenantId`. Use parameterized queries (pg library).

5. **`src/services/{domain}.service.ts`** — Business logic. Calls repositories. Publishes EventBridge events on mutations. No direct DB access here.

6. **`src/handlers/{entity}.handler.ts`** — Express route handlers. Extract `tenantId` from `req.user.tenantId` (never from body). Validate input with Zod. Return `{ data, meta, error }` envelope.

7. **`src/events/publisher.ts`** — EventBridge event publisher with typed event payloads.

8. **`src/index.ts`** — Express app setup, middleware (JWT validation, tenant extraction, error handler), route registration.

9. **`migrations/001_init.sql`** — SQL migration. All tables have `tenant_id VARCHAR(36) NOT NULL` and a composite index on `(tenant_id, id)`.

10. **`tests/{entity}.service.test.ts`** — Jest tests for the service layer. Use testcontainers for real DB.

11. **`package.json`** — Dependencies: express, zod, pg, @aws-sdk/client-eventbridge, jsonwebtoken. DevDeps: jest, ts-jest, testcontainers, typescript.

12. **`tsconfig.json`** — Strict mode on. Target ES2022.

## Rules
- Every DB query includes `tenantId` — flag any violation immediately.
- No `any` types.
- Every public function has a TypeScript return type.
- Soft deletes: `deleted_at TIMESTAMP` column on every entity table.
- Audit trail: insert to `audit_log` table on every mutation (who, what, when, tenantId).
