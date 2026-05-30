# AeroCap Architecture

**Status:** Current implementation overview and target architecture guide  
**Last reviewed:** 2026-05-30

## 1. Purpose

AeroCap is a multi-tenant pilot training platform for simulator booking, pilot records, competency-based assessment, training programme management, schedule control, and regulatory reporting.

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
  docs/                Project documentation
  mobile/              Reserved for mobile client work

services/
  user-service/        Tenants, users, roles, login, signup, company switching
  booking-service/     Simulators, slots, reservations, booking rules
  schedule-service/    Operating schedules, blocked periods, maintenance, availability
  cbta-service/        Competency units, assessments, CBTA progress
  hris-service/        Pilot profiles, licences, type ratings, notifications
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

- `/login` and `/signup`
- `/dashboard`
- `/bookings`
- `/schedule`
- `/pilots`
- `/profile`
- `/licences`
- `/cbta`
- `/reports`

The frontend uses two API access patterns:

1. Server components call services directly through `createServiceClient`.
2. Client components call Next.js API proxy routes under `/api/*`.

Proxy routes currently exist for:

- `/api/users/[...path]`
- `/api/booking/[...path]`
- `/api/cbta/[...path]`
- `/api/hris/[...path]`
- `/api/schedule/[...path]`
- `/api/auth/*`

These proxies attach the `aerocap_token` cookie as a Bearer token when calling backend services.

## 5. Service Responsibilities

### user-service

Owns identity-like local data:

- Tenants/countries
- Users
- Roles
- Self-registration
- Login
- Pilot booking authorization
- Manager company switching

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

- `GLOBAL_ADMIN`
- `COUNTRY_ADMIN`
- `MANAGER`
- `CFI`
- `TRE`
- `TRI`
- `INSTRUCTOR`
- `PILOT`

Architectural concern: role unions and auth middleware are duplicated across services and are not fully consistent. A shared auth/roles package should be introduced before adding more authorization-sensitive features.

## 8. Tenant Model

Tenant means training country/facility.

The active tenant is represented by `tenantId` in the JWT. Managers may have access to more than one region and can switch active company/country. Service queries should always filter by `req.user.tenantId`.

Tenant isolation rules:

- Every tenant-owned table has `tenant_id`.
- Every tenant-owned read/write includes `tenant_id`.
- `tenant_id` is not accepted from user request bodies for scoped mutations.
- Cross-tenant access is only allowed through explicit manager/global-admin scope.

## 9. Important Cross-Service Flows

### Signup and approval

1. Public signup loads countries from `user-service`.
2. Pilot chooses a training country.
3. `user-service` creates a `PILOT` user with `booking_authorized = 0`.
4. Pilot can access the dashboard/profile/CBTA/licences.
5. Admin or manager authorizes booking access.
6. Pilot can create reservations.

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

Events should be idempotent and tenant-scoped.

## 12. Current Technical Risks

1. Build instability  
   Some services currently fail TypeScript compilation due to role drift and SQLite result typing.

2. Duplicated auth middleware  
   Each service defines its own JWT parsing and role model. This has already caused inconsistencies.

3. Incomplete schedule-to-booking enforcement  
   Schedule blocks affect calendar visibility but do not yet reliably propagate to booking slots.

4. Persistent local test databases  
   Tests can fail on repeated runs because they reuse service DB files and fixed IDs.

5. Generated artifacts in the project tree  
   `dist`, `.next`, `node_modules`, and SQLite database files are present under the workspace. These should be treated as generated artifacts.

6. Prototype auth  
   The local JWT secret and custom auth model are suitable for development only.

## 13. Recommended Architecture Decisions

Short term:

- Add a shared package for roles, auth types, response envelopes, and pagination.
- Fix all TypeScript build blockers.
- Make service tests use isolated temporary databases.
- Add per-service OpenAPI files.
- Enforce schedule availability inside booking reservation creation.

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
