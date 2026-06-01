# Building a Regulated Multi-Tenant Pilot Training Platform with AI Agents

**Published:** 2026-05-30  
**Author:** Abdelhamid Zeglami  
**Repository:** AeroCap — TypeScript · Next.js · AWS · Multi-tenant

---

## What We Are Building, and Why It Is Harder Than It Looks

AeroCap is the training portal operated by a leading independent simulator training organisation. It serves 5,000+ pilots a year across 250+ airline and military operators in 80 countries.

The platform serves two distinct models: **B2B** — airlines, military operators, and flight training organisations that onboard as tenants, with managers configuring compliance rules, operating schedules, and pilot authorisation; and **B2C** — individual pilots, self-sponsored type rating candidates, and freelance pilots who book directly and own their training records independently. Both models share the same regulated infrastructure — data residency, CBTA evidence requirements, and multi-jurisdiction compliance obligations apply to both.

On the surface, it looks like a booking and records platform. Pilots log in, book simulator time, and view their training records. Managers approve pilots and control facility schedules. Instructors record competency assessments. Inspectors pull reports.

Under the surface, it is a compliance-critical, multi-jurisdiction, multi-tenant system where almost every record has regulatory weight.

- A missed `tenant_id` filter exposes one airline's training records to another.
- A booking confirmed during a maintenance window may be invalid as regulatory evidence.
- A hard-deleted CBTA grade may violate GDPR or PIPL — or destroy evidence an aviation authority needs two years later.
- A cross-border export of pilot identity data without a transfer mechanism may violate PIPL Article 28 or GDPR Chapter 5.

These are not edge cases. They are the baseline. Every engineering decision in AeroCap is shaped by them.

This article documents how we designed and built the platform, the architectural decisions behind it, how we used an AI specialist agent workflow to enforce those decisions, and what a working simulator time management feature looks like end-to-end.

---

## The Four-Tenant World

AeroCap operates across four AWS regions. Each region is a data-residency boundary.

| Region | Tenant ID | Facility | Privacy framework | Data residency target |
|---|---|---|---|---|
| France / EU | `tenant-demo` | AeroCap France | RGPD / GDPR | France or EU data plane |
| South Africa | `tenant-za` | AeroCap South Africa | POPIA | South Africa or approved region |
| China | `tenant-cn` | AeroCap China | PIPL | China data plane |
| India | `tenant-in` | AeroCap India | DPDP Act | India or approved region |

This is not a cosmetic separation. Each framework carries obligations that shape how the platform works:

**GDPR (France/EU):** Lawful basis for each processing activity. Data subject rights including access, correction, erasure, and portability. Transfer restrictions for personal data leaving the EEA — Standard Contractual Clauses or an adequacy decision are required. Erasure requests must be fulfilled without destroying aviation regulatory evidence, which means pseudonymisation rather than hard delete for training records.

**PIPL (China):** Personal information of Chinese nationals must generally be stored in China. Cross-border transfer requires either a Cyberspace Administration of China (CAC) security assessment, a standard contract filed with the CAC, or a certification scheme. PIPL also defines "sensitive personal information" — licence numbers, health/medical data, biometric patterns — that requires explicit consent and additional controls.

**POPIA (South Africa):** Eight lawful processing conditions mirror GDPR structure but carry South Africa-specific obligations. The Information Regulator enforces it. Cross-border transfers require comparable protection in the destination country.

**DPDP Act (India):** India's 2023 Digital Personal Data Protection Act. Data fiduciaries must process personal data for lawful purposes with consent or legitimate use. Cross-border transfers are subject to Central Government notification about permissible countries.

The architectural response to all four frameworks is the same: keep each tenant's data inside its regional data plane, filter every service query by `tenantId`, and never move personal data across regions without a logged justification. This is ADR-001 — the decision that every other decision in the platform builds on.

---

## Architecture Decision Record: Country as Tenant

> **ADR-001 — Country As Tenant And Regional Data Residency**  
> Status: Accepted · Date: 2026-05-30

AeroCap treats each training country/facility as a tenant. The active tenant is the JWT claim `tenantId`. Backend services must use this claim for tenant filtering. Request bodies must never be trusted as tenant authority.

The consequences of this decision are not subtle:

- Every tenant-owned table has a `tenant_id` column.
- Every tenant-owned query includes `WHERE tenant_id = $1` at minimum.
- The application layer injects `tenantId` from `req.jwt` and never from `req.body`.
- Manager company switching issues a new active `tenantId` claim — the manager re-authenticates into their new context.
- Cross-tenant data access by global admins is audited, not silent.

Violating this rule is not a regression. It is a compliance defect. The code review subagent and the PostToolUse lint hook both look for queries that lack `tenant_id` filters.

---

## The Stack

### Current local prototype

