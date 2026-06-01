# AeroCap Architecture

**Status:** Current implementation overview and target architecture guide  
**Last reviewed:** 2026-05-30  
**Last updated:** 2026-05-30 — added partner-service (B2B), PARTNER_ADMIN role, split signup flow

## 1. Purpose

AeroCap is a multi-tenant pilot training platform for simulator booking, pilot records, competency-based assessment, training programme management, schedule control, and regulatory reporting.

The product serves two customer models:

- **B2C (Individual pilots):** Self-register, choose a training country, pending manager approval before booking.
- **B2B (Partner organisations):** Airlines, military units, training academies, and corporate operators managed through a dedicated `partner-service`. A `PARTNER_ADMIN` manages their pilot roster and controls booking authorisation for their organisation.

The product supports regional AeroCap training facilities in:

- France (`tenant-demo`, region `FR`)
- South Africa (`tenant-za`, region `ZA`)
- China (`tenant-cn`, region `CN`)
- India (`tenant-in`, region `IN`)

The core architectural rule is tenant isolation: tenant-scoped data must always be filtered by `tenant_id`, and the active tenant must come from the authenticated JWT/session, not from request bodies.

## 2. Repository Layout

```text
apps/
  web/                 Next.js 14 web application
  mobile/              Reserved for mobile client work

docs/                  Project documentation

services/
  user-service/        Tenants, users, roles, login, signup, company switching
  booking-service/     Simulators, slots, reservations, booking rules
  schedule-service/    Operating schedules, blocked periods, maintenance, availability
  cbta-service/        Competency units, assessments, CBTA progress
  hris-service/        Pilot profiles, licences, type ratings, notifications
  partner-service/     B2B partner organisations, memberships, booking authorisation
  training-programmes/ Training programmes, phases, modules, enrolments
  instructor-records/  Instructor qualifications, examiner authorisations
  deficit-tracking/    Competency deficits, remedial actions, reassessments
  scenario-library/    Training scenarios, injections, approvals, brief templates
  regulatory-reports/  Report templates, report runs, snapshots, inspector access
  line-ops-interface/  Line training assignments, sector logs, recency evidence

specs/                 Product and API/domain specifications
compliance/            Data protection and retention notes
subagents/             Project workflow/agent guidance
skills/                Local AeroCap generation templates and rules
```

## 3. Runtime Architecture

### Current local implementation

The current codebase is a local TypeScript monorepo prototype:

- Frontend: Next.js App Router, React, Tailwind
- API services: Express microservices written in TypeScript
- Auth: custom JWT issued by `user-service`
- Database: per-service SQLite files through `node:sqlite`
- Validation: Zod schemas at API boundaries
- Integration: HTTP calls through Next.js API proxy routes and direct server-side service calls
- Tests: Jest/Supertest on selected services

### Target production direction

The project memory describes a production target using:

- AWS Cognito / OIDC for authentication
- Optional SAML SSO for enterprise operators
- API Gateway in front of TypeScript services
- Aurora PostgreSQL with tenant-aware schemas or tenant filters
- DynamoDB and S3 where appropriate
- EventBridge for cross-service events
- Step Functions and N8N for workflow automation
- GitHub Actions and AWS CDK for CI/CD and infrastructure

Until that migration happens, the local implementation should be treated as a functional prototype and dev environment, not the production security architecture.

## 4. Frontend Architecture

`apps/web` is the main user interface.

Key routes:

- `/login` and `/signup` (type-selector: Individual Pilot or Partner Organisation)
- `/dashboard`
- `/bookings`
- `/schedule`
- `/pilots`
- `/partners` and `/partners/[partnerId]` (B2B partner management — MANAGER+, PARTNER_ADMIN)
- `/profile`
- `/licences`
- `/cbta`
- `/reports`

The frontend uses two API access patterns:

1. Server components call services directly through `createServiceClient`.
2. Client components call Next.js API proxy routes under `/api/*`.

Proxy routes currently exist for:

- `/api/users/[...path]`     → user-service    :3001
- `/api/booking/[...path]`   → booking-service  :3002
- `/api/cbta/[...path]`      → cbta-service     :3003
- `/api/hris/[...path]`      → hris-service     :3004
- `/api/schedule/[...path]`  → schedule-service :3011
- `/api/partner/[...path]`   → partner-service  :3012
- `/api/auth/*`              → user-service     :3001

These proxies attach the `aerocap_token` cookie as a Bearer token when calling backend services.

