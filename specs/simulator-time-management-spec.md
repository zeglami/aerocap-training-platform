# AeroCap — Simulator Time Management Specification

**Author:** spec-generator  
**Date:** 2026-05-30  
**Status:** Production contract — implementation builds against this  
**Scope:** Facility operating schedules, blocked periods (holidays / maintenance / closures), slot availability enforcement, and pilot-facing calendar

---

## 0. Context & Assumptions

The existing `booking-service` already generates raw time slots (`slots` table) and manages reservations. This spec adds a **Time Management** layer that:

1. Defines **when** a facility or simulator is open for training (operating schedule)
2. Defines **what blocks** availability: national holidays, facility closures, simulator maintenance, inspections
3. **Propagates** blocks to existing/future slots automatically (marks them unavailable)
4. Exposes a **unified calendar** API so pilots only see genuinely bookable slots

**Integration rule:** every slot availability check in `booking-service` MUST call `GET /api/v1/schedule/availability` (or use its embedded logic). A slot is bookable if:
- It falls within an active `OperatingSchedule` window, AND
- No `BlockedPeriod` covers its start time for the simulator or the whole facility

**Tenant isolation:** `tenant_id` on every table, sourced exclusively from the JWT.

---

## 1. Entity Model

### 1.1 OperatingSchedule

Defines the **regular weekly pattern** for a facility or a specific simulator.

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| tenantId | string | yes | From JWT |
| simulatorId | UUID | no | NULL = applies to entire facility |
| name | string | yes | e.g. "Standard AeroCap CDG Schedule" |
| effectiveFrom | date | yes | When this schedule takes effect |
| effectiveUntil | date | no | NULL = indefinitely active |
| status | enum | yes | `ACTIVE`, `DRAFT`, `SUPERSEDED` |
| timeZone | string | yes | IANA tz, e.g. `Europe/Paris` |
| dailyWindows | DailyWindow[] | yes | JSON — per-weekday open hours |
| createdBy | UUID | yes | User ID |
| notes | string | no | Internal notes |

**DailyWindow** (embedded JSON per schedule):
```
{ dayOfWeek: 0-6, openTime: "HH:MM", closeTime: "HH:MM", isOpen: boolean }
```

At most one `ACTIVE` schedule may exist per `(tenant_id, simulator_id)` pair at any given date.

---

### 1.2 BlockedPeriod

Blocks booking during a specific window. Applies to a single simulator or the whole facility.

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| tenantId | string | yes | From JWT |
| simulatorId | UUID | no | NULL = facility-wide block |
| blockType | enum | yes | `HOLIDAY`, `MAINTENANCE`, `AUTHORITY_INSPECTION`, `WEATHER_CLOSURE`, `SPECIAL_EVENT`, `OTHER` |
| title | string | yes | Shown in pilot calendar |
| description | string | no | Internal detail |
| startAt | datetime | yes | Block start (inclusive) |
| endAt | datetime | yes | Block end (exclusive) |
| isPublic | boolean | yes | true = pilots see title+dates; false = shows as "unavailable" |
| recurrenceRule | string | no | iCal RRULE for annual holidays (e.g. `FREQ=YEARLY`) |
| affectsSlots | boolean | yes | true = propagate to existing slot records |
| propagatedAt | datetime | no | Set when slot propagation completes |
| createdBy | UUID | yes | User ID |

Constraint: `endAt > startAt`. Block types by visibility:

| blockType | Pilot sees title | Example |
|---|---|---|
| `HOLIDAY` | Yes | "Bastille Day — Facility Closed" |
| `MAINTENANCE` | No ("Simulator unavailable") | FFS-D re-qualification |
| `AUTHORITY_INSPECTION` | No ("Simulator unavailable") | DGAC FSTD audit |
| `WEATHER_CLOSURE` | Yes | "Facility closed — adverse weather" |
| `SPECIAL_EVENT` | Yes | "All-hands training day" |
| `OTHER` | Depends on isPublic | |

---

### 1.3 MaintenanceRecord

Detail record for planned or unplanned simulator maintenance. Referenced by `BlockedPeriod.blockType = MAINTENANCE`.

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| tenantId | string | yes | From JWT |
| simulatorId | UUID | yes | Required (maintenance is always per-simulator) |
| blockedPeriodId | UUID | no | Links to the BlockedPeriod that blocks bookings |
| maintenanceType | enum | yes | `SCHEDULED_100H`, `SCHEDULED_500H`, `ANNUAL_RECERTIFICATION`, `COMPONENT_REPLACEMENT`, `SOFTWARE_UPGRADE`, `UNSCHEDULED`, `FSTD_REQUALIFICATION` |
| title | string | yes | |
| description | string | no | |
| plannedStartAt | datetime | yes | |
| plannedEndAt | datetime | yes | |
| actualStartAt | datetime | no | Filled when maintenance begins |
| actualEndAt | datetime | no | Filled when complete |
| status | enum | yes | `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED` |
| technicianName | string | no | |
| authorityReferenceNumber | string | no | e.g. DGAC approval ref for FSTD requalification |
| partialOperationAllowed | boolean | yes | true = ground briefings OK during maintenance |
| qualificationLevelDuring | string | no | e.g. `FTD` — reduced qualification during partial maintenance |
| completionNotes | string | no | Post-maintenance sign-off notes |
| createdBy | UUID | yes | |

---

### 1.4 AvailabilityOverride

An explicit **positive** availability window that extends or restores access outside the regular schedule (e.g., weekend special opening, extended hours for an ITR batch).

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| tenantId | string | yes | From JWT |
| simulatorId | UUID | no | NULL = all simulators |
| title | string | yes | e.g. "Extended hours — B737 MAX ITR batch" |
| startAt | datetime | yes | |
| endAt | datetime | yes | |
| reason | string | no | |
| createdBy | UUID | yes | |
| isPublic | boolean | yes | Shown in pilot calendar |

---

### 1.5 NationalHolidayCalendar

Pre-loaded public holiday definitions per region, used to seed `BlockedPeriod` records annually.

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| region | enum | yes | `FR`, `ZA`, `CN`, `IN` |
| year | integer | yes | |
| holidayDate | date | yes | |
| name | string | yes | e.g. "Fête du Travail" |
| isFullDay | boolean | yes | |
| autoCreateBlock | boolean | yes | If true, auto-generates BlockedPeriod on import |

---

### 1.6 CalendarEvent (Read model — not persisted)

Computed view used by the calendar UI and slot availability check.

| Field | Type | Notes |
|---|---|---|
| date | date | |
| simulatorId | UUID | null = facility-wide |
| type | enum | `AVAILABLE`, `HOLIDAY`, `MAINTENANCE`, `CLOSURE`, `PARTIAL`, `OVERRIDE_OPEN` |
| title | string | Shown in UI |
| isPublic | boolean | |
| slotCount | integer | available slots on this date |

---

## 2. DB Schema

