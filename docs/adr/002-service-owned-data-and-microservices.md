# ADR-002: Service-Owned Data And Microservices

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap contains several distinct business domains:

- Identity and tenants
- Simulator booking
- Facility schedules and maintenance
- CBTA assessment
- HRIS/licences
- Training programmes
- Instructor/examiner records
- Deficit tracking
- Scenario library
- Regulatory reports
- Line operations

These domains have different ownership, regulatory responsibilities, and change rates.

## Decision

AeroCap is structured as a set of TypeScript Express microservices. Each service owns its own data model and database schema.

Services should communicate through APIs and events, not direct database access.

Current local implementation uses per-service SQLite databases for development. The target production implementation should use regional managed databases such as Aurora PostgreSQL, while preserving service data ownership.

## Consequences

Benefits:

- Clear domain boundaries.
- Easier compliance review per data domain.
- Smaller services are easier to reason about.
- Service-specific migrations and seeds are simple in development.

Trade-offs:

- Cross-service workflows require API calls or events.
- Shared concepts such as roles, response envelopes, and tenant helpers need shared packages.
- Distributed reporting requires aggregation patterns.
- Local development starts many processes.

Required controls:

- No service should read another service database directly.
- Shared code should be extracted for auth, roles, API envelopes, and tenant helpers.
- Cross-service events must include `tenantId`.
- Service contracts must be documented in OpenAPI.
