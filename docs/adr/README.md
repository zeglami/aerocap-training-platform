# Architecture Decision Records

**Status:** Living decision log  
**Last reviewed:** 2026-05-30

## Purpose

Architecture Decision Records (ADRs) capture important technical and functional choices for AeroCap. They explain the context, the decision, and the consequences so future contributors understand why the system is shaped the way it is.

ADRs are especially important for AeroCap because the platform combines:

- Multi-tenant SaaS architecture
- Regional data residency
- Aviation regulatory evidence
- Personal data protection
- Microservice boundaries
- AI-assisted development workflows

## ADR Format

Each ADR uses this structure:

```text
# ADR-000: Title

Status: Proposed | Accepted | Superseded | Deprecated
Date: YYYY-MM-DD

## Context
What situation led to the decision?

## Decision
What did we decide?

## Consequences
What improves, what gets harder, and what must be watched?
```

## Decision Index

| ADR | Title | Status |
|---|---|---|
| [ADR-001](001-country-as-tenant-and-data-residency.md) | Country As Tenant And Regional Data Residency | Accepted |
| [ADR-002](002-service-owned-data-and-microservices.md) | Service-Owned Data And Microservices | Accepted |
| [ADR-003](003-contract-first-apis-and-zod-validation.md) | Contract-First APIs And Zod Validation | Accepted |
| [ADR-004](004-authentication-and-tenant-claims.md) | Authentication And Tenant Claims | Accepted |
| [ADR-005](005-audit-retention-and-pseudonymisation.md) | Audit, Retention, And Pseudonymisation | Accepted |
| [ADR-006](006-schedule-availability-as-booking-control.md) | Schedule Availability As Booking Control | Proposed |
| [ADR-007](007-ai-assisted-development-kit.md) | AI-Assisted Development Kit | Accepted |

## When To Add A New ADR

Add an ADR when a decision:

- Changes service boundaries.
- Changes tenant isolation or data residency.
- Adds or changes authentication/authorization behavior.
- Changes regulatory evidence retention.
- Introduces a new infrastructure component.
- Creates a long-term dependency or operational constraint.
- Rejects a plausible alternative that future teams may ask about again.

## Relationship To Other Docs

- Architecture overview: [../architecture.md](../architecture.md)
- Functional isolation and data residency: [../functional-isolation-and-data-residency.md](../functional-isolation-and-data-residency.md)
- Development agents, hooks, and skills: [../development-agents-hooks-and-skills.md](../development-agents-hooks-and-skills.md)
- TOGAF-oriented architecture governance: [../togaf-architecture-governance.md](../togaf-architecture-governance.md)