The working codebase is a TypeScript monorepo optimised for fast local development and full feature coverage:

- **Frontend:** Next.js 14 App Router · React · Tailwind CSS · shadcn/ui
- **API services:** Express microservices in TypeScript · Zod validation · UUID primary keys
- **Auth:** Custom JWT issued by `user-service` · HTTP-only cookie (`aerocap_token`)
- **Database:** Per-service SQLite through `node:sqlite` · Per-service migrations and seeds
- **Tests:** Jest · Supertest

### Production target

| Layer | Technology |
|---|---|
| Identity | AWS Cognito / OIDC · Optional SAML SSO for enterprise operators |
| API edge | AWS API Gateway |
| Services | TypeScript microservices (same source) |
| Database | Aurora PostgreSQL · Regional deployments |
| Events | Amazon EventBridge · Dead-letter queues for reliability |
| Workflows | AWS Step Functions · N8N |
| Documents | S3 · Regional residency controls |
| Secrets | AWS Secrets Manager |
| Infrastructure | AWS CDK · GitHub Actions CI/CD |

The key principle is: shared source code, regional data. The same service binary runs in every region, but each region's database sees only its own tenant data. A global report requires cross-region aggregation — it is not a natural query, and that is intentional.

---

## Eleven Services, One Platform

```
services/
  user-service/         Tenants, users, roles, login, signup, company switching
  booking-service/      Simulators, slots, reservations, booking rules
  schedule-service/     Operating schedules, blocked periods, maintenance, availability
  cbta-service/         Competency units, assessments, CBTA progress
  hris-service/         Pilot profiles, licences, type ratings, notifications
  training-programmes/  Training programmes, phases, modules, enrolments
  instructor-records/   Instructor qualifications, examiner authorisations
  deficit-tracking/     Competency deficits, remedial actions, reassessments
  scenario-library/     Training scenarios, injections, approvals, brief templates
  regulatory-reports/   Report templates, report runs, snapshots, inspector access
  line-ops-interface/   Line training assignments, sector logs, recency evidence
```

Each service owns its own data model, migrations, and seeds. Services communicate through APIs and events — never through direct database access. This is ADR-002.

The ownership model matters because these domains have different regulatory weight. The `cbta-service` holds competency evidence. The `regulatory-reports` service holds inspector-facing snapshots. These must be independently auditable, independently retentionable, and independently erasable. Putting them in a shared database makes the compliance surface impossible to reason about.

The trade-off is real: cross-service workflows require explicit API calls or EventBridge events. Cross-service reporting requires aggregation patterns. Local development runs many processes. These costs are accepted because the alternative — a shared database — makes the compliance and isolation guarantees fragile.

---

## Architecture Decision Record: Service-Owned Data

> **ADR-002 — Service-Owned Data And Microservices**  
> Status: Accepted · Date: 2026-05-30

Services expose APIs and events. They do not expose their database schema to other services. Cross-service events must include `tenantId`. Shared code for auth, roles, response envelopes, and tenant helpers must be extracted into packages.

This is why `EventBridge` event payloads always look like this:

```json
{
  "tenantId": "tenant-demo",
  "traceId": "a4f2e817-...",
  "occurredAt": "2026-05-30T09:15:00Z",
  "schemaVersion": "1.0",
  "payload": {
    "reservationId": "...",
    "pilotId": "...",
    "simulatorId": "..."
  }
}
```

The `tenantId` is always present, always explicit, and always the same field name. Consumers can always filter on it. Dead-letter queues catch failures and enable retry without data loss.

---

## Contract-First API Development

Every API in AeroCap is written spec-first. The spec produces:

1. OpenAPI 3.0 contract
2. TypeScript interfaces
3. Zod validators
4. Database schema and migrations
5. EventBridge event definitions
6. Acceptance criteria

Then implementation follows. This is ADR-003.

The Zod validators at the API boundary are structural enforcement of the tenant rule. Request body schemas for tenant-owned operations deliberately omit `tenantId`. The TypeScript compiler enforces this — if a developer tries to read `body.tenantId`, the compiler rejects it because the field does not exist in the validated type.

Standard response envelope across all services:

```json
{
  "data": { "..." },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-05-30T09:15:00Z",
    "page": 1,
    "pageSize": 20,
    "total": 142
  },
  "error": null
}
```

Or on error:

```json
{
  "data": null,
  "meta": { "requestId": "uuid", "timestamp": "..." },
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This slot is blocked for maintenance.",
    "detail": { "blockType": "MAINTENANCE", "reason": "Level D recertification" }
  }
}
```

Standardised error codes matter because the frontend maps them to user-visible messages and the compliance team can search audit logs for them.

---

## Authentication and Tenant Claims

The authentication flow in the local prototype:

1. User submits login credentials to the web app.
2. Next.js calls `user-service`.
3. `user-service` validates credentials and issues a JWT containing `tenantId`, `sub` (user ID), `role`, `bookingAuthorized`, and `managerRegions` where applicable.
4. Next.js stores the JWT in an HTTP-only cookie (`aerocap_token`).
5. Server components and API proxy routes read the cookie and pass it as a Bearer token to backend services.
6. Each service validates the JWT and reads claims.

JWT payload shape:

```typescript
interface AeroCapJWTPayload {
  sub: string;               // user ID (UUID)
  tenantId: string;          // active tenant
  role: AeroCapRole;         // PILOT | INSTRUCTOR | MANAGER | COUNTRY_ADMIN | GLOBAL_ADMIN
  bookingAuthorized: boolean; // PILOT only — cleared by manager
  managerRegions?: string[];  // MANAGER only — e.g. ["FR", "ZA"]
  iat: number;
  exp: number;
}
```

Manager company switching issues a new JWT with a new `tenantId`. All service queries for that session will filter by the new tenant. The previous tenant's data is not visible. This is explicit and audited — not a query parameter the manager can manipulate.

This is ADR-004. The production path is Cognito/OIDC with optional SAML SSO so that airline operators can use their existing identity providers and not manage separate AeroCap credentials.

---

## The Roles

```
GLOBAL_ADMIN     → Platform administration across all countries. All access is audited.
COUNTRY_ADMIN    → Manages one country/facility. Approves pilots. Manages local users.
MANAGER          → Scoped to one or more regions. Can switch active country.
CFI              → Chief Flight Instructor. Full training oversight in their tenant.
TRE              → Type Rating Examiner. Can sign and certify training evidence.
TRI              → Type Rating Instructor. Conducts training sessions.
INSTRUCTOR       → General instructor role. Records assessments.
PILOT            → Books simulators (when authorized). Views own training record.
```

The `PILOT` role has a secondary flag: `bookingAuthorized`. A pilot who self-registers is `bookingAuthorized = false`. They can log in, view their profile, and plan — but they cannot book. A manager must explicitly authorize booking access, which is a deliberate gate: it ensures the airline's training manager has acknowledged the pilot in the system before simulator time is reserved.

The pilot profile page aggregates the pilot's training record into a single view: total flight hours, simulator hours logged on AeroCap, current CBTA average score, upcoming booked sessions, all active licences and certificates with expiry status, type ratings, and personal details. Licence alerts surface immediately in the header if any certification requires action.

![Pilot profile — licences, type ratings, CBTA summary, and flight hours](screenshots/09-pilot-profile.png)

The `MANAGER` role sees a different top-level control: the company switcher in the sidebar. A manager scoped to multiple regions (for example, `["FR", "ZA"]`) can switch active context between them. Switching issues a new JWT with the selected `tenantId` — all service queries re-scope to the new tenant. A global manager with access to all four regions sees all country options in the picker.

![Manager sidebar — company switcher open with all four regions](screenshots/10-company-switcher.png)

---

## The Compliance Layer

The platform's compliance documentation lives in `compliance/`:

```
compliance/
  pii-inventory.md      → Every personal data field, sensitivity, law, retention, erasure strategy
  retention-policy.md   → How long each data category is kept and what happens after
```

The PII inventory is the practical Record of Processing Activities (ROPA) for engineering. Before a developer adds a new database column that holds personal data, they check the inventory. If it is new PII, they add it with metadata:

```sql
COMMENT ON COLUMN pilot_profiles.passport_number IS
  'PII:HIGH | Laws:GDPR,PIPL,DPDP,POPIA | Retention:5Y | Erasure:pseudonymise';
```

This tag makes the field findable in a compliance scan. It makes the erasure strategy explicit at the schema level. It means the developer, the reviewer, and the compliance auditor are all reading from the same source.

The retention policy resolves the hardest compliance tension in aviation training: a pilot may have a right to erasure under GDPR, but a CBTA assessment result signed by an examiner may need to be kept for regulatory inspection for years. The resolution is pseudonymisation — replace the pilot's name and identifier with an anonymised token in the training record, preserve the structural evidence, and document that the identifier has been replaced. The aviation authority can still inspect the competency result; the personal identifier is gone.

This is ADR-005.

The Reports & Compliance dashboard gives managers and admins a real-time operational view: licence compliance rate across all pilots, count of expired licences flagged for immediate action, licences expiring within 30 and 90 days, CBTA assessment averages, upcoming simulator sessions, and total simulator hours. A red alert banner fires whenever expired licences are present — pilots with expired licences may not be legally authorised to operate.

![Reports & Compliance dashboard — KPI grid, licence expiry table, CBTA overview](screenshots/08-reports-compliance.png)

---

## The AI Development Kit