```sql
-- ── Audit log (referenced by all mutations in this domain) ───────────────────

CREATE TABLE simulator_schedule_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   VARCHAR(36) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,   -- 'operating_schedule' | 'blocked_period' | 'maintenance_record' | 'availability_override'
  entity_id   UUID NOT NULL,
  action      VARCHAR(20) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','ACTIVATE','COMPLETE','OVERRIDE')),
  actor_id    UUID NOT NULL,
  actor_role  VARCHAR(50) NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ssal_tenant_entity ON simulator_schedule_audit_log (tenant_id, entity_type, entity_id);
CREATE INDEX idx_ssal_tenant_id     ON simulator_schedule_audit_log (tenant_id, id);
CREATE INDEX idx_ssal_actor         ON simulator_schedule_audit_log (tenant_id, actor_id, created_at);

-- ── Operating schedules ───────────────────────────────────────────────────────

CREATE TABLE operating_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  simulator_id UUID,                         -- NULL = facility-wide
  name VARCHAR(255) NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  daily_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_os_tenant_id   ON operating_schedule (tenant_id, id);
CREATE INDEX idx_os_simulator   ON operating_schedule (tenant_id, simulator_id, status);
CREATE INDEX idx_os_effective   ON operating_schedule (tenant_id, effective_from, effective_until)
  WHERE status = 'ACTIVE';
-- Only one ACTIVE schedule per simulator at a time enforced in application logic

-- ── Blocked periods ───────────────────────────────────────────────────────────

CREATE TABLE blocked_period (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  simulator_id UUID,                         -- NULL = facility-wide
  block_type VARCHAR(32) NOT NULL CHECK (block_type IN (
    'HOLIDAY','MAINTENANCE','AUTHORITY_INSPECTION','WEATHER_CLOSURE','SPECIAL_EVENT','OTHER'
  )),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  recurrence_rule VARCHAR(255),              -- iCal RRULE
  affects_slots BOOLEAN NOT NULL DEFAULT TRUE,
  propagated_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_bp_dates CHECK (end_at > start_at)
);
CREATE INDEX idx_bp_tenant_id  ON blocked_period (tenant_id, id);
CREATE INDEX idx_bp_range      ON blocked_period (tenant_id, start_at, end_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_bp_simulator  ON blocked_period (tenant_id, simulator_id, start_at)
  WHERE deleted_at IS NULL;

-- ── Maintenance records ───────────────────────────────────────────────────────

CREATE TABLE maintenance_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  simulator_id UUID NOT NULL,
  blocked_period_id UUID REFERENCES blocked_period(id),
  maintenance_type VARCHAR(32) NOT NULL CHECK (maintenance_type IN (
    'SCHEDULED_100H','SCHEDULED_500H','ANNUAL_RECERTIFICATION',
    'COMPONENT_REPLACEMENT','SOFTWARE_UPGRADE','UNSCHEDULED','FSTD_REQUALIFICATION'
  )),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  planned_start_at TIMESTAMPTZ NOT NULL,
  planned_end_at TIMESTAMPTZ NOT NULL,
  actual_start_at TIMESTAMPTZ,
  actual_end_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  technician_name VARCHAR(255),
  authority_reference_number VARCHAR(128),
  partial_operation_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  qualification_level_during VARCHAR(16),   -- e.g. 'FTD' during partial maint.
  completion_notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_mr_dates CHECK (planned_end_at > planned_start_at)
);
CREATE INDEX idx_mr_tenant_id  ON maintenance_record (tenant_id, id);
CREATE INDEX idx_mr_simulator  ON maintenance_record (tenant_id, simulator_id, status);
CREATE INDEX idx_mr_planned    ON maintenance_record (tenant_id, planned_start_at, planned_end_at);

-- ── Availability overrides ────────────────────────────────────────────────────

CREATE TABLE availability_override (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  simulator_id UUID,                         -- NULL = all simulators
  title VARCHAR(255) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_ao_dates CHECK (end_at > start_at)
);
CREATE INDEX idx_ao_tenant_id  ON availability_override (tenant_id, id);
CREATE INDEX idx_ao_range      ON availability_override (tenant_id, start_at, end_at)
  WHERE deleted_at IS NULL;

-- ── National holiday calendar ─────────────────────────────────────────────────

CREATE TABLE national_holiday_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region VARCHAR(4) NOT NULL CHECK (region IN ('FR','ZA','CN','IN')),
  year INTEGER NOT NULL,
  holiday_date DATE NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_full_day BOOLEAN NOT NULL DEFAULT TRUE,
  auto_create_block BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_holiday UNIQUE (region, holiday_date, name)
);
CREATE INDEX idx_nhc_region_year ON national_holiday_calendar (region, year);
```

---

## 3. OpenAPI 3.0 Spec

