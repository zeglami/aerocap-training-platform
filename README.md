# AeroCap Training Platform

AeroCap is a multi-tenant pilot training platform for simulator booking, schedule management, CBTA assessment, pilot records, training programmes, instructor/examiner evidence, and regulatory reporting.

## Scope

The platform is designed around country/facility isolation:

- France / EU: `tenant-demo`
- South Africa: `tenant-za`
- China: `tenant-cn`
- India: `tenant-in`

Each tenant has its own operational scope and data-residency requirements.

## Repository Structure

```text
apps/
  web/       Next.js web portal
  mobile/    Reserved mobile app area

services/    TypeScript Express microservices
specs/       Domain and API specifications
docs/        Architecture, ADR, TOGAF, and functional documentation
compliance/  PII inventory and retention policy
hooks/       Development guardrails
skills/      AeroCap AI-assisted development rules and templates
subagents/   Specialist agent instructions
plugins/     Agent kit packaging metadata
```

## Local Development

Install dependencies:

```bash
npm install
```

Run core services and web app:

```bash
npm run dev:core
```

Run all services:

```bash
npm run dev
```

Build all workspaces:

```bash
npm run build
```

## Documentation

Key documents:

- [Architecture](docs/architecture.md)
- [Functional isolation and data residency](docs/functional-isolation-and-data-residency.md)
- [TOGAF architecture governance](docs/togaf-architecture-governance.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Development agents, hooks, and skills](docs/development-agents-hooks-and-skills.md)
- [PII inventory](compliance/pii-inventory.md)
- [Retention policy](compliance/retention-policy.md)

## Architecture Principles

- Tenant isolation first.
- `tenantId` comes from the authenticated session/JWT, never request bodies.
- Service-owned data with API/event integration.
- Contract-first APIs with OpenAPI and Zod validation.
- Audit trails for privacy and regulatory mutations.
- Regional data residency for regulated pilot data.

## Status

This repository currently represents a local TypeScript prototype and architecture documentation set. The target production direction includes Cognito/OIDC, API Gateway, Aurora PostgreSQL, EventBridge, S3, AWS CDK, and regional data planes.