AeroCap uses a structured AI-assisted development kit to keep the engineering consistent. This is not prompt-engineering as a side activity — it is a first-class part of the project structure, documented in ADR-007.

### Three layers

**Subagents — specialist collaborators:**

| Subagent | Role |
|---|---|
| `spec-generator` | Turns a feature idea into a full contract before any implementation |
| `training-management` | Aviation domain specialist — validates rules against EASA/FAA/ICAO/SACAA |
| `backend-developer` | TypeScript/Express microservice engineer |
| `frontend-developer` | Next.js and product UI specialist |
| `test-runner` | Jest and Supertest test coverage |
| `code-reviewer` | Pre-merge review for correctness, tenant isolation, and security |
| `security-auditor` | OWASP, JWT, auth, secrets, rate limits |
| `compliance-auditor` | GDPR/PIPL/DPDP/POPIA — maps obligations to engineering controls |
| `explorer` | Codebase mapper — finds related files and tenant-sensitive paths |

**Skills — standing project rules:**

- Multi-tenant data access rules
- TypeScript microservice scaffold pattern
- EventBridge event design
- OpenAPI contract-first rule
- CBTA regulatory compliance
- GDPR audit trail requirements
- React/Next.js component patterns
- Multi-jurisdiction data compliance
- AWS infrastructure naming conventions

**Hooks — automation around tool usage:**

- `SessionStart.sh` — prints project context, stack, regions, and active guardrails at session start
- `PreToolUse.sh` — blocks `rm -rf`, `DROP TABLE`, `DROP DATABASE`, `git reset --hard`, force pushes, and direct production operations before they run
- `PostToolUse.sh` — auto-lints TypeScript after writes, runs co-located tests when a matching test file exists, reminds developers to update OpenAPI when handlers change

The hooks are local safety rails, not a CI/CD replacement. They make the obvious mistakes hard to make accidentally during AI-assisted development sessions. They are why `DROP TABLE reservations` is blocked before it runs, not after.

### The feature delivery workflow

```
1. Describe the feature.
2. spec-generator produces the contract (entities, schema, OpenAPI, Zod, events, edge cases).
3. training-management validates against aviation domain rules.
4. backend-developer implements models, APIs, migrations, authorization.
5. frontend-developer implements operational screens and user flows.
6. test-runner adds auth, validation, tenant isolation, and business rule tests.
7. code-reviewer checks correctness, tenant isolation, and architecture alignment.
8. security-auditor reviews auth, OWASP, and privilege paths.
9. compliance-auditor checks PII, retention, audit, and transfer implications.
10. Hooks run continuously throughout — lint, test, guardrails.
```

The key property of this workflow is that each agent has a narrow job. The `spec-generator` does not know what good aviation evidence looks like. The `training-management` agent does not write Express routes. The `code-reviewer` does not perform compliance analysis. Independence produces better results than a single over-loaded agent.

---

## A Worked Example: Simulator Time Management

The most complete implementation in the current codebase is simulator time management. It shows every layer of the architecture working together.

### The problem

Simulator booking looks like a calendar problem. In AeroCap it is a compliance, safety, and tenant-isolation problem.

Every booking must pass:

1. Is the simulator open under the active operating schedule?
2. Is the facility closed for a public or national holiday?
3. Is the simulator blocked for maintenance or authority inspection?
4. Does the pilot have `bookingAuthorized = true`?
5. Is another reservation already confirmed for this slot?
6. Is the pilot's session type inside the required spacing (OPC/LPC minimum 60 days)?
7. Is the booking inside the pilot's tenant?

A booking that passes all seven questions is valid. A booking that fails any one is refused by the API — not warned about after the fact, refused before it is created.

### Step 1 — Specification

The `spec-generator` produced `specs/simulator-time-management-spec.md`. Its most important outputs:

**Entity ownership split:**

`schedule-service` owns facility-level time:
- `OperatingSchedule` — regular opening windows (day-of-week, time range, effective dates)
- `BlockedPeriod` — closures: holiday, maintenance, inspection, weather, special event
- `MaintenanceRecord` — simulator-specific downtime
- `AvailabilityOverride` — exceptional openings that override a blocked period

`booking-service` owns crew-level time:
- `Simulator` — physical unit with type and level (FFS Level D, FTD, FNPT)
- `Slot` — pre-computed time window on a simulator
- `Reservation` — a confirmed pilot booking
- `WaitingList` — queue when a slot is taken

**Availability resolution algorithm** — a priority-ordered check, not a flag:

```
1. Active OperatingSchedule covers this window?   No  → UNAVAILABLE (closed)
2. BlockedPeriod overlaps this window?             Yes → BLOCKED (returns type + reason)
3. MaintenanceRecord on this simulator overlaps?   Yes → MAINTENANCE
4. AvailabilityOverride opens this window?         Yes → OVERRIDE_OPEN (beats the block)
5. Existing confirmed Reservation on this slot?    Yes → ALREADY_BOOKED
6.                                                 → AVAILABLE
```

