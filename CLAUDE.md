# AeroCap — Project Memory (project.md)
# Lives at: repo root — loaded automatically by Claude Code for this repo only
# Global rules live at: ~/.claude/CLAUDE.md  (see CLAUDE.md/global.md template)
# Architecture rules:   .claude/architecture.rules

## What this project is
Multi-tenant SaaS pilot training portal for AeroCap.
B2B (airlines, military operators) + B2C (individual pilots).
4 regions: France · South Africa · China · India.
Trains 5,000+ pilots/year for 250+ operators across 80 countries.

## Stack at a glance
- Frontend : Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
- Auth     : AWS Cognito (OIDC) via next-auth, optional SAML SSO
- API      : AWS API Gateway → Express microservices (TypeScript)
- DB       : Aurora PostgreSQL (schema-per-tenant) · DynamoDB · S3
- Events   : Amazon EventBridge
- Workflow : AWS Step Functions + N8N
- CI/CD    : GitHub Actions · AWS CDK (TypeScript)

## Domains
- **user**      : Tenant, Organization, User, Role, Permission
- **booking**   : Simulator, Slot, Reservation, WaitingList
- **cbta**      : CompetencyUnit, Assessment, Result, Progress
- **hris**      : PilotProfile, InstructorProfile, Qualification, Licence
- **reporting** : Report, Dashboard, Metric, AuditLog

## Non-negotiables (expanded in .claude/architecture.rules)
1. Every DB query on a tenant table MUST include `tenant_id` filter.
2. `tenantId` always from JWT — never from request body.
3. No `any` types. Strict TypeScript. Zod at every boundary.
4. OpenAPI spec written before any implementation.
5. GDPR/PIPL/DPDP/CCPA/POPIA compliance — see subagents/compliance-auditor.md.

## Available slash commands
- `/generate-microservice` — Scaffold a full domain microservice
- `/cbta-schema`           — CBTA evaluation schema + types + migration
- `/openapi-spec`          — OpenAPI 3.0 spec from plain language
- `/review-tenant-isolation` — Audit multi-tenant isolation

## Agent team
| Agent | Use when |
|---|---|
| spec-generator | Designing a new feature (API + DB schema first) |
| frontend-developer | Building any React/Next.js page or component |
| code-reviewer | Before any PR merge |
| test-runner | Writing Jest + Playwright tests |
| security-auditor | OWASP + auth review on any code change |
| compliance-auditor | Any change touching PII, consent, erasure, cross-border transfers |
| explorer | Mapping an unknown part of the codebase |