```yaml
openapi: 3.0.3
info:
  title: AeroCap Simulator Time Management API
  version: 1.0.0
servers:
  - url: https://api.aerocap.aero/api/v1/schedule
security:
  - bearerAuth: []

paths:

  # ── Operating Schedules ───────────────────────────────────────────────────

  /operating-schedules:
    get:
      summary: List operating schedules
      tags: [OperatingSchedule]
      parameters:
        - { $ref: '#/components/parameters/Page' }
        - { $ref: '#/components/parameters/PageSize' }
        - name: simulatorId
          in: query
          schema: { type: string, format: uuid }
        - name: status
          in: query
          schema: { type: string, enum: [DRAFT, ACTIVE, SUPERSEDED] }
      responses:
        '200': { $ref: '#/components/responses/ScheduleList' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }

    post:
      summary: Create operating schedule (ADMIN / MANAGER)
      tags: [OperatingSchedule]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateOperatingScheduleRequest' }
      responses:
        '201': { $ref: '#/components/responses/ScheduleItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { description: Active schedule conflict }
        '422': { $ref: '#/components/responses/BusinessRule' }
        '500': { $ref: '#/components/responses/InternalError' }

  /operating-schedules/{id}:
    get:
      tags: [OperatingSchedule]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      responses:
        '200': { $ref: '#/components/responses/ScheduleItem' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }

    patch:
      summary: Update schedule (DRAFT only)
      tags: [OperatingSchedule]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/UpdateOperatingScheduleRequest' }
      responses:
        '200': { $ref: '#/components/responses/ScheduleItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '410': { description: Schedule is active or superseded — cannot edit }
        '500': { $ref: '#/components/responses/InternalError' }

    delete:
      summary: Soft-delete schedule (DRAFT only)
      tags: [OperatingSchedule]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      responses:
        '204': { description: Deleted }
        '409': { description: Cannot delete active schedule }
        '500': { $ref: '#/components/responses/InternalError' }

  /operating-schedules/{id}/activate:
    post:
      summary: Activate schedule — supersedes current active for same simulator
      tags: [OperatingSchedule]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [effectiveFrom]
              properties:
                effectiveFrom: { type: string, format: date }
                effectiveUntil: { type: string, format: date, nullable: true }
      responses:
        '200': { $ref: '#/components/responses/ScheduleItem' }
        '422': { $ref: '#/components/responses/BusinessRule' }
        '500': { $ref: '#/components/responses/InternalError' }

  # ── Blocked Periods ───────────────────────────────────────────────────────

  /blocked-periods:
    get:
      summary: List blocked periods
      tags: [BlockedPeriod]
      parameters:
        - { $ref: '#/components/parameters/Page' }
        - { $ref: '#/components/parameters/PageSize' }
        - name: simulatorId
          in: query
          schema: { type: string, format: uuid }
          description: Filter by simulator (omit for facility-wide)
        - name: blockType
          in: query
          schema: { $ref: '#/components/schemas/BlockType' }
        - name: from
          in: query
          schema: { type: string, format: date-time }
        - name: until
          in: query
          schema: { type: string, format: date-time }
        - name: includeExpired
          in: query
          schema: { type: boolean, default: false }
      responses:
        '200': { $ref: '#/components/responses/BlockedPeriodList' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }

    post:
      summary: Create blocked period (ADMIN / MANAGER)
      tags: [BlockedPeriod]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateBlockedPeriodRequest' }
      responses:
        '201': { $ref: '#/components/responses/BlockedPeriodItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRule' }
        '500': { $ref: '#/components/responses/InternalError' }

  /blocked-periods/{id}:
    get:
      tags: [BlockedPeriod]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      responses:
        '200': { $ref: '#/components/responses/BlockedPeriodItem' }
        '404': { $ref: '#/components/responses/NotFound' }

    patch:
      summary: Update blocked period (future-only blocks)
      tags: [BlockedPeriod]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/UpdateBlockedPeriodRequest' }
      responses:
        '200': { $ref: '#/components/responses/BlockedPeriodItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '410': { description: Block is in the past — cannot edit }
        '500': { $ref: '#/components/responses/InternalError' }

    delete:
      summary: Remove a blocked period (restores slot availability)
      tags: [BlockedPeriod]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      responses:
        '204': { description: Deleted — affected slots restored }
        '410': { description: Block already started — CFI/Admin approval required }
        '500': { $ref: '#/components/responses/InternalError' }

  # ── Maintenance Records ───────────────────────────────────────────────────

  /maintenance:
    get:
      summary: List maintenance records
      tags: [Maintenance]
      parameters:
        - { $ref: '#/components/parameters/Page' }
        - { $ref: '#/components/parameters/PageSize' }
        - name: simulatorId
          in: query
          schema: { type: string, format: uuid }
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/MaintenanceStatus' }
        - name: from
          in: query
          schema: { type: string, format: date-time }
        - name: until
          in: query
          schema: { type: string, format: date-time }
      responses:
        '200': { $ref: '#/components/responses/MaintenanceList' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }

    post:
      summary: Schedule maintenance (automatically creates BlockedPeriod)
      tags: [Maintenance]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateMaintenanceRequest' }
      responses:
        '201': { $ref: '#/components/responses/MaintenanceItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRule' }
        '500': { $ref: '#/components/responses/InternalError' }

  /maintenance/{id}:
    get:
      tags: [Maintenance]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      responses:
        '200': { $ref: '#/components/responses/MaintenanceItem' }
        '404': { $ref: '#/components/responses/NotFound' }

    patch:
      summary: Update maintenance record or mark complete
      tags: [Maintenance]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/UpdateMaintenanceRequest' }
      responses:
        '200': { $ref: '#/components/responses/MaintenanceItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '500': { $ref: '#/components/responses/InternalError' }

  /maintenance/{id}/complete:
    post:
      summary: Mark maintenance complete — restores slots and updates BlockedPeriod
      tags: [Maintenance]
      parameters: [ { $ref: '#/components/parameters/Id' } ]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [completionNotes]
              properties:
                actualEndAt: { type: string, format: date-time }
                completionNotes: { type: string, minLength: 10 }
                authorityReferenceNumber: { type: string }
      responses:
        '200': { $ref: '#/components/responses/MaintenanceItem' }
        '422': { description: Maintenance not started or already complete }
        '500': { $ref: '#/components/responses/InternalError' }

  # ── Availability Overrides ────────────────────────────────────────────────

  /availability-overrides:
    get:
      tags: [AvailabilityOverride]
      parameters:
        - { $ref: '#/components/parameters/Page' }
        - { $ref: '#/components/parameters/PageSize' }
        - name: simulatorId
          in: query
          schema: { type: string, format: uuid }
        - name: from
          in: query
          schema: { type: string, format: date-time }
        - name: until
          in: query
          schema: { type: string, format: date-time }
      responses:
        '200': { $ref: '#/components/responses/OverrideList' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '500': { $ref: '#/components/responses/InternalError' }

    post:
      summary: Create availability override (e.g., weekend opening)
      tags: [AvailabilityOverride]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateOverrideRequest' }
      responses:
        '201': { $ref: '#/components/responses/OverrideItem' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }

  /availability-overrides/{id}:
    patch: { tags: [AvailabilityOverride], parameters: [ { $ref: '#/components/parameters/Id' } ], requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/CreateOverrideRequest' } } } }, responses: { '200': { $ref: '#/components/responses/OverrideItem' }, '400': { $ref: '#/components/responses/BadRequest' } } }
    delete: { tags: [AvailabilityOverride], parameters: [ { $ref: '#/components/parameters/Id' } ], responses: { '204': { description: Deleted } } }

  # ── National Holidays ─────────────────────────────────────────────────────

  /holidays:
    get:
      summary: List national holidays for tenant region
      tags: [Holidays]
      parameters:
        - name: year
          in: query
          required: true
          schema: { type: integer }
        - name: region
          in: query
          schema: { type: string, enum: [FR, ZA, CN, IN] }
      responses:
        '200':
          description: List of holidays
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/NationalHoliday' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '500': { $ref: '#/components/responses/InternalError' }

  /holidays/import:
    post:
      summary: Import national holidays for a year — auto-creates BlockedPeriods
      tags: [Holidays]
      description: |
        Imports the official public holiday list for the tenant's region and year.
        For each holiday where `autoCreateBlock = true`, creates a facility-wide
        BlockedPeriod of type HOLIDAY. Idempotent — re-importing the same year
        skips already-created blocks.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [year]
              properties:
                year: { type: integer, minimum: 2024 }
                region: { type: string, enum: [FR, ZA, CN, IN], description: defaults to tenant region }
                dryRun: { type: boolean, default: false, description: preview without creating }
      responses:
        '200':
          description: Import result
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          imported: { type: integer }
                          skipped:  { type: integer }
                          blockedPeriodsCreated: { type: integer }
                          holidays: { type: array, items: { $ref: '#/components/schemas/NationalHoliday' } }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }

  # ── Calendar (unified view — read-only) ───────────────────────────────────

  /calendar:
    get:
      summary: Unified availability calendar — used by pilot booking UI
      tags: [Calendar]
      description: |
        Returns a day-by-day availability grid for a date range.
        Combines operating schedules, blocked periods, and overrides.
        Pilots see: AVAILABLE, HOLIDAY (public title), UNAVAILABLE (no detail).
        Admins/Managers see: full detail including maintenance type and notes.
      parameters:
        - name: from
          in: query
          required: true
          schema: { type: string, format: date }
          example: '2026-06-01'
        - name: until
          in: query
          required: true
          schema: { type: string, format: date }
          example: '2026-06-30'
        - name: simulatorId
          in: query
          schema: { type: string, format: uuid }
          description: Omit for facility-wide view
      responses:
        '200':
          description: Calendar grid
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/CalendarDay' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '500': { $ref: '#/components/responses/InternalError' }

  /availability:
    get:
      summary: Check slot availability — used by booking-service
      tags: [Calendar]
      description: |
        Returns whether a specific datetime window is bookable for a simulator.
        Used internally by booking-service before confirming a reservation.
      parameters:
        - name: simulatorId
          in: query
          required: true
          schema: { type: string, format: uuid }
        - name: startAt
          in: query
          required: true
          schema: { type: string, format: date-time }
        - name: endAt
          in: query
          required: true
          schema: { type: string, format: date-time }
      responses:
        '200':
          description: Availability check result
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          available: { type: boolean }
                          reason:    { type: string, nullable: true, description: Why unavailable }
                          blockType: { $ref: '#/components/schemas/BlockType', nullable: true }
                          blockedPeriodId: { type: string, format: uuid, nullable: true }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '500': { $ref: '#/components/responses/InternalError' }

components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }

  parameters:
    Id:
      name: id
      in: path
      required: true
      schema: { type: string, format: uuid }
    Page:
      name: page
      in: query
      schema: { type: integer, default: 1, minimum: 1 }
    PageSize:
      name: pageSize
      in: query
      schema: { type: integer, default: 25, minimum: 1, maximum: 100 }

  schemas:
    BlockType:
      type: string
      enum: [HOLIDAY, MAINTENANCE, AUTHORITY_INSPECTION, WEATHER_CLOSURE, SPECIAL_EVENT, OTHER]

    MaintenanceType:
      type: string
      enum: [SCHEDULED_100H, SCHEDULED_500H, ANNUAL_RECERTIFICATION, COMPONENT_REPLACEMENT, SOFTWARE_UPGRADE, UNSCHEDULED, FSTD_REQUALIFICATION]

    MaintenanceStatus:
      type: string
      enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED]

    DailyWindow:
      type: object
      required: [dayOfWeek, openTime, closeTime, isOpen]
      properties:
        dayOfWeek:  { type: integer, minimum: 0, maximum: 6, description: 0=Sunday }
        openTime:   { type: string, pattern: '^[0-2][0-9]:[0-5][0-9]$', example: '06:00' }
        closeTime:  { type: string, pattern: '^[0-2][0-9]:[0-5][0-9]$', example: '22:00' }
        isOpen:     { type: boolean }

    OperatingSchedule:
      type: object
      properties:
        id:             { type: string, format: uuid }
        tenantId:       { type: string }
        simulatorId:    { type: string, format: uuid, nullable: true }
        name:           { type: string }
        effectiveFrom:  { type: string, format: date }
        effectiveUntil: { type: string, format: date, nullable: true }
        status:         { type: string, enum: [DRAFT, ACTIVE, SUPERSEDED] }
        timeZone:       { type: string }
        dailyWindows:   { type: array, items: { $ref: '#/components/schemas/DailyWindow' } }
        notes:          { type: string, nullable: true }
        createdAt:      { type: string, format: date-time }
        updatedAt:      { type: string, format: date-time }

    BlockedPeriod:
      type: object
      properties:
        id:              { type: string, format: uuid }
        tenantId:        { type: string }
        simulatorId:     { type: string, format: uuid, nullable: true }
        blockType:       { $ref: '#/components/schemas/BlockType' }
        title:           { type: string }
        description:     { type: string, nullable: true }
        startAt:         { type: string, format: date-time }
        endAt:           { type: string, format: date-time }
        isPublic:        { type: boolean }
        recurrenceRule:  { type: string, nullable: true }
        affectsSlots:    { type: boolean }
        propagatedAt:    { type: string, format: date-time, nullable: true }
        createdAt:       { type: string, format: date-time }
        updatedAt:       { type: string, format: date-time }

    MaintenanceRecord:
      type: object
      properties:
        id:                       { type: string, format: uuid }
        tenantId:                 { type: string }
        simulatorId:              { type: string, format: uuid }
        blockedPeriodId:          { type: string, format: uuid, nullable: true }
        maintenanceType:          { $ref: '#/components/schemas/MaintenanceType' }
        title:                    { type: string }
        description:              { type: string, nullable: true }
        plannedStartAt:           { type: string, format: date-time }
        plannedEndAt:             { type: string, format: date-time }
        actualStartAt:            { type: string, format: date-time, nullable: true }
        actualEndAt:              { type: string, format: date-time, nullable: true }
        status:                   { $ref: '#/components/schemas/MaintenanceStatus' }
        technicianName:           { type: string, nullable: true }
        authorityReferenceNumber: { type: string, nullable: true }
        partialOperationAllowed:  { type: boolean }
        qualificationLevelDuring: { type: string, nullable: true }
        completionNotes:          { type: string, nullable: true }
        createdAt:                { type: string, format: date-time }
        updatedAt:                { type: string, format: date-time }

    AvailabilityOverride:
      type: object
      properties:
        id:          { type: string, format: uuid }
        tenantId:    { type: string }
        simulatorId: { type: string, format: uuid, nullable: true }
        title:       { type: string }
        startAt:     { type: string, format: date-time }
        endAt:       { type: string, format: date-time }
        reason:      { type: string, nullable: true }
        isPublic:    { type: boolean }
        createdAt:   { type: string, format: date-time }
        updatedAt:   { type: string, format: date-time }

    NationalHoliday:
      type: object
      properties:
        id:               { type: string, format: uuid }
        region:           { type: string, enum: [FR, ZA, CN, IN] }
        year:             { type: integer }
        holidayDate:      { type: string, format: date }
        name:             { type: string }
        isFullDay:        { type: boolean }
        autoCreateBlock:  { type: boolean }

    CalendarDay:
      type: object
      properties:
        date:        { type: string, format: date }
        simulatorId: { type: string, format: uuid, nullable: true, description: null = facility-wide }
        status:      { type: string, enum: [AVAILABLE, PARTIALLY_AVAILABLE, BLOCKED, HOLIDAY, MAINTENANCE, OVERRIDE_OPEN] }
        title:       { type: string, nullable: true, description: Shown only if isPublic }
        availableSlotCount: { type: integer }
        totalSlotCount:     { type: integer }
        blocks:
          type: array
          items:
            type: object
            properties:
              startAt:   { type: string, format: date-time }
              endAt:     { type: string, format: date-time }
              blockType: { $ref: '#/components/schemas/BlockType' }
              title:     { type: string, nullable: true }

    CreateOperatingScheduleRequest:
      type: object
      required: [name, effectiveFrom, timeZone, dailyWindows]
      properties:
        simulatorId:    { type: string, format: uuid, nullable: true }
        name:           { type: string, minLength: 1, maxLength: 255 }
        effectiveFrom:  { type: string, format: date }
        effectiveUntil: { type: string, format: date, nullable: true }
        timeZone:       { type: string, default: UTC }
        dailyWindows:   { type: array, minItems: 7, maxItems: 7, items: { $ref: '#/components/schemas/DailyWindow' } }
        notes:          { type: string, maxLength: 2000, nullable: true }

    UpdateOperatingScheduleRequest:
      type: object
      properties:
        name:           { type: string }
        effectiveUntil: { type: string, format: date, nullable: true }
        dailyWindows:   { type: array, items: { $ref: '#/components/schemas/DailyWindow' } }
        notes:          { type: string, nullable: true }

    CreateBlockedPeriodRequest:
      type: object
      required: [blockType, title, startAt, endAt]
      properties:
        simulatorId:     { type: string, format: uuid, nullable: true, description: null = facility-wide }
        blockType:       { $ref: '#/components/schemas/BlockType' }
        title:           { type: string, minLength: 1, maxLength: 255 }
        description:     { type: string, maxLength: 4000, nullable: true }
        startAt:         { type: string, format: date-time }
        endAt:           { type: string, format: date-time }
        isPublic:        { type: boolean, default: true }
        recurrenceRule:  { type: string, nullable: true, description: iCal RRULE for repeating blocks }
        affectsSlots:    { type: boolean, default: true }

    UpdateBlockedPeriodRequest:
      type: object
      properties:
        title:       { type: string }
        description: { type: string, nullable: true }
        endAt:       { type: string, format: date-time }
        isPublic:    { type: boolean }

    CreateMaintenanceRequest:
      type: object
      required: [simulatorId, maintenanceType, title, plannedStartAt, plannedEndAt]
      properties:
        simulatorId:              { type: string, format: uuid }
        maintenanceType:          { $ref: '#/components/schemas/MaintenanceType' }
        title:                    { type: string }
        description:              { type: string, nullable: true }
        plannedStartAt:           { type: string, format: date-time }
        plannedEndAt:             { type: string, format: date-time }
        technicianName:           { type: string, nullable: true }
        authorityReferenceNumber: { type: string, nullable: true }
        partialOperationAllowed:  { type: boolean, default: false }
        qualificationLevelDuring: { type: string, nullable: true }
        autoCreateBlockedPeriod:  { type: boolean, default: true }

    UpdateMaintenanceRequest:
      type: object
      properties:
        plannedEndAt:             { type: string, format: date-time }
        status:                   { $ref: '#/components/schemas/MaintenanceStatus' }
        technicianName:           { type: string }
        authorityReferenceNumber: { type: string }
        partialOperationAllowed:  { type: boolean }
        qualificationLevelDuring: { type: string, nullable: true }
        completionNotes:          { type: string }

    CreateOverrideRequest:
      type: object
      required: [title, startAt, endAt]
      properties:
        simulatorId: { type: string, format: uuid, nullable: true }
        title:       { type: string }
        startAt:     { type: string, format: date-time }
        endAt:       { type: string, format: date-time }
        reason:      { type: string, nullable: true }
        isPublic:    { type: boolean, default: true }

    Envelope:
      type: object
      required: [data, meta, error]
      properties:
        data: {}
        meta:
          type: object
          properties:
            requestId: { type: string, format: uuid }
            timestamp: { type: string, format: date-time }
            pagination:
              type: object
              properties:
                page: { type: integer }
                pageSize: { type: integer }
                total: { type: integer }
        error: { nullable: true }

  responses:
    ScheduleList:    { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    ScheduleItem:    { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    BlockedPeriodList: { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    BlockedPeriodItem: { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    MaintenanceList: { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    MaintenanceItem: { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    OverrideList:    { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    OverrideItem:    { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Envelope' } } } }
    BadRequest:      { description: Validation error }
    Unauthenticated: { description: Missing or invalid token }
    Forbidden:       { description: Insufficient role }
    NotFound:        { description: Not found }
    BusinessRule:    { description: Business rule violation }
    InternalError:   { description: Unexpected server error }
```