**The tenant rule, made structural:**

```typescript
// tenantId is deliberately absent from all request body schemas
const CreateBlockedPeriodSchema = z.object({
  simulatorId: z.string().uuid().optional(),
  type: z.enum(['HOLIDAY', 'MAINTENANCE', 'INSPECTION', 'WEATHER', 'SPECIAL_EVENT']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  reason: z.string().min(3).max(500),
  affectsAllSimulators: z.boolean().default(false),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: 'endDate must be after startDate', path: ['endDate'] }
);
```

The TypeScript type derived from this schema has no `tenantId` field. Attempting to read `body.tenantId` fails to compile.

### Step 2 — Domain Validation

The `training-management` agent reviewed the spec against aviation training regulations and found three gaps:

**Gap 1: Authority inspection periods need evidence impact metadata.**

The spec had `INSPECTION` in the `BlockedPeriod` type enum. Correct for availability. But an inspection block needs to carry which regulatory authority ordered it and whether sessions run during the window can count as regulatory evidence.

Fix — two additional fields:

```typescript
regulatoryBody: z.string().max(50).optional(), // EASA, JAA, GCAA, DGAC, etc.
evidenceImpact: z.enum(['NONE', 'VOID', 'REQUIRES_REVIEW']).default('NONE'),
```

A session run on a simulator under EASA inspection can be marked `evidenceImpact: 'VOID'`. Compliance reports can filter on this. The authority inspector can see the window and the status.

**Gap 2: OPC/LPC spacing belongs in booking-service, not schedule-service.**

