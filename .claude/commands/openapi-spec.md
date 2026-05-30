# OpenAPI Spec Generator

Generate a complete, valid OpenAPI 3.0.3 specification from a plain-language feature description. Output is ready to paste into `openapi.yaml` and import into API Gateway.

## Usage
```
/openapi-spec <service-name> "<feature description>"
```
Example: `/openapi-spec booking "Manage simulator slot reservations: create, update, cancel, list by date range, with waiting list support"`

## What to produce

Generate a full `openapi.yaml` file with:

### Info Section
```yaml
openapi: 3.0.3
info:
  title: AeroCap {ServiceName} API
  version: 1.0.0
  description: ...
servers:
  - url: /api/v1
```

### Security
Always include:
```yaml
securitySchemes:
  bearerAuth:
    type: http
    scheme: bearer
    bearerFormat: JWT
security:
  - bearerAuth: []
```

### Endpoints
For each logical operation in the description, generate:
- `GET /resource` — paginated list (`page`, `limit`, `total` in response)
- `POST /resource` — create
- `GET /resource/{id}` — get by ID
- `PUT /resource/{id}` — full update
- `PATCH /resource/{id}` — partial update
- `DELETE /resource/{id}` — soft delete

Each endpoint must include:
- Summary and description
- Request body schema (for POST/PUT/PATCH)
- Response schemas for: `200`, `201`, `400`, `401`, `403`, `404`, `500`
- Tags for grouping

### Schemas
For every entity:
- `{Entity}` — full entity including `id`, `tenantId`, `createdAt`, `updatedAt`, `deletedAt`
- `Create{Entity}Request` — fields required on creation (no `id`, no `tenantId`)
- `Update{Entity}Request` — all fields optional
- `{Entity}ListResponse` — `{ data: Entity[], meta: { page, limit, total } }`
- `ErrorResponse` — `{ error: { code, message, details? } }`

### Standard Response Envelope
All responses use:
```yaml
data: <schema>
meta:
  requestId: string
  timestamp: string
error: null | { code: string, message: string }
```

## Rules
- Never include `tenantId` in request body schemas — it comes from the JWT.
- UUIDs for all IDs (`format: uuid`).
- Dates use ISO 8601 (`format: date-time`).
- All string fields: add `maxLength` constraints.
- Enum values in UPPER_SNAKE_CASE.
- Mark required fields explicitly in each schema.
- After generating, summarize: endpoint count, schema count, any assumptions made.