---

## 4. TypeScript Interfaces

```typescript
export type BlockType =
  | 'HOLIDAY' | 'MAINTENANCE' | 'AUTHORITY_INSPECTION'
  | 'WEATHER_CLOSURE' | 'SPECIAL_EVENT' | 'OTHER';

export type MaintenanceType =
  | 'SCHEDULED_100H' | 'SCHEDULED_500H' | 'ANNUAL_RECERTIFICATION'
  | 'COMPONENT_REPLACEMENT' | 'SOFTWARE_UPGRADE' | 'UNSCHEDULED' | 'FSTD_REQUALIFICATION';

export type MaintenanceStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type ScheduleStatus    = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export type CalendarDayStatus =
  | 'AVAILABLE' | 'PARTIALLY_AVAILABLE' | 'BLOCKED'
  | 'HOLIDAY' | 'MAINTENANCE' | 'OVERRIDE_OPEN';

export type Region = 'FR' | 'ZA' | 'CN' | 'IN';

export interface DailyWindow {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
  openTime:  string;   // "HH:MM"
  closeTime: string;   // "HH:MM"
  isOpen:    boolean;
}

export interface OperatingSchedule {
  id:             string;
  tenantId:       string;
  simulatorId:    string | null;
  name:           string;
  effectiveFrom:  string;  // date
  effectiveUntil: string | null;
  status:         ScheduleStatus;
  timeZone:       string;
  dailyWindows:   DailyWindow[];
  notes:          string | null;
  createdBy:      string;
  createdAt:      string;
  updatedAt:      string;
  deletedAt:      string | null;
}

export interface BlockedPeriod {
  id:             string;
  tenantId:       string;
  simulatorId:    string | null;  // null = facility-wide
  blockType:      BlockType;
  title:          string;
  description:    string | null;
  startAt:        string;
  endAt:          string;
  isPublic:       boolean;
  recurrenceRule: string | null;
  affectsSlots:   boolean;
  propagatedAt:   string | null;
  createdBy:      string;
  createdAt:      string;
  updatedAt:      string;
  deletedAt:      string | null;
}

export interface MaintenanceRecord {
  id:                       string;
  tenantId:                 string;
  simulatorId:              string;
  blockedPeriodId:          string | null;
  maintenanceType:          MaintenanceType;
  title:                    string;
  description:              string | null;
  plannedStartAt:           string;
  plannedEndAt:             string;
  actualStartAt:            string | null;
  actualEndAt:              string | null;
  status:                   MaintenanceStatus;
  technicianName:           string | null;
  authorityReferenceNumber: string | null;
  partialOperationAllowed:  boolean;
  qualificationLevelDuring: string | null;
  completionNotes:          string | null;
  createdBy:                string;
  createdAt:                string;
  updatedAt:                string;
  deletedAt:                string | null;
}

export interface AvailabilityOverride {
  id:          string;
  tenantId:    string;
  simulatorId: string | null;
  title:       string;
  startAt:     string;
  endAt:       string;
  reason:      string | null;
  isPublic:    boolean;
  createdBy:   string;
  createdAt:   string;
  updatedAt:   string;
  deletedAt:   string | null;
}

export interface NationalHoliday {
  id:              string;
  region:          Region;
  year:            number;
  holidayDate:     string;
  name:            string;
  isFullDay:       boolean;
  autoCreateBlock: boolean;
}

export interface CalendarBlock {
  startAt:   string;
  endAt:     string;
  blockType: BlockType;
  title:     string | null;
}

export interface CalendarDay {
  date:               string;
  simulatorId:        string | null;
  status:             CalendarDayStatus;
  title:              string | null;
  availableSlotCount: number;
  totalSlotCount:     number;
  blocks:             CalendarBlock[];
}

export interface AvailabilityCheckResult {
  available:       boolean;
  reason:          string | null;
  blockType:       BlockType | null;
  blockedPeriodId: string | null;
}
```

