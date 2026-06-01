# TOGAF-Oriented Architecture Governance

**Status:** Architecture governance guide  
**Last reviewed:** 2026-05-30  
**Last updated:** 2026-05-30 — added B2B partner capability, PARTNER_ADMIN actor, Partners data domain  
**Scope:** AeroCap platform architecture, data residency, tenant isolation, and delivery governance

## 1. Purpose

This document maps AeroCap's architecture into a TOGAF-oriented structure. It is not a full enterprise architecture repository, but it gives the project a familiar governance model:

- Architecture vision
- Business architecture
- Data architecture
- Application architecture
- Technology architecture
- Opportunities and migration planning
- Implementation governance
- Architecture change management

The goal is to help product, engineering, compliance, and operations make decisions in a controlled way.

## 2. Architecture Vision

AeroCap is a multi-country pilot training platform for:

- Simulator booking
- Facility and simulator schedule management
- Pilot profiles and licences
- CBTA assessment
- Training programmes
- Instructor/examiner records
- Deficit tracking
- Scenario library
- Line operations evidence
- Regulatory reporting

Architecture vision:

> Provide a regionally isolated, compliance-aware training platform where every tenant's data remains scoped to the correct country, every training record is inspectable, and every critical workflow is governed by explicit API contracts, audit trails, and regulatory evidence rules.

## 3. Architecture Principles

| Principle | Meaning |
|---|---|
| Tenant isolation first | Tenant data must never leak across countries or customers. |
| Data residency by design | Regional data planes must align with GDPR, PIPL, POPIA, and DPDP expectations. |
| Service owns its data | Services expose APIs/events; they do not share databases. |
| Contract-first APIs | OpenAPI and Zod define service boundaries before implementation. |
| Audit by default | Regulatory and privacy-relevant mutations require audit events. |
| Pseudonymise where retention is required | Privacy erasure must not destroy required aviation evidence. |
| Regional runtime, shared source code | The same codebase can run in multiple regions while data remains local. |
| Inspector-ready records | Evidence must answer who, what, where, when, under which authority, and signed by whom. |

## 4. Business Architecture

### Business capabilities

| Capability | Description | Owning services |
|---|---|---|
| Identity and tenant management | Users, roles, tenants, manager switching | `user-service` |
| B2B partner management | Partner organisations, pilot rosters, booking authorisation (B2B) | `partner-service` |
| Simulator booking | Simulators, slots, reservations, booking rules | `booking-service` |
| Time management | Operating schedules, blocked periods, maintenance, availability | `schedule-service` |
| Competency assessment | CBTA units, assessments, progress | `cbta-service` |
| Pilot records | Pilot profile, licences, type ratings, notifications | `hris-service` |
| Training programme management | Programmes, phases, modules, enrolments, session records | `training-programmes` |
| Instructor/examiner validity | Instructor records, qualifications, authorisations | `instructor-records` |
| Remedial training | Deficits, remedial actions, reassessments | `deficit-tracking` |
| Scenario management | Scenarios, injections, approvals, brief templates | `scenario-library` |
| Regulatory reporting | Templates, report runs, snapshots, inspector access | `regulatory-reports` |
| Line operations evidence | Sector logs, line checks, recency events | `line-ops-interface` |

### Business actors

| Actor | Primary needs |
|---|---|
| Pilot | Register (B2C or via partner), view training records, book simulators when authorised, view progress/licences. |
| Instructor | Assess pilots, view assigned sessions, use approved scenarios. |
| Manager | Approve pilots, manage bookings and schedules, switch allowed countries. |
| Country Admin | Operate one country/facility tenant. |
| Global Admin | Platform administration across countries with audit. |
| **Partner Admin** | Manage B2B organisation pilot roster, authorise/revoke booking access, view org compliance stats. |
| Compliance / DPO | Review PII, retention, erasure, cross-border transfers. |
| Inspector / Authority | Access evidence for training, licence, and simulator compliance. |

## 5. Data Architecture

### Data domains

| Domain | Main data | Classification |
|---|---|---|
| Identity | Users, emails, roles, tenant membership | PII |
| Partners | Partner organisations, memberships, booking authorisation | PII (contact data), operational |
| Pilot HRIS | Profiles, licences, medical/ratings | PII, regulatory |
| Booking | Slots, reservations, simulator assignments | Operational, PII-linked |
| Schedule | Closures, maintenance, holidays | Operational |
| CBTA | Scores, notes, competency evidence | PII-linked, regulatory |
| Training programmes | Syllabi, modules, enrolments, session records | Regulatory |
| Instructor records | Qualifications, examiner approvals | PII-linked, regulatory |
| Reports | Compliance snapshots, inspector tokens, exports | PII-linked, regulatory |
| Audit | Actor, action, entity, timestamps | Security, regulatory |

