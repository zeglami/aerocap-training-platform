---
name: skills
description: AeroCap domain knowledge layer — auto-matched rules for multi-tenancy, TypeScript microservices, EventBridge events, OpenAPI contracts, CBTA compliance, GDPR/PIPL/DPDP/CCPA/POPIA data protection, and AWS infrastructure naming.
---

# AeroCap Skills — Knowledge Layer

This folder is Layer 2 of the AeroCap Agent Development Kit.

Skills are auto-matched by description. When a task description matches a skill's domain,
Claude applies that skill's knowledge automatically — no slash command needed.

---

## Skill: Multi-Tenant Data Access
**Triggers when**: writing any DB query, repository method, or data access code.

Always filter by `tenant_id`. Schema format: `tenant_{tenantId}`.
Never join across tenant schemas. `tenantId` comes from the JWT only — never from request input.
Every mutation writes an audit log entry. Soft delete via `deleted_at`, no hard deletes.

---

## Skill: TypeScript Microservice Scaffold
**Triggers when**: creating a new service, handler, repository, or event file.

Structure: `handlers/` → `services/` → `repositories/` → `events/`.
No direct DB access in service layer. No business logic in handlers.
All inputs validated with Zod at the handler boundary.
All IDs are UUIDs. All list endpoints are paginated. Standard response envelope: `{ data, meta, error }`.

---

## Skill: EventBridge Event Design
**Triggers when**: designing or publishing domain events.

Event name format: `{Domain}.{Entity}.{PastTense}` e.g. `Booking.Reservation.Created`.
Every event payload includes: `tenantId`, `eventId` (UUID), `timestamp` (ISO), `version` (int).
Consumers are idempotent — they handle duplicate delivery safely.
Never use events for synchronous request/response patterns.

---

## Skill: OpenAPI Contract First
**Triggers when**: implementing any new API endpoint.

Write the OpenAPI spec before any implementation code.
Every endpoint has: bearerAuth security, request schema, response schema, 400/401/403/404/500 responses.
`tenantId` never appears in request body schemas — extracted from JWT by middleware.
All IDs use `format: uuid`. Dates use `format: date-time` (ISO 8601).

---

## Skill: CBTA Regulatory Compliance
**Triggers when**: working on assessment, evaluation, competency, or CBTA-related code.

CBTA follows EASA FCL.735 / ICAO Doc 9995 competency framework.
Assessment results are immutable once `finalised = true`. Never allow updates post-finalisation.
Regulatory data (results, grades) must be retained even when a pilot requests GDPR erasure —
apply pseudonymisation to PII fields instead of deletion.
Grades: `NOT_OBSERVED | BELOW_STANDARD | AT_STANDARD | ABOVE_STANDARD`.

---

## Skill: GDPR & Audit Trail
**Triggers when**: handling pilot data, instructor data, or any PII.

PII fields: name, email, licence number, nationality, date of birth, photo URL, assessment results.
Every entity with PII has `deleted_at` (soft delete) and is listed in the PII inventory.
Audit log entry required for: every INSERT, UPDATE, DELETE — record who, what, when, tenantId.
Right to erasure: pseudonymise PII in place, retain structural/regulatory data.
Data minimisation: API responses return only fields needed for the operation.

---

## Skill: React / Next.js Component Patterns
**Triggers when**: building any frontend component, page, or hook.

Default to Server Components. Only `'use client'` when hooks or browser APIs are needed.
Every async component handles 4 states: loading (skeleton), error, empty, data.
No raw `fetch` — use the typed API client in `lib/api/`.
No hardcoded strings — all copy via `useTranslations()` from next-intl.
`tenantId` only from `session.user.tenantId` — never from URL params or component props.

---

## Skill: Multi-Jurisdiction Data Compliance
**Triggers when**: adding a new data field, designing a consent flow, implementing erasure/deletion, designing cross-border data transfers, or building anything that touches pilot PII.

Before writing code, check: Which jurisdictions apply to this data? (FR=GDPR, CN=PIPL, IN=DPDP, ZA=POPIA, CA residents=CCPA)
Tag every PII field in SQL with: `PII:{level} | Laws:{applicable} | Retention:{period} | Erasure:{strategy}`
Never hard-delete pilot data — use pseudonymisation. Regulatory records (CBTA, licence) must be retained 5 years (EASA).
`tenantId` + `jurisdiction` together determine which compliance rules apply to any given record.
Spawn the `compliance-auditor` subagent before any PR that touches: pilot schema, consent, erasure endpoints, cross-border transfer config, or data retention jobs.
Living documents: `compliance/pii-inventory.md`, `compliance/retention-policy.md`.

---

## Skill: AWS Infrastructure Naming
**Triggers when**: creating CDK constructs, IAM policies, resource names, or environment configs.

Resource naming: `aerocap-{env}-{service}-{resource}` e.g. `aerocap-prod-booking-table`.
Environments: `dev | staging | prod`.
Secrets: always in AWS Secrets Manager — never in environment variables or code.
IAM: least-privilege. Each microservice has its own IAM role with minimal permissions.
Tags on every resource: `Project=AeroCap`, `Environment={env}`, `Service={service}`, `ManagedBy=CDK`.