---

## 5. Zod Schemas

```typescript
import { z } from 'zod';

export const blockTypeZ = z.enum([
  'HOLIDAY','MAINTENANCE','AUTHORITY_INSPECTION','WEATHER_CLOSURE','SPECIAL_EVENT','OTHER',
]);

export const maintenanceTypeZ = z.enum([
  'SCHEDULED_100H','SCHEDULED_500H','ANNUAL_RECERTIFICATION',
  'COMPONENT_REPLACEMENT','SOFTWARE_UPGRADE','UNSCHEDULED','FSTD_REQUALIFICATION',
]);

export const maintenanceStatusZ = z.enum(['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED']);

export const dailyWindowZ = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime:  z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
  closeTime: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
  isOpen:    z.boolean(),
}).refine(d => d.closeTime > d.openTime, { message: 'closeTime must be after openTime' });

export const createOperatingScheduleZ = z.object({
  simulatorId:    z.string().uuid().nullable().optional(),
  name:           z.string().min(1).max(255),
  effectiveFrom:  z.string().date(),
  effectiveUntil: z.string().date().nullable().optional(),
  timeZone:       z.string().min(1).max(64).default('UTC'),
  dailyWindows:   z.array(dailyWindowZ).length(7),
  notes:          z.string().max(2000).nullable().optional(),
});
export type CreateOperatingScheduleInput = z.infer<typeof createOperatingScheduleZ>;

export const updateOperatingScheduleZ = z.object({
  name:           z.string().min(1).max(255).optional(),
  effectiveUntil: z.string().date().nullable().optional(),
  dailyWindows:   z.array(dailyWindowZ).length(7).optional(),
  notes:          z.string().max(2000).nullable().optional(),
});
export type UpdateOperatingScheduleInput = z.infer<typeof updateOperatingScheduleZ>;

export const activateScheduleZ = z.object({
  effectiveFrom:  z.string().date(),
  effectiveUntil: z.string().date().nullable().optional(),
});
export type ActivateScheduleInput = z.infer<typeof activateScheduleZ>;

export const createBlockedPeriodZ = z.object({
  simulatorId:    z.string().uuid().nullable().optional(),
  blockType:      blockTypeZ,
  title:          z.string().min(1).max(255),
  description:    z.string().max(4000).nullable().optional(),
  startAt:        z.string().datetime(),
  endAt:          z.string().datetime(),
  isPublic:       z.boolean().default(true),
  recurrenceRule: z.string().max(255).nullable().optional(),
  affectsSlots:   z.boolean().default(true),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), {
  message: 'endAt must be after startAt',
});
export type CreateBlockedPeriodInput = z.infer<typeof createBlockedPeriodZ>;

export const updateBlockedPeriodZ = z.object({
  title:       z.string().min(1).max(255).optional(),
  description: z.string().max(4000).nullable().optional(),
  endAt:       z.string().datetime().optional(),
  isPublic:    z.boolean().optional(),
});
export type UpdateBlockedPeriodInput = z.infer<typeof updateBlockedPeriodZ>;

export const createMaintenanceZ = z.object({
  simulatorId:              z.string().uuid(),
  maintenanceType:          maintenanceTypeZ,
  title:                    z.string().min(1).max(255),
  description:              z.string().max(4000).nullable().optional(),
  plannedStartAt:           z.string().datetime(),
  plannedEndAt:             z.string().datetime(),
  technicianName:           z.string().max(255).nullable().optional(),
  authorityReferenceNumber: z.string().max(128).nullable().optional(),
  partialOperationAllowed:  z.boolean().default(false),
  qualificationLevelDuring: z.string().max(16).nullable().optional(),
  autoCreateBlockedPeriod:  z.boolean().default(true),
}).refine(d => new Date(d.plannedEndAt) > new Date(d.plannedStartAt), {
  message: 'plannedEndAt must be after plannedStartAt',
});
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceZ>;

export const updateMaintenanceZ = z.object({
  plannedEndAt:             z.string().datetime().optional(),
  status:                   maintenanceStatusZ.optional(),
  technicianName:           z.string().max(255).optional(),
  authorityReferenceNumber: z.string().max(128).optional(),
  partialOperationAllowed:  z.boolean().optional(),
  qualificationLevelDuring: z.string().max(16).nullable().optional(),
  completionNotes:          z.string().max(4000).optional(),
});
export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceZ>;

export const completeMaintZ = z.object({
  actualEndAt:              z.string().datetime().optional(),
  completionNotes:          z.string().min(10).max(4000),
  authorityReferenceNumber: z.string().max(128).optional(),
});
export type CompleteMaintenanceInput = z.infer<typeof completeMaintZ>;

export const createOverrideZ = z.object({
  simulatorId: z.string().uuid().nullable().optional(),
  title:       z.string().min(1).max(255),
  startAt:     z.string().datetime(),
  endAt:       z.string().datetime(),
  reason:      z.string().max(2000).nullable().optional(),
  isPublic:    z.boolean().default(true),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), { message: 'endAt must be after startAt' });
export type CreateOverrideInput = z.infer<typeof createOverrideZ>;

export const calendarQueryZ = z.object({
  from:        z.string().date(),
  until:       z.string().date(),
  simulatorId: z.string().uuid().optional(),
}).refine(d => d.until >= d.from, { message: 'until must be >= from' })
  .refine(d => {
    const days = (new Date(d.until).getTime() - new Date(d.from).getTime()) / 86_400_000;
    return days <= 92;
  }, { message: 'Calendar range cannot exceed 92 days' });
export type CalendarQueryInput = z.infer<typeof calendarQueryZ>;

export const importHolidaysZ = z.object({
  year:   z.number().int().min(2024).max(2030),
  region: z.enum(['FR','ZA','CN','IN']).optional(),
  dryRun: z.boolean().default(false),
});
export type ImportHolidaysInput = z.infer<typeof importHolidaysZ>;

export const availabilityCheckZ = z.object({
  simulatorId: z.string().uuid(),
  startAt:     z.string().datetime(),
  endAt:       z.string().datetime(),
}).refine(d => new Date(d.endAt) > new Date(d.startAt), { message: 'endAt must be after startAt' });
export type AvailabilityCheckInput = z.infer<typeof availabilityCheckZ>;
```