## 5. Service Responsibilities

### user-service

Owns identity-like local data:

- Tenants/countries
- Users
- Roles (`GLOBAL_ADMIN`, `COUNTRY_ADMIN`, `MANAGER`, `INSTRUCTOR`, `PILOT`, `PARTNER_ADMIN`)
- Self-registration (B2C individual pilot flow)
- Login
- Pilot booking authorization (`booking_authorized` flag)
- Manager company switching
- Authorize/revoke booking access — callable by `MANAGER+` and `PARTNER_ADMIN`

Important rule: `tenantId` is encoded in the issued JWT and should drive all downstream tenant filtering.

### booking-service

Owns simulator booking:

- Simulator catalogue
- Raw slots
- Reservations
- Booking authorization checks
- Pilot double-booking prevention
- LPC/OPC 30-day spacing rule
- Recency warning logic

Booking availability must be aligned with `schedule-service`. The current implementation partially integrates schedule data in cancellation/frontend filtering, but reservation creation still primarily checks slot availability in the booking database.

### schedule-service

Owns simulator and facility availability:

- Operating schedules
- Blocked periods
- Maintenance records
- Availability overrides
- Holiday imports
- Calendar read model
- Availability checks
- Schedule audit log

This is the most complete service for the simulator time management specification. The main remaining architectural gap is real propagation of blocked periods into booking slots or an equivalent synchronous availability enforcement path.

### cbta-service

Owns competency-based training assessment:

- Standard competency units
- Instructor assessments
- Per-pilot progress
- Aggregate CBTA stats

Future integration should connect low scores to `deficit-tracking` events.

### hris-service

Owns pilot HR/training records:

- Pilot profiles
- Licences
- Type ratings
- Licence expiry notifications
- HRIS/compliance stats

This data feeds dashboard, licence pages, and reporting.

### training-programmes

Owns structured training curriculum:

- Programmes
- Phases
- Modules
- Prerequisites
- Gate criteria
- Enrolments
- Progress
- Training session records
- Competency assessments

This service is the planned hub for the Functional Training Management Center.

### instructor-records

Owns instructor and examiner validity:

- Instructor records
- Qualifications
- Examiner authorisations
- Instructor training records
- Assignment restrictions

Training, booking, and reporting flows should use this service before assigning instructors or accepting examiner evidence.

### deficit-tracking

Owns remedial follow-up:

- Open deficits
- Remedial actions
- Reassessments
- Escalations
- Waivers

The intended trigger is CBTA or training-session scores below standard.

### scenario-library

Owns training scenarios:

- Scenario definitions
- Initial conditions
- Scenario injections
- Competency mappings
- Approvals
- Brief/debrief templates

This service supports instructor preparation and regulatory evidence.

### regulatory-reports

Owns report production and inspector access:

- Report templates
- Report runs
- Documents
- Pilot compliance snapshots
- Inspector access tokens

This service should become the single audit/reporting interface for inspectors.

### line-ops-interface

Owns line operations evidence:

- Line training assignments
- Sector logs
- Sector assessments
- Line check releases
- Recency events

This is important for FCL.060 and line-training evidence.

### partner-service

Owns B2B partner organisation data (port 3012):

- Partner entities (airlines, military, training academies, corporate, charter)
- Partner memberships — links users to a partner with a role (PILOT, PARTNER_ADMIN, PARTNER_COORDINATOR)
- Booking authorisation managed by PARTNER_ADMIN for their pilot roster
- Partner compliance stats (total members, authorised, pending, suspended)

Key security rule: a `PARTNER_ADMIN` can only read and mutate memberships for the partner they belong to. This is enforced at the DB level by verifying the caller's `user_id` exists in `partner_members` for the target partner before any route handler executes.

When a `PARTNER_ADMIN` authorises or revokes a pilot, `partner-service` calls `user-service` `/authorize` or `/revoke` as a fire-and-forget sync. The `partner_members` table is the local source of truth; the `user-service` flag controls JWT-level booking access.

## 6. Data Architecture

Current local data storage:

- Each service owns its own SQLite database under `services/<service>/db`.
- Each service has its own migrations under `services/<service>/migrations`.
- Many services seed realistic demo data at startup.

Production target:

- Move from SQLite to Aurora PostgreSQL.
- Preserve service ownership boundaries.
- Enforce tenant isolation with either schema-per-tenant, row-level tenant filters, or both.
- Move binary/report assets to S3.
- Use EventBridge for cross-service data propagation.

