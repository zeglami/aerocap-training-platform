# ADR-003: Contract-First APIs And Zod Validation

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap APIs handle regulatory and privacy-sensitive workflows. Unclear request and response contracts create risk for frontend behavior, audits, data retention, and cross-service integration.

The project already contains detailed specifications in `specs/`, including simulator time management and training management contracts.

## Decision

New APIs should be designed contract-first.

Expected pattern:

1. Define the feature in a specification.
2. Produce or update OpenAPI.
3. Define database schema and migrations.
4. Implement Zod validators at the API boundary.
5. Implement handlers using the standard response envelope.
6. Add tests for auth, validation, tenant isolation, and business rules.

Every API response should use:

```json
{
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO-8601"
  },
  "error": null
}
```

## Consequences

Benefits:

- Frontend and backend can align before implementation.
- API behavior is easier to test.
- Validation is explicit and close to the boundary.
- OpenAPI becomes useful for review, code generation, and compliance.

Trade-offs:

- Features take longer to start.
- OpenAPI must be maintained as code changes.
- Existing services need cleanup to add per-service `openapi.yaml` files.

Required controls:

- `tenantId` must not appear in request body schemas for tenant-owned operations.
- All request bodies are validated with Zod.
- All list endpoints are paginated.
- Error responses use standard codes and envelope shape.