---

## 6. EventBridge Events

All events use source `aerocap.schedule`, bus `aerocap-{env}-training-bus`, envelope `{ tenantId, traceId, occurredAt, schemaVersion: '1.0', payload }`.

| Event | Trigger | Payload |
|---|---|---|
| `schedule.blocked_period.created` | POST /blocked-periods | `{ blockedPeriodId, simulatorId, blockType, startAt, endAt, affectsSlots }` |
| `schedule.blocked_period.updated` | PATCH /blocked-periods/:id | `{ blockedPeriodId, changes: string[] }` |
| `schedule.blocked_period.deleted` | DELETE /blocked-periods/:id | `{ blockedPeriodId, simulatorId, startAt, endAt, slotsRestored: number }` |
| `schedule.slots.blocked` | Async slot propagation completes | `{ blockedPeriodId, simulatorId, slotsAffected: number, reservationsCancelled: number }` |
| `schedule.slots.restored` | Block deleted/maintenance complete | `{ blockedPeriodId, simulatorId, slotsRestored: number }` |
| `schedule.maintenance.scheduled` | POST /maintenance | `{ maintenanceId, simulatorId, maintenanceType, plannedStartAt, plannedEndAt }` |
| `schedule.maintenance.started` | status → IN_PROGRESS | `{ maintenanceId, simulatorId, actualStartAt }` |
| `schedule.maintenance.completed` | POST /maintenance/:id/complete | `{ maintenanceId, simulatorId, actualEndAt, slotsRestored: number }` |
| `schedule.maintenance.overrun` | actualEndAt > plannedEndAt | `{ maintenanceId, simulatorId, overrunHours: number }` |
| `schedule.operating_schedule.activated` | POST /activate | `{ scheduleId, simulatorId, effectiveFrom, supersededScheduleId? }` |
| `schedule.holidays.imported` | POST /holidays/import | `{ region, year, imported: number, blockedPeriodsCreated: number }` |
| `schedule.reservation.cancelled_by_block` | Slot blocked with existing reservation | `{ reservationId, pilotId, simulatorId, blockedPeriodId, sessionDate }` |

**Critical event: `schedule.reservation.cancelled_by_block`**  
When a `BlockedPeriod` is created with `affectsSlots=true` and existing confirmed reservations fall within the block, the service MUST:
1. Mark affected slots as unavailable
2. Set affected reservations to `CANCELLED`
3. Emit one `schedule.reservation.cancelled_by_block` per affected reservation (triggers pilot notification)

---

## 7. Business Rules

### R-1 — Single active schedule per simulator
At most one `OperatingSchedule` with `status=ACTIVE` may exist per `(tenant_id, simulator_id)` at any given date. Activating a new schedule automatically `SUPERSEDES` the current one and sets its `effective_until = new schedule's effectiveFrom - 1 day`.

### R-2 — Slot availability decision tree
```
IS SLOT BOOKABLE?
  1. Is the slot's start_time within an active OperatingSchedule window?
     → If no: check for AvailabilityOverride covering this window
     → If still no: NOT BOOKABLE (outside operating hours)
  2. Does a BlockedPeriod cover this slot's time AND this simulator (or facility-wide)?
     → If yes: NOT BOOKABLE
  3. Is the slot already reserved?
     → If yes: NOT BOOKABLE
  → BOOKABLE
```

### R-3 — Cancellation notification window
If a `BlockedPeriod` is created or extended and it covers a reservation starting **within 72 hours**, the `schedule.reservation.cancelled_by_block` event must be emitted **immediately** and the pilot must receive a notification via the HRIS notification service.

### R-4 — Maintenance auto-creates BlockedPeriod
`POST /maintenance` with `autoCreateBlockedPeriod=true` (default) atomically creates a linked `BlockedPeriod` of type `MAINTENANCE` with `isPublic=false`. Completing maintenance (`POST /complete`) sets the block's `end_at = actualEndAt` and restores slots from that point forward.

### R-5 — Past block immutability
A `BlockedPeriod` whose `start_at` is in the past cannot have its `start_at` or `simulatorId` changed. Only `endAt` (to shorten a still-active block) and `description` can be updated.

### R-6 — Recurrence
A `BlockedPeriod` with a `recurrenceRule` (e.g., `FREQ=YEARLY` for a national holiday) automatically generates child `BlockedPeriod` records for the current and next calendar year during the import process. Individual instances can be deleted without affecting the series.

### R-7 — Access control

| Role | Can view calendar | Can view maintenance detail | Can create/edit blocks | Can complete maintenance |
|---|---|---|---|---|
| PILOT | Own-tenant public events only | No | No | No |
| INSTRUCTOR | Full calendar | Summary only | No | No |
| MANAGER | Full calendar + detail | Full | Yes (own region) | No |
| COUNTRY_ADMIN | Full calendar + detail | Full | Yes | Yes |
| GLOBAL_ADMIN | All tenants | Full | Yes | Yes |

### R-8 — No pilot double-booking on the same calendar day (ORO.FC §6.2 fatigue)
```
IF a pilot already has a confirmed reservation on date D (any session type, any simulator)
THEN the booking-service MUST reject any new reservation on date D for the same pilot.
Error: 422 PILOT_DOUBLE_BOOKING "Pilot already has a session scheduled on {date}."
Exception: GLOBAL_ADMIN or COUNTRY_ADMIN can override with a documented reason.
```

### R-9 — LPC/OPC minimum inter-check gap (AeroCap scheduling integrity)
```
IF sessionType IN ('LPC', 'OPC')
AND pilot has a prior LPC or OPC reservation within the last 30 days
THEN the booking-service MUST reject the new reservation.
Error: 422 CHECK_INTERVAL_VIOLATION "LPC/OPC cannot be scheduled within 30 days of a previous LPC/OPC (last: {date})."
Rationale: prevents gaming of proficiency records by rapid re-scheduling.
```

### R-10 — Session type ↔ simulator qualification level (EASA CS-FSTD(A))
```
LPC, OPC, ITR, UPRT: require simulator.qualificationLevel = 'FFS_D'
EBT:                  require simulator.qualificationLevel IN ('FFS_D', 'FFS_C')
RECURRENT, LINE_CHECK: require simulator.qualificationLevel IN ('FFS_D','FFS_C','FFS_B','FTD')
FREE_PRACTICE:         no qualification constraint

During MAINTENANCE with partialOperationAllowed = true:
  simulator.effectiveQualificationLevel = maintenance_record.qualificationLevelDuring
  Apply same rules using effectiveQualificationLevel.

Error: 422 QUALIFICATION_LEVEL_MISMATCH "Session type {type} requires FFS Level D. Simulator {name} is currently qualified as {level}."
```

### R-11 — Instructor qualification gate (ORA.ATO.110)
```
This check is owned by booking-service, triggered when creating/confirming a reservation:
LPC, OPC, ITR:   instructor must hold active TRE qualification for this aircraft type.
RECURRENT, EBT:  instructor must hold active TRI qualification for this aircraft type.
UPRT:            instructor must hold APS MCC certification + TRI.
LINE_CHECK:      TRI sufficient; no TRE required.
FREE_PRACTICE:   no instructor qualification check required.

Source: instructor-records service (GET /api/v1/instructors/{id}/qualifications).
Error: 422 INSTRUCTOR_NOT_QUALIFIED "Instructor {name} does not hold a valid TRE qualification for {aircraftType}."
```
`[OPEN: instructor-records service spec is not yet written — the qualification lookup contract must be defined before this can be implemented]`

### R-12 — Recency gap warning (FCL.060)
```
IF pilot has not flown the aircraft type (any simulator session, any status CONFIRMED)
   in the preceding 90 days
THEN include in the booking confirmation response:
  { warnings: [{ code: 'RECENCY_GAP', message: 'Pilot has not flown {type} in > 90 days. Verify FCL.060 recent experience.' }] }
This is a WARNING only — it does not block the booking.
```

### R-13 — Mandatory FFS Level D 4-week maintenance cycle (EASA CS-FSTD(A) Appendix 1)
```
IF simulator.qualificationLevel = 'FFS_D'
AND no MaintenanceRecord with status IN ('PLANNED','IN_PROGRESS','COMPLETED')
   exists within the next 28 days for this simulator
THEN emit EventBridge event: schedule.maintenance.cycle_overdue
   and create a MANAGER notification: "FFS maintenance window due within 28 days for {simulatorName}."
Minimum maintenance window: 8 hours.
```