Data ownership should remain service-local. Other services should access data through APIs or events rather than directly reading another service database.

## 7. Authentication And Authorization

Current flow:

1. User logs in through the web app.
2. Next.js calls `user-service`.
3. `user-service` validates credentials and issues a JWT.
4. Next.js stores the JWT in the `aerocap_token` HTTP-only cookie.
5. Web proxies and server components pass the token to backend services.
6. Each service validates the JWT and reads `tenantId`, `sub`, `role`, and related claims.

Roles currently used across the system include:

| Role | Scope | Description |
|---|---|---|
| `GLOBAL_ADMIN` | All tenants | Platform administration, tenant management |
| `COUNTRY_ADMIN` | One tenant | Manages one AeroCap facility/country |
| `MANAGER` | One or more tenants | Approves pilots, manages schedules, switches country |
| `CFI` | One tenant | Chief Flight Instructor — full training oversight |
| `TRE` | One tenant | Type Rating Examiner — signs and certifies evidence |
| `TRI` | One tenant | Type Rating Instructor — conducts sessions |
| `INSTRUCTOR` | One tenant | Records assessments |
| `PILOT` | One tenant | Books simulators when `bookingAuthorized = true` |
| `PARTNER_ADMIN` | One tenant | Manages a B2B partner org's pilot roster and booking access |

`PARTNER_ADMIN` is the new role added for B2B operators. It is stored in the `users` table via the `PARTNER_ADMIN` value in the role `CHECK` constraint (updated in `user-service/migrations/001_init.sql`).

Architectural concern: auth middleware is still duplicated per service with slightly different `UserRole` type definitions. A shared roles package should be introduced before adding further role-sensitive routes.

## 8. Tenant Model

Tenant means training country/facility.

The active tenant is represented by `tenantId` in the JWT. Managers may have access to more than one region and can switch active company/country. Service queries should always filter by `req.user.tenantId`.

Tenant isolation rules:

- Every tenant-owned table has `tenant_id`.
- Every tenant-owned read/write includes `tenant_id`.
- `tenant_id` is not accepted from user request bodies for scoped mutations.
- Cross-tenant access is only allowed through explicit manager/global-admin scope.

## 9. Important Cross-Service Flows

### Signup and approval — Individual pilot (B2C)

1. `/signup` shows a type-selector: Individual Pilot or Partner Organisation.
2. Pilot selects Individual Pilot and chooses a training country.
3. `user-service` creates a `PILOT` user with `booking_authorized = 0`.
4. Pilot can access the dashboard/profile/CBTA/licences.
5. AeroCap manager or `PARTNER_ADMIN` (if the pilot belongs to a partner) authorises booking access.
6. Pilot can create reservations.

### Signup and approval — Partner organisation (B2B)

1. Operator selects Partner Organisation on the `/signup` type selector.
2. A partnership enquiry form collects organisation details, ICAO code, type, contact, and facility regions needed.
3. Submission is reviewed by AeroCap (in production, sent to a CRM or notification workflow).
4. AeroCap manager creates the partner record via `/partners` and assigns a `PARTNER_ADMIN` user.
5. `PARTNER_ADMIN` logs in, opens `/partners/[id]`, adds pilots from their organisation, and authorises booking access.
6. Pilots in the partner see the standard training portal; `PARTNER_ADMIN` sees the partner dashboard.

### Booking a simulator

1. User selects simulator and slot.
2. Frontend filters slots using schedule calendar data where available.
3. `booking-service` verifies authorization and slot availability.
4. Booking rules run:
   - No same-day pilot double booking unless admin override.
   - LPC/OPC spacing rule.
   - Recency warning generation.
5. Reservation is created and slot is marked unavailable.

Required improvement: reservation creation should synchronously enforce `schedule-service` availability, or blocked-period events should reliably update booking slots before pilots see or book them.

### Maintenance or closure

1. Manager creates a blocked period or maintenance record in `schedule-service`.
2. `schedule-service` records an audit log entry.
3. Calendar and availability APIs reflect the block.
4. Booking slots should be marked unavailable or blocked through an event-driven worker.

Current gap: step 4 is currently represented by log messages and frontend filtering, not a complete backend propagation workflow.

### Training evidence

1. Reservation/session creates training context.
2. Instructor records scenario, simulator, instructor/examiner, and competency evidence.
3. CBTA or training-programmes stores per-competency outcomes.
4. Low scores create deficits.
5. Reports and inspector views aggregate evidence.