Session-type spacing (a pilot's OPC sessions must be at least 60 days apart) is a per-pilot rule, not a facility rule. The schedule service does not know which pilot is booking which session type. The booking service does. Misplacing this logic in the schedule service would have made it impossible to enforce without cross-service queries in the wrong direction.

**Gap 3: The 14-day calendar is too short for type rating programmes.**

Type rating training can span 90+ days. Pilots on long programmes would have to navigate the 14-day strip week by week. The calendar API was extended to support a `programme` mode:

```
GET /schedule/calendar?simulatorId=<id>&mode=rolling&days=14
GET /schedule/calendar?simulatorId=<id>&mode=programme&programmeId=<id>
```

The programme mode returns availability for the pilot's entire training window at once, based on the enrolled programme's duration.

### Step 3 — Backend Implementation

**Booking creation with all seven checks:**

```typescript
router.post('/', jwtMiddleware, async (req, res) => {
  const { tenantId, userId, role } = req.jwt;  // tenantId from JWT only

  const body = CreateReservationSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }

  // Check 1: pilot booking authorization
  const pilot = await db.pilotProfile.findFirst({
    where: { userId, tenantId },
  });
  if (!pilot?.bookingAuthorized && !['MANAGER','ADMIN','CFI','TRI','TRE'].includes(role)) {
    return res.status(403).json({
      code: 'BOOKING_NOT_AUTHORIZED',
      message: 'Your account is pending manager approval for simulator booking.',
    });
  }

  // Check 2-5: schedule availability (synchronous call to schedule-service)
  const availability = await scheduleClient.checkAvailability({
    tenantId,
    simulatorId: body.data.simulatorId,
    slotId: body.data.slotId,
    startTime: body.data.startTime,
    endTime: body.data.endTime,
  });

  if (availability.status !== 'AVAILABLE' && availability.status !== 'OVERRIDE_OPEN') {
    return res.status(409).json({
      code: 'SLOT_UNAVAILABLE',
      reason: availability.status,
      detail: availability.reason ?? null,
    });
  }

  // Check 6: OPC/LPC spacing rule
  if (body.data.sessionType && ['OPC', 'LPC'].includes(body.data.sessionType)) {
    const recentSession = await db.reservation.findFirst({
      where: {
        tenantId,
        pilotId: userId,
        sessionType: body.data.sessionType,
        startTime: { gte: subDays(new Date(), 60) },
        status: 'CONFIRMED',
      },
    });
    if (recentSession) {
      return res.status(409).json({
        code: 'SESSION_TYPE_SPACING_VIOLATION',
        message: `${body.data.sessionType} sessions must be at least 60 days apart.`,
        lastSession: recentSession.startTime,
      });
    }
  }

  // Check 7: atomic reservation — partial unique index prevents race condition
  try {
    const reservation = await db.reservation.create({
      data: { tenantId, pilotId: userId, ...body.data, status: 'CONFIRMED' },
    });

    await eventBridge.putEvents({
      Entries: [{
        Source: 'aerocap.booking-service',
        DetailType: 'ReservationCreated',
        Detail: JSON.stringify({ tenantId, reservationId: reservation.id }),
      }],
    });

    return res.status(201).json(reservation);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      return res.status(409).json({
        code: 'SLOT_ALREADY_BOOKED',
        message: 'Another booking was confirmed for this slot while you were completing the form.',
      });
    }
    throw err;
  }
});
```

**Race-safe double-booking prevention — at the database level:**

```sql
CREATE UNIQUE INDEX idx_reservations_slot_active
  ON reservations (slot_id)
  WHERE status IN ('CONFIRMED', 'PENDING');
```

A partial unique index means the database engine rejects two concurrent confirmed or pending bookings for the same slot atomically, regardless of whether the application-level check ran concurrently. This is the correct place to enforce this constraint — not an optimistic lock, not a transaction retry loop.

**Blocked periods table with the evidence impact fields added by the domain review:**

```sql
CREATE TABLE blocked_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  simulator_id    UUID REFERENCES simulators(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
    'HOLIDAY','MAINTENANCE','INSPECTION','WEATHER','SPECIAL_EVENT'
  )),
  start_date      TIMESTAMPTZ NOT NULL,
  end_date        TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL,
  affects_all     BOOLEAN NOT NULL DEFAULT FALSE,
  regulatory_body TEXT,
  evidence_impact TEXT NOT NULL DEFAULT 'NONE' CHECK (
    evidence_impact IN ('NONE','VOID','REQUIRES_REVIEW')
  ),
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT end_after_start CHECK (end_date > start_date)
);

-- Calendar read model performance
CREATE INDEX idx_blocked_periods_tenant_dates
  ON blocked_periods (tenant_id, start_date, end_date);

-- Simulator-specific availability queries
CREATE INDEX idx_blocked_periods_simulator
  ON blocked_periods (simulator_id, start_date, end_date)
  WHERE simulator_id IS NOT NULL;
```

The composite index on `(tenant_id, start_date, end_date)` is the difference between the pilot calendar loading in 40ms and 4 seconds on a tenant with three years of blocked period history.

### Step 4 — Frontend Implementation

The frontend produces two distinct experiences, separated by role.

#### The Manager View: `/schedule`

Managers and admins use `/schedule` to control facility time. It has three tabs.

**Blocked Periods** — A table of current and future blocked periods colour-coded by type (holiday, maintenance, inspection, weather, special event). Admins can create and delete. Managers can create but not delete — deletion is admin-only because a deleted blocked period may already be linked to reservation conflicts that need audit context.

![Manager schedule — blocked periods](screenshots/01-schedule-blocked-periods.png)

When a manager creates an `INSPECTION` blocked period, the form reveals the `regulatoryBody` and `evidenceImpact` fields added during the domain validation step. A warning appears: sessions during an authority inspection window may not be accepted as regulatory evidence.

**Maintenance** — A list of maintenance records linked to specific simulator units. Creating a maintenance record automatically projects a blocked period for that simulator's time window. The pilot calendar sees the block without knowing whether it came from a direct blocked period or from a maintenance record.

![Manager schedule — maintenance records](screenshots/02-schedule-maintenance.png)

**Operating Schedules** — A weekly grid of facility opening windows. Each entry covers a day-of-week set, a time range, and optional effective-from/effective-until dates. The global manager view shows all simulators; the tenant-scoped view shows only the manager's operator.

![Manager schedule — operating schedules](screenshots/03-operating-schedules.png)

#### The Pilot View: `/bookings`

Pilots use `/bookings` to find and book available simulator time.

**14-day availability strip** — A horizontal date strip for a selected simulator. Each day is colour-coded from the calendar read model — green for available, amber for partial/override, grey for closed (no operating schedule), red for blocked.

The colour state is server-derived. The frontend does not re-implement the availability resolution algorithm. It renders what the API returns. This means a frontend change cannot accidentally create a visual mismatch with the backend's availability logic.

![Pilot booking — 14-day availability calendar](screenshots/04-pilot-booking-calendar.png)

**Booking modal** — When a pilot selects an available day, the modal loads pre-computed slots for that simulator and day. Slots are returned server-side only if they pass the full availability check. The frontend receives only valid slots. If no valid slots exist, the modal shows an empty state with the server-provided reason.

![Pilot booking — slot selection modal](screenshots/05-book-slot-modal.png)

**Pending approval lock** — Pilots whose `bookingAuthorized` flag is `false` see the simulator overview and availability strip (so they can plan), but the booking action is replaced by a message explaining that their training manager must approve booking access. There is no booking modal. The lock is enforced both in the UI and at the API — a direct API call without the UI returns 403.

![Pilot booking — pending approval lock state](screenshots/06-pending-pilot-lock.png)

#### The design principle

The pilot UI removes invalid time from the decision path. It does not warn about invalid slots after the pilot has chosen one. Invalid days are non-selectable in the strip. The modal only shows slots the backend is willing to book.

This pattern — hide invalid options rather than warn about them — is a trust model decision. The pilot trusts that the strip shows real availability. The manager trusts that a blocked period they created will actually prevent bookings, not just show a warning. The architecture supports that trust because the backend enforces the rules independently of the frontend state.

---

## Cross-Service Flows

### Signup and approval

```
1. Pilot opens /signup and selects a training country.
2. user-service maps the country to tenantId.
3. user-service creates a PILOT user with bookingAuthorized = false.
4. Pilot receives a JWT and can access dashboard, profile, CBTA, licences.
5. Manager logs into /schedule, finds the pending pilot, and authorises booking.
6. Pilot's next login JWT contains bookingAuthorized = true.
7. Pilot can now create reservations.
```

### Maintenance and closure propagation

```
1. Manager creates a BlockedPeriod or MaintenanceRecord in schedule-service.
2. schedule-service writes an audit log entry.
3. schedule-service emits BlockedPeriodCreated to EventBridge.
4. A booking-service EventBridge consumer marks affected slots unavailable.
5. Calendar and availability APIs reflect the block immediately.
6. Pilots who reload the strip see the blocked days.
```

This event-driven propagation is the production target for ADR-006. The current prototype uses a synchronous availability check at booking creation time as the safety gate, with frontend filtering of the calendar as the display layer. The gap — that a stale slot could theoretically be visible between the blocked period being created and the EventBridge consumer processing it — is documented and is the next production-readiness item.

### Training evidence

```
1. Reservation/session creates training context.
2. Instructor records assessments and scenario usage.
3. cbta-service stores per-competency outcomes.
4. Scores below standard emit TrainingDeficitOpened to EventBridge.
5. deficit-tracking picks up the deficit and creates a remedial action.
6. regulatory-reports aggregates evidence on request from inspectors.
```

This flow is architecturally planned across `cbta-service`, `training-programmes`, `instructor-records`, `deficit-tracking`, and `regulatory-reports`. The EventBridge events are the connective tissue.

The pilot-facing CBTA view surfaces the output of this chain: a progress table per EASA competency unit (8 standard units, split between Technical and Non-Technical competencies), with the latest score, running average, session count, and last-assessed date. A colour-coded score bar makes the regulatory significance immediately visible — red for Below Standard, amber for Developing, green for Meets Standard and above. The overall average at the top of the page gives the instructor and the pilot a single number that reflects the pilot's current training trajectory.

![Pilot CBTA progress — competency unit scores, assessment history, overall average](screenshots/07-cbta-progress.png)

---

## Architecture Decision: Schedule Availability As Booking Control

> **ADR-006 — Schedule Availability As Booking Control**  
> Status: Proposed · Date: 2026-05-30

Booking creation must treat schedule availability as a backend control, not only a frontend display filter.

The three implementation options:

1. **Synchronous check** — `booking-service` calls `schedule-service` before confirming a reservation. Simple, consistent, but creates a runtime dependency. If `schedule-service` is unreachable, booking fails (safe default).

2. **Event-driven propagation** — `schedule-service` emits `BlockedPeriodCreated` and a booking worker marks affected slots unavailable. No runtime dependency. Risk: a slot can be stale between event emission and consumer processing.

3. **Hybrid** — event propagation for calendar performance, synchronous check as final guard at booking creation. Both services agree on the answer; the synchronous check is a consistency backstop.

Recommended target: hybrid. The current prototype uses the synchronous check alone. The event consumer is the next step.

---

## Audit and Retention

Every privacy-relevant and regulatory-relevant mutation in AeroCap writes an audit event.

Minimum audit event fields:

```typescript
interface AuditEvent {
  tenantId: string;
  region: string;
  actorUserId: string;
  actorRole: AeroCapRole;
  action: string;         // e.g. 'BlockedPeriod.Created'
  entityType: string;
  entityId: string;
  occurredAt: string;     // ISO-8601
  sourceIp?: string;
  reason?: string;        // required for cross-border access
  before?: unknown;
  after?: unknown;
}
```

The `before` and `after` fields are optional but required for privileged mutations — manager approval of a pilot, schedule deletion, report export. They make the audit trail reconstructible without replaying application logic.

Audit logs are stored in the same regional data plane as the tenant data. A France audit log does not live in a global bucket that happens to be accessible from China.

---

## The Architecture Governance Layer

The `docs/togaf-architecture-governance.md` maps the platform into a TOGAF-oriented structure with governance gates that a feature must pass before merge:

| Gate | Required evidence |
|---|---|
| Feature intake | Business capability, tenant impact, data classification |
| API design | OpenAPI, Zod schemas, response envelope |
| Data design | Migration, tenant_id, PII inventory, retention rule |
| Security review | Auth, role, OWASP, secrets, rate limits |
| Compliance review | GDPR/PIPL/DPDP/POPIA impact, transfer and erasure strategy |
| Test review | Auth tests, tenant isolation tests, validation tests |
| Release review | Build, tests, audit trail, rollback and monitoring plan |

Every gate maps to a subagent in the development kit. The security gate maps to `security-auditor`. The compliance gate maps to `compliance-auditor`. The test gate maps to `test-runner`. The architecture governance and the development workflow are the same process, described twice — once formally, once as code.

---

## Architecture Decision Records

The seven ADRs in `docs/adr/` capture the decisions that all the above builds on:

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](../adr/001-country-as-tenant-and-data-residency.md) | Country as tenant and regional data residency | Accepted |
| [ADR-002](../adr/002-service-owned-data-and-microservices.md) | Service-owned data and microservices | Accepted |
| [ADR-003](../adr/003-contract-first-apis-and-zod-validation.md) | Contract-first APIs and Zod validation | Accepted |
| [ADR-004](../adr/004-authentication-and-tenant-claims.md) | Authentication and tenant claims | Accepted |
| [ADR-005](../adr/005-audit-retention-and-pseudonymisation.md) | Audit, retention, and pseudonymisation | Accepted |
| [ADR-006](../adr/006-schedule-availability-as-booking-control.md) | Schedule availability as booking control | Proposed |
| [ADR-007](../adr/007-ai-assisted-development-kit.md) | AI-assisted development kit | Accepted |

