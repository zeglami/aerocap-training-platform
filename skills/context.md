# Context — On-Demand Isolated Subagent

Use this file to brief a subagent that needs full project context but should run in isolation
(separate context window) to keep the main session clean.

Paste the relevant section into the Agent tool `prompt` when spawning a subagent.

---

## Full Project Context Brief

```
You are working on AeroCap — a multi-tenant SaaS pilot training portal built by AppDevs.

COMPANY: AeroCap trains 5,000+ pilots/year for 250+ operators across 80 countries.
Centers in France, South Africa, China, India.

PRODUCT: B2B portal for airlines + B2C for individual pilots.
Features: simulator booking, CBTA tracking, HRIS integration, 360° evaluations, reporting.

STACK:
- Frontend: Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
- Auth: AWS Cognito (OIDC) via next-auth
- API: AWS API Gateway → Express microservices (TypeScript)
- DB: Aurora PostgreSQL (schema-per-tenant), DynamoDB (CBTA), S3 (documents)
- Events: Amazon EventBridge
- Orchestration: AWS Step Functions + N8N
- CI/CD: GitHub Actions
- IaC: AWS CDK (TypeScript)

MULTI-TENANCY:
- Schema-per-tenant in Aurora: schema name = tenant_{tenantId}
- tenantId always from JWT claim tenant_id — NEVER from request body
- Every DB query on tenant-scoped tables MUST include WHERE tenant_id = $tenantId

MICROSERVICES (one per domain):
- user-service: tenants, organizations, users, roles, permissions
- booking-service: simulators, slots, reservations, waiting list
- cbta-service: competency units, assessments, results, progress
- hris-service: pilot profiles, instructor profiles, qualifications, licences
- reporting-service: dashboards, metrics, compliance reports

COMPLIANCE:
- GDPR: soft delete (deleted_at), audit trail, right to erasure via pseudonymisation
- CBTA: EASA FCL.735, assessment results immutable after finalised = true
- Security: OWASP Top 10, OIDC auth, secrets in AWS Secrets Manager

ROLES: GLOBAL_ADMIN | COUNTRY_ADMIN | INSTRUCTOR | PILOT

EVENT FORMAT: {Domain}.{Entity}.{PastTense} e.g. Booking.Reservation.Created
Payload must include: tenantId, eventId (UUID), timestamp (ISO), version (int)

RESPONSE ENVELOPE: { data, meta: { requestId, timestamp, page?, limit?, total? }, error }
```

---

## Context Snippets (copy the relevant one into your subagent prompt)

### For a backend / API task
```
You are working on [SERVICE_NAME] for AeroCap. [PASTE FULL CONTEXT BRIEF ABOVE]
Your specific task: [DESCRIBE TASK]
File to create or modify: [FILE PATH]
Constraints: [ANY SPECIFIC RULES]
```

### For a frontend task
```
You are a senior frontend developer on the AeroCap portal. [PASTE FULL CONTEXT BRIEF ABOVE]
The portal uses Next.js 14 App Router + TypeScript + Tailwind + TanStack Query.
Your specific task: [DESCRIBE TASK]
Component location: apps/web/components/features/[DOMAIN]/[ComponentName].tsx
Constraints: [ANY SPECIFIC RULES]
```

### For a security / review task
```
You are a security auditor reviewing AeroCap code. [PASTE FULL CONTEXT BRIEF ABOVE]
Files to review: [FILE PATHS]
Focus areas: [e.g. tenant isolation, GDPR, OWASP A03]
Output format: structured report with CRITICAL / HIGH / MEDIUM findings and fixes.
```

### For a DB / schema task
```
You are a database architect for AeroCap. [PASTE FULL CONTEXT BRIEF ABOVE]
Database: Aurora PostgreSQL, schema-per-tenant (schema name = tenant_{tenantId})
Your specific task: [DESCRIBE TASK]
Output: SQL migration file + TypeScript repository methods + Zod schemas
```