---

## 8. One-Page Summary

| Area | Count |
|---|---|
| Primary entities | 5 (OperatingSchedule, BlockedPeriod, MaintenanceRecord, AvailabilityOverride, NationalHolidayCalendar) |
| Read models | 1 (CalendarDay) |
| DB tables | 5 + 1 audit log |
| API endpoint groups | 7 |
| Explicit endpoints | 22 |
| EventBridge events | 13 (+ `schedule.maintenance.cycle_overdue`) |
| Business rules | 13 (R-1 through R-13; R-8–R-13 are booking-layer rules) |
| Acceptance criteria | 8 groups, 35 individual criteria |
| Error responses required | 400, 401, 403, 404, 409, 410, 422, 500 |
| Regulatory citations | 7 (EASA CS-FSTD(A), ORA.ATO, ORO.FC, FCL.060, ICAO 9625) |
| Training-mgmt validation | §9 — 2 domain gaps, 8 edge cases, 5 inspector queries mapped |

**Open questions:**
- `[OPEN-1]` Should cancellation triggered by a new block require admin sign-off, or auto-cancel with pilot email only?
- `[OPEN-2]` National holiday data source — static JSON bundled in service, or live API (e.g., Nager.Date)?
- `[OPEN-3]` Maintenance overrun threshold for `schedule.maintenance.overrun` event — 1h? 4h?
- `[OPEN-4]` Does `AvailabilityOverride` also generate slot records in booking-service, or only lift the blocking check at query time?
- `[OPEN-5]` Multi-timezone: for ZA/CN/IN tenants, should `DailyWindow` times be stored in local time (with `timeZone` field) or always UTC? Recommend local + IANA tz.

---

## 9. Training-Management Domain Validation

> **Perspective:** @subagents/training-management.md — Training Captain / TRE with 20 years operational experience and 8 years designing digital training management systems for ATOs.

### 9.1 Domain Validation — Regulatory Alignment

**EASA alignment: PASS with gaps (see §9.3)**

The scheduling architecture correctly models the primary constraint surfaces an EASA inspector examines: simulator availability, maintenance periods, and qualification level during maintenance. The following positive findings apply:

- `MaintenanceRecord.qualificationLevelDuring` — correctly captures the reduced FSTD level during partial maintenance. An inspector reviewing a session record can cross-reference against the maintenance log to confirm the simulator was qualified for the session type at time of training.
- `MaintenanceRecord.authorityReferenceNumber` — correctly captures the DGAC/EASA FSTD requalification reference required under CS-FSTD(A) Appendix 1.
- Soft-delete on all tables — satisfies ORA.ATO.220 (5-year minimum retention). Recommend documenting a 10-year retention policy for FFS Level D training records separately in the data retention policy.
- `simulator_schedule_audit_log` — every mutation carries actor ID + role + old/new value. This satisfies the immutability audit requirement for an EASA inspector examining whether a maintenance window was altered after the fact.

**SACAA / ICAO alignment (tenant-za / AfraSky):** SACAA CATS Part 61 does not specify FFS maintenance cycle frequency — the 4-week rule (R-13) is EASA-specific. For tenant-za, R-13 should be configurable per tenant (recommended default: also 4 weeks, per ICAO Doc 9625 best practice).

**FAA alignment (future US tenants):** FAA AC 120-53B §6.2 requires simulator maintenance records be available during NSPM evaluation. `MaintenanceRecord` covers this. No FAA-specific gaps identified at this time.

---

### 9.2 Mandatory Fields — Regulatory Completeness Check

An EASA inspector evaluating a training record will ask: "Was the simulator approved at the required level at the time of this session?" The current spec enables this check, but the following fields are **mandatory** and must be captured at reservation time (not just at schedule time):

| Field | Where it must be stored | Current status |
|---|---|---|
| `simulator_qualification_level` at time of session | Reservation record (booking-service) | **MISSING** — `Reservation` has `simulator_id` but not the effective qualification level at booking time |
| `effective_qualification_level_during_session` | Reservation record | **MISSING** — if maintenance was active, the reduced level must be snapshotted |
| `maintenance_record_id` (if session during partial maint.) | Reservation record | **MISSING** |

**Action required (booking-service):** When creating a reservation, the booking-service must:
1. Call `GET /api/v1/schedule/availability?simulatorId={id}&startAt={t}&endAt={t}` to check availability.
2. If available, snapshot `simulator.qualificationLevel` (or `maintenance_record.qualificationLevelDuring` if in partial maintenance) onto the reservation record as `simulatorQualificationLevelAtBooking`.
3. Reject the booking if the effective qualification level is insufficient for the session type (R-10).

This is an inspector requirement, not just a product rule. A session record without the simulator qualification level at time of session is a **void record** for EASA purposes.

---

### 9.3 Business Rule Compliance Matrix

| Rule | Source | In spec? | Notes |
|---|---|---|---|
| No two simulator sessions same day per pilot | ORO.FC.230 §6.2 (fatigue) | R-8 ✓ | |
| LPC/OPC 30-day gap | AeroCap scheduling integrity | R-9 ✓ | Not an EASA rule per se, but correct operational practice |
| Session type ↔ FFS level | CS-FSTD(A) Appendix 1 | R-10 ✓ | Needs snapshot on reservation (see §9.2) |
| Instructor qualification for session type | ORA.ATO.110 | R-11 ✓ | Needs instructor-records service contract |
| FCL.060 recency warning | FCL.060(b) | R-12 ✓ | Warning only — correct; blocking would be an operational overreach |
| FFS Level D 4-week maintenance cycle | CS-FSTD(A) Appendix 1 | R-13 ✓ | Should be tenant-configurable |
| Maintenance record retention ≥ 5 years | ORA.ATO.220 | Soft-delete ✓ | Explicitly document retention period |
| Maintenance records must include authority reference for FSTD requalification | CS-FSTD(A) §45 | `authorityReferenceNumber` ✓ | |
| Simulator booking cannot exceed operating hours | OperatingSchedule | R-2 ✓ | |
| Block propagation to existing reservations with <72h notice | Operational safety | R-3 ✓ | |
| No modification of past block `start_at` | Audit integrity | R-5 ✓ | |

**Gap identified:** The spec has no rule preventing a pilot from booking **across midnight** (e.g., 22:00–02:00). Session duration for OPC/LPC is 90 minutes minimum — but nothing prevents a booking window that crosses the operating schedule boundary. Add: `R-14 — No booking may span across the close time of an OperatingSchedule window.`

---

### 9.4 Edge Cases — Aviation-Specific

| Edge case | What must happen | Current handling |
|---|---|---|
| Maintenance overruns into a booked slot | Cancel reservation, emit `cancelled_by_block`, notify pilot | R-3 / R-4 ✓ — verify atomic transaction |
| FFS Level D de-qualified mid-session (emergency maintenance declared) | In-progress session is valid (session already underway); next slot is blocked; emit `maintenance.started` with `qualificationLevelDuring` update | **NOT ADDRESSED** — spec assumes maintenance is pre-planned. Add: emergency maintenance can be created with `status=IN_PROGRESS` and back-dated `actualStartAt`. |
| Pilot cancels reservation during an active BlockedPeriod | Slot is already `MAINTENANCE`/`HOLIDAY` — restoring `is_available=1` would incorrectly make it bookable again | **GAP** — when cancelling a reservation, booking-service must re-check schedule availability before restoring the slot. Do NOT restore if slot overlaps an active BlockedPeriod. |
| Maintenance completed early | `actualEndAt < plannedEndAt` — slots between actual and planned end should be restored | R-4 partial ✓ — `POST /complete` sets `end_at = actualEndAt`. Confirm slot restore logic uses `actualEndAt` not `plannedEndAt`. |
| National holiday on a normally-open Saturday | Holiday block correctly overrides the OperatingSchedule (Saturday is open) | R-2 step 2 ✓ — BlockedPeriod check runs after OperatingSchedule check. |
| Simulator in QTG (Qualification Test Guide) check | QTG checks are 4–8 hours, simulator is fully de-qualified for that window | Use `maintenanceType = FSTD_REQUALIFICATION` with `partialOperationAllowed = false`. ✓ |
| Double maintenance records for same simulator same window | Two separate maintenance teams book overlapping windows | **GAP** — no unique constraint prevents two `MaintenanceRecord` rows for the same simulator and overlapping time. Add: application-level overlap check for `PLANNED` / `IN_PROGRESS` maintenance records on the same simulator. |