ADR-006 is the only one still in Proposed status. It is the active production-readiness gap: booking creation enforces schedule availability through a synchronous check, but the event-driven propagation that would make the calendar and the booking rules resilient to service latency has not been implemented. When it is, ADR-006 moves to Accepted.

---

## Known Gaps and Next Steps

**Short term — stabilise the prototype:**

- Fix TypeScript build failures caused by role drift across services.
- Make test databases isolated per test run (not persistent shared SQLite files).
- Add per-service `openapi.yaml` files alongside each handler.
- Extract shared packages: auth types, role constants, response envelope, tenant helpers.
- Close ADR-006: add the synchronous availability check inside booking creation and the EventBridge consumer for slot propagation.

**Medium term — production readiness:**

- Migrate from local JWT to AWS Cognito/OIDC. Add SAML SSO for enterprise operators.
- Migrate from SQLite to Aurora PostgreSQL with regional deployments.
- Replace console-based schedule propagation with EventBridge events and idempotent consumers.
- Add CI gates: TypeScript build, test suite, OpenAPI drift check, tenant isolation scanner, PII inventory compliance check.
- Add a shared audit publisher abstraction used by all services.

**Long term — regional production:**

- Deploy EU data plane first (France/GDPR).
- Deploy China data plane with PIPL controls (CAC security assessment or standard contract).
- Deploy South Africa and India data planes.
- Validate backup, log, and report-document residency matches operational data residency.
- Full security and compliance audit before real pilot data import.