### Data residency model

| Region | Data plane | Tenant |
|---|---|---|
| France / EU | EU data plane | `tenant-demo` |
| China | China data plane | `tenant-cn` |
| South Africa | South Africa or approved regional data plane | `tenant-za` |
| India | India or approved regional data plane | `tenant-in` |

Data rules:

- Tenant-owned records include `tenant_id`.
- Operational data, audit logs, backups, report documents, and exports follow the same residency posture.
- Cross-border access requires role scope, purpose, legal basis where required, and audit logging.
- PII fields are tracked in `compliance/pii-inventory.md`.
- Retention rules are tracked in `compliance/retention-policy.md`.

## 6. Application Architecture

### Current application structure

```text
apps/web
  Next.js web portal
  Routes: /login /signup(type-selector) /dashboard /bookings /schedule
          /partners /partners/[id] /pilots /profile /licences /cbta /reports
  API proxies: /api/users /api/booking /api/cbta /api/hris /api/schedule /api/partner /api/auth

services/
  user-service         :3001  — identity, roles, PARTNER_ADMIN, login, signup, company switching
  booking-service      :3002  — simulators, slots, reservations, booking rules
  cbta-service         :3003  — competency units, assessments, CBTA progress
  hris-service         :3004  — pilot profiles, licences, type ratings
  schedule-service     :3011  — operating schedules, blocked periods, maintenance, availability
  line-ops-interface   :3010  — line training, sector logs, recency evidence
  partner-service      :3012  — B2B partner organisations, memberships, booking authorisation ← NEW
  training-programmes         — programmes, phases, modules, enrolments, FTMC
  instructor-records          — instructor qualifications, examiner authorisations
  deficit-tracking            — competency deficits, remedial actions
  scenario-library            — training scenarios, injections, brief templates
  regulatory-reports          — report templates, snapshots, inspector access

docs/
  Architecture, functional, governance, ADR documentation
  articles/ — published technical articles with screenshots

specs/
  geo-tenancy-spec.md
  simulator-time-management-spec.md
  training-management-spec.md
  functional-training-management-center-spec.md
  partner-b2b-spec.md  ← NEW

compliance/
  PII inventory and retention policy
```

### Integration styles

| Integration | Current usage | Target usage |
|---|---|---|
| HTTP API | Web app to services; service-to-service where needed | Keep for synchronous reads/checks |
| Next.js API proxy | Browser-safe backend access | Keep for web client integration |
| EventBridge events | Planned in specs | Use for propagation, audit workflows, report generation |
| Direct database access | Service-local only | Service-local only |

### Application controls

- APIs use versioned `/api/v1/...` paths.
- Request bodies use Zod validation.
- Authenticated routes read tenant from token claims.
- OpenAPI should exist per service.
- List endpoints should be paginated.
- Errors should use a standard envelope.

## 7. Technology Architecture

### Current local stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React, Tailwind |
| API | Express, TypeScript |
| Auth | Local JWT issued by `user-service` |
| Database | SQLite through `node:sqlite` |
| Validation | Zod |
| Tests | Jest, Supertest |
| Development support | Skills, hooks, subagents, plugins |

### Target production stack

| Layer | Technology direction |
|---|---|
| Identity | AWS Cognito / OIDC, optional SAML SSO |
| API edge | AWS API Gateway |
| Services | TypeScript microservices |
| Relational data | Aurora PostgreSQL, regional deployments |
| Events | Amazon EventBridge |
| Workflows | AWS Step Functions, N8N where appropriate |
| Documents | S3 with regional residency controls |
| Secrets | AWS Secrets Manager |
| Infrastructure | AWS CDK |
| CI/CD | GitHub Actions |

## 8. Opportunities And Solutions

Priority architecture opportunities:

1. Consolidate auth and role definitions into a shared package — now includes `PARTNER_ADMIN` in addition to existing roles.
2. Add service-level OpenAPI files.
3. Enforce schedule availability in booking creation (ADR-006 — Proposed).
4. Replace console-based propagation with EventBridge events and workers.
5. Replace fire-and-forget partner→user-service booking-auth sync with a reliable event or retry mechanism.
6. Move test databases to isolated temporary paths.
7. Add tenant isolation scanners in CI.
8. Add compliance metadata checks for new PII fields (partner contact data added to `compliance/pii-inventory.md`).
9. Plan regional production data planes.
10. Add partner enquiry pipeline — in production the `/signup` partner enquiry form should POST to a CRM webhook or partner-service `inquiries` endpoint rather than returning a static success screen.

## 9. Migration Planning

### Phase 1: Stabilise local prototype

- Make tests deterministic (isolated temp SQLite databases).
- Add per-service OpenAPI files.
- Extract shared auth/roles/envelope utilities — include all roles: `GLOBAL_ADMIN`, `COUNTRY_ADMIN`, `MANAGER`, `INSTRUCTOR`, `PILOT`, `PARTNER_ADMIN`.
- Add backend schedule availability guard for booking creation (close ADR-006).
- Add reliable partner→user-service booking-auth propagation (replace fire-and-forget with EventBridge or retry queue).

### Phase 2: Prepare production architecture

- Define regional deployment topology.
- Create Aurora PostgreSQL migration plan.
- Define Cognito/OIDC tenant and role claims.
- Add EventBridge event contracts.
- Add audit and retention workflows.
- Add CI gates for build, tests, OpenAPI, tenant isolation, and compliance.

### Phase 3: Regional production rollout

- Deploy EU data plane first.
- Deploy China data plane with PIPL controls.
- Deploy South Africa and India data planes.
- Validate backup, logging, and report storage residency.
- Run security and compliance audit before real pilot data import.

## 10. Implementation Governance

### Architecture governance gates

| Gate | Required evidence |
|---|---|
| Feature intake | Business capability, tenant impact, data classification |
| API design | OpenAPI, Zod schemas, response envelope |
| Data design | Migration, tenant_id, PII inventory, retention rule |
| Security review | Auth, role, OWASP, secrets, rate limits |
| Compliance review | GDPR/PIPL/DPDP/POPIA impact, transfer and erasure strategy |
| Test review | Auth tests, tenant isolation tests, validation tests |
| Release review | Build, tests, audit trail, rollback and monitoring plan |

### Architecture board roles

| Role | Responsibility |
|---|---|
| Product Owner | Confirms business capability and user workflow. |
| Lead Engineer | Owns implementation quality and service boundaries. |
| Security Reviewer | Reviews auth, secrets, OWASP, and abuse paths. |
| Compliance / DPO | Reviews PII, retention, transfers, erasure, and notices. |
| Training Domain Owner | Validates aviation regulatory evidence. |
| Operations Owner | Reviews deployment, monitoring, backup, and incident handling. |

## 11. Architecture Change Management

Use ADRs for meaningful decisions. A new ADR is required when a change affects:

- Tenant model
- Data residency
- Authentication or authorization
- Service ownership boundaries
- Event contracts
- Regulatory retention
- Inspector access
- Production infrastructure
- Cross-border data movement

Architecture docs should be updated in the same change when the implementation changes the documented shape of the system.

## 12. Architecture Repository Map

| Area | Document |
|---|---|
| System architecture | [architecture.md](architecture.md) |
| Functional isolation and residency | [functional-isolation-and-data-residency.md](functional-isolation-and-data-residency.md) |
| Development support layer | [development-agents-hooks-and-skills.md](development-agents-hooks-and-skills.md) |
| Decision records | [adr/README.md](adr/README.md) |
| PII inventory | [../compliance/pii-inventory.md](../compliance/pii-inventory.md) |
| Retention policy | [../compliance/retention-policy.md](../compliance/retention-policy.md) |

## 13. TOGAF Alignment Summary

| TOGAF ADM area | AeroCap equivalent |
|---|---|
| Preliminary | Architecture principles, governance roles, agent kit |
| Architecture Vision | Multi-country regulated training platform vision |
| Business Architecture | Capabilities, actors, functional workflows |
| Information Systems Architecture - Data | Tenant model, residency, data domains, PII inventory |
| Information Systems Architecture - Applications | Next.js app and microservices |
| Technology Architecture | Local and target AWS stack |
| Opportunities and Solutions | Stabilisation and production-readiness backlog |
| Migration Planning | Three-phase migration plan |
| Implementation Governance | Review gates and required evidence |
| Architecture Change Management | ADR process and documentation updates |
| Requirements Management | Specs, OpenAPI, compliance docs, ADRs |