---

### 9.5 Regulatory Citations

| Ref | Text | Satisfied by |
|---|---|---|
| CS-FSTD(A) Appendix 1, §1.2 | FFS shall be subjected to recurrent evaluations at intervals not exceeding 12 months | `MaintenanceRecord.maintenanceType = ANNUAL_RECERTIFICATION` |
| CS-FSTD(A) Appendix 1, §3 | Operator shall maintain records of all maintenance activities | `maintenance_record` table, retained via soft-delete |
| ORA.ATO.220 | Records shall be kept for minimum 5 years | Soft-delete + `deleted_at` — document retention schedule separately |
| ORO.FC.230 Appendix 10 §6 | EBT sessions require an FFS of at least Level C | R-10 ✓ |
| FCL.060(b) | Recent experience — 3 T/O + 3 landings in 90 days or proficiency check | R-12 warning ✓ — note: FCL.060 applies to actual flights, not simulator; booking system can only warn |
| ICAO Doc 9625 §3.2.3 | FSTD maintenance interval recommendations | R-13 — configurable cycle length covers this |
| ORA.ATO.110 | Training and checking conducted by qualified TRI/TRE | R-11 ✓ — requires instructor-records integration |

---

### 9.6 Inspector View — What an EASA Auditor Examines

When an EASA ORA inspector audits an AeroCap tenant, they will request the following report covering any given 6-month training cycle:

```
1. For each simulator: list all sessions conducted, with:
   — session date and time
   — simulator qualification level at time of session
   — any maintenance periods overlapping with sessions (should be zero)

2. For each maintenance window: list planned vs actual, technician, authority reference number.

3. Any sessions conducted during a period when the simulator was de-qualified (FindingLevel: 1 — immediately ground-stopping).

4. Any LPC/OPC sessions where the instructor was not a qualified TRE (Finding Level 1).

5. Any pilot with more than one simulator session on a single day (Finding Level 2 — fatigue protocol violation).
```

The spec, as written with the additions in §9.2 (qualifier snapshot on reservation), generates a data model that answers all five inspector queries. **Item 3 is the highest risk** — a session conducted when `effectiveQualificationLevel < required` is a Level 1 finding that could suspend the ATO's approval. The R-10 enforcement gate is the primary guard.

---

### 9.7 Implementation Notes — Handoff to booking-service

The following changes are required in the existing `booking-service` before this spec can be fully implemented:

1. **Add `simulator_qualification_level_at_booking VARCHAR(10)` to `reservations` table** — populated from the schedule availability check response.

2. **Add `maintenance_record_id UUID` (nullable) to `reservations` table** — set if session is booked during a partial-operation maintenance window.

3. **Replace the current `slots.is_available` simplistic check** with a call to `GET /api/v1/schedule/availability` from the schedule service. The schedule service is the single source of truth for availability; `is_available` becomes a cached/denormalized hint only.

4. **Add booking validation middleware** that runs R-8 (double-booking), R-9 (LPC/OPC gap), R-10 (qualification level), and R-12 (recency warning) before confirming any reservation.

5. **Slot cancellation guard** — when `DELETE /api/v1/reservations/:id` runs, before restoring `is_available = 1`, re-query the schedule service. If the slot's window overlaps an active `BlockedPeriod`, leave `is_available = 0`.

---

## 10. Acceptance Criteria

### AC-1 — Operating Schedule
- [ ] Admin/Manager can create a `DRAFT` schedule with 7 `DailyWindow` entries.
- [ ] A `DRAFT` schedule can be edited; an `ACTIVE` schedule cannot (returns 410).
- [ ] Activating a schedule automatically sets the previous active schedule to `SUPERSEDED`.
- [ ] Only one `ACTIVE` schedule exists per `(tenant_id, simulator_id)` at any point in time.
- [ ] A pilot querying `/calendar` sees no slots outside the active schedule's open hours.

### AC-2 — Blocked Periods
- [ ] Admin/Manager can create a `HOLIDAY`, `MAINTENANCE`, `WEATHER_CLOSURE`, or `OTHER` block.
- [ ] Creating a block with `affectsSlots = true` marks all overlapping `slots` as `is_available = 0`.
- [ ] Pilots querying `/api/v1/slots?available=true` do not see slots covered by any active `BlockedPeriod`.
- [ ] A pilot cannot book a slot that overlaps a `BlockedPeriod` (returns 409 with appropriate error code).
- [ ] Deleting a `BlockedPeriod` restores slot availability (unless a maintenance record still covers the window).
- [ ] A `BlockedPeriod` whose `start_at` is in the past cannot have its `start_at` modified (returns 410).

### AC-3 — Maintenance
- [ ] Creating a maintenance record with `autoCreateBlockedPeriod = true` atomically creates a linked `BlockedPeriod`.
- [ ] `POST /maintenance/{id}/complete` updates `BlockedPeriod.end_at` to `actualEndAt` and restores future slots.
- [ ] If `actualEndAt < plannedEndAt`, slots between `actualEndAt` and `plannedEndAt` are restored and made bookable.
- [ ] `MaintenanceRecord.qualificationLevelDuring` propagates to `BlockedPeriod` metadata so booking-service R-10 can use the reduced level.
- [ ] `FSTD_REQUALIFICATION` maintenance type sets `isPublic = false` on the linked `BlockedPeriod`.
- [ ] A maintenance overrun event (`schedule.maintenance.overrun`) fires when `actualEndAt > plannedEndAt`.
- [ ] FFS Level D simulators generate a `schedule.maintenance.cycle_overdue` event if no maintenance is planned within 28 days (R-13).

### AC-4 — Booking Rules
- [ ] A pilot cannot have two confirmed reservations on the same calendar day (R-8 returns 422).
- [ ] A GLOBAL_ADMIN or COUNTRY_ADMIN can override the double-booking rule with a documented reason.
- [ ] LPC/OPC booking within 30 days of a previous LPC/OPC is rejected (R-9 returns 422).
- [ ] Booking an OPC/LPC on a simulator with `qualificationLevel < FFS_D` is rejected (R-10 returns 422).
- [ ] Booking an EBT session on a simulator with `qualificationLevel < FFS_C` is rejected (R-10 returns 422).
- [ ] A pilot with > 90 days since last session receives a `RECENCY_GAP` warning in the booking response (not a block).
- [ ] `simulator_qualification_level_at_booking` is stored on every new `Reservation` record.

### AC-5 — Calendar API
- [ ] `GET /api/v1/schedule/calendar?from=&until=` returns correct `CalendarDay` entries for a 92-day window.
- [ ] Days with a holiday `BlockedPeriod` return `status = HOLIDAY` and the public title (for pilots).
- [ ] Days with a maintenance `BlockedPeriod` return `status = MAINTENANCE` with no title/description for pilots (`isPublic = false`).
- [ ] `AvailabilityOverride` on a closed day returns `status = OVERRIDE_OPEN`.
- [ ] Pilots only see `isPublic = true` block titles; internal details are filtered server-side.

### AC-6 — Audit Trail
- [ ] Every CREATE, UPDATE, DELETE, ACTIVATE, and COMPLETE operation writes a row to `simulator_schedule_audit_log`.
- [ ] The audit log includes `actor_id`, `actor_role`, `old_value` (JSON), and `new_value` (JSON).
- [ ] Audit log rows are never soft-deleted — they are append-only.
- [ ] An EASA inspector query for all changes to a simulator's schedule over a 12-month period returns a complete audit trail.

### AC-7 — Cancellation-by-block Notification
- [ ] When a `BlockedPeriod` is created that covers an existing confirmed reservation, the reservation is cancelled within the same transaction.
- [ ] A `schedule.reservation.cancelled_by_block` event is emitted per affected reservation.
- [ ] If the affected session starts within 72 hours, the HRIS notification service sends an immediate push/email to the pilot.

### AC-8 — Multi-Tenant Isolation
- [ ] All queries include `tenant_id` filter derived from JWT; no cross-tenant data is returned.
- [ ] A MANAGER scoped to region FR (`managerRegions: ['FR']`) cannot modify schedules for tenant-za.
- [ ] National holiday import uses the tenant's region by default; cannot import holidays for a different region without GLOBAL_ADMIN role.