---

## What the AI Agent Workflow Contributes

The agent workflow keeps the compliance and architecture constraints visible throughout development. It is not a code generator.

The `spec-generator` cannot know what a French regulatory authority considers valid training evidence. The `training-management` agent can. Separating them ensures neither concern is lost inside the other.

The `backend-developer` agent can write a Zod schema correctly. It cannot reliably know whether a new field touches PIPL sensitive personal information. The `compliance-auditor` agent can. The review gate exists so the developer does not have to hold all of that context simultaneously.

The `PreToolUse` hook cannot prevent a developer from misunderstanding the privacy law. It can prevent `DROP TABLE reservations` from running before the damage is done.

The combination — specialist agents, standing skills, automated hooks — is a development operating system. It is why the simulator time management feature arrived with evidence impact metadata on inspection blocked periods, OPC/LPC spacing in the correct service, and a race-safe database constraint. Those three correctness decisions came from three different reviewers. No single prompt produced all of them.

---

## Closing

AeroCap is a regulated platform built on a simple principle: every engineering decision must preserve tenant isolation, protect pilot data, and produce evidence that an aviation inspector can trust.

The architecture decisions — country as tenant, service-owned data, contract-first APIs, JWT-only tenant claims, audit and pseudonymisation, schedule availability as a booking control — are not independent choices. They are load-bearing walls. Remove one and the compliance guarantees of the others weaken.

The AI development kit makes those walls visible at the moment of building. The subagents enforce domain expertise. The hooks block accidental damage. The skills repeat the non-negotiables until they are habits.

The remaining work is well-defined: close ADR-006, consolidate auth, move to regional production databases, and pass the full security and compliance audit. The platform architecture supports all of it. The ADRs describe what "done" looks like.

---

*Platform engineering — Abdelhamid Zeglami · Feat GenAI*