This flow is architecturally planned, but not yet fully wired end-to-end.

## 10. API Contracts

Specs contain OpenAPI sections, especially:

- `specs/simulator-time-management-spec.md`
- `specs/training-management-spec.md`
- `specs/functional-training-management-center-spec.md`
- `specs/partner-b2b-spec.md` — Partner entity, PartnerMember, 11 endpoints, PARTNER_ADMIN role, 6 EventBridge events

Recommended source-of-truth structure:

```text
services/<service>/openapi.yaml
```

Each handler change should update the corresponding service contract. This is especially important because many services expose regulatory evidence workflows.

## 11. Events

The target architecture expects EventBridge-style events with:

```json
{
  "tenantId": "tenant-demo",
  "traceId": "uuid",
  "occurredAt": "ISO-8601",
  "schemaVersion": "1.0",
  "payload": {}
}
```

Priority event candidates:

- `BlockedPeriodCreated`
- `BlockedPeriodDeleted`
- `MaintenanceCompleted`
- `ReservationConfirmed`
- `ReservationCancelled`
- `CbtaAssessmentRecorded`
- `TrainingDeficitOpened`
- `TrainingSessionSigned`
- `LicenceExpiringSoon`
- `ReportRunCompleted`
- `PartnerCreated`
- `PartnerSuspended`
- `PartnerMemberAdded`
- `PartnerMemberRemoved`
- `PartnerMemberAuthorized`
- `PartnerMemberRevoked`

Events should be idempotent and tenant-scoped.

## 12. Current Technical Risks

1. Duplicated auth middleware  
   Each service defines its own JWT parsing and role model. `PARTNER_ADMIN` is defined in `partner-service/src/middleware/auth.ts` and `user-service/src/middleware/auth.ts` but not yet in `booking-service`, `cbta-service`, or others. A shared roles package is required before routes in those services need to handle `PARTNER_ADMIN`.

2. Incomplete schedule-to-booking enforcement  
   Schedule blocks affect calendar visibility but do not yet reliably propagate to booking slots. `booking-service` does a synchronous availability check at reservation creation time; the EventBridge consumer that would propagate blocked periods into the booking DB is not yet implemented. This is tracked as ADR-006 (Proposed).

3. Partner-to-user-service sync is fire-and-forget  
   When `PARTNER_ADMIN` authorises a pilot, `partner-service` calls `user-service /authorize` in a try/catch that logs failures. If the call fails, `partner_members.booking_authorized = 1` but the JWT claim remains `bookingAuthorized = false` until the pilot re-authenticates. A reliable event or retry mechanism is needed for production.

4. Persistent local test databases  
   Tests can fail on repeated runs because they reuse service DB files and fixed IDs.

5. Generated artifacts in the project tree  
   `dist`, `.next`, `node_modules`, and SQLite database files are present under the workspace. These should be treated as generated artifacts.

6. Prototype auth  
   The local JWT secret and custom auth model are suitable for development only. Production must migrate to Cognito/OIDC.

## 13. Recommended Architecture Decisions

Short term:

- Add a shared package for roles (`GLOBAL_ADMIN`, `COUNTRY_ADMIN`, `MANAGER`, `INSTRUCTOR`, `PILOT`, `PARTNER_ADMIN`), auth types, response envelopes, and pagination.
- Propagate the updated role list to all service `auth.ts` middleware files.
- Make service tests use isolated temporary databases.
- Add per-service OpenAPI files.
- Enforce schedule availability inside booking reservation creation (close ADR-006).
- Add a reliable retry or EventBridge-backed sync for partner booking-authorization propagation to user-service.

Medium term:

- Replace console-based schedule propagation with an event handler or synchronous service call.
- Add a shared audit/event publisher abstraction.
- Normalize error codes and response metadata across all services.
- Add contract tests between frontend proxies and backend services.

Long term:

- Migrate local JWT to Cognito/OIDC.
- Migrate SQLite to Aurora PostgreSQL.
- Introduce EventBridge for cross-service workflows.
- Move generated reports/documents to S3.
- Add CI checks for build, tests, OpenAPI drift, tenant isolation, and security scans.

## 14. Architecture Principles

- Tenant isolation first.
- Service owns its data.
- APIs and events connect services.
- Regulatory records must be inspectable without reconstructing mutable upstream state.
- Zod validates every external boundary.
- OpenAPI contracts should be kept in sync with handlers.
- Audit trails are required for regulatory mutations.
- Local prototype choices must not leak into production security assumptions.
