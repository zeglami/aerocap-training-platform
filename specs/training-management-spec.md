# AeroCap Training Platform — Master Specification (Missing Domains A-F)

**Author:** Training Captain/TRE + Senior API Architect (dual persona)
**Date:** 2026-05-29
**Status:** Production contract — implementation team builds against this verbatim
**Regulatory baseline:** EASA Part-FCL Amdt 11, ICAO Doc 9868 (PANS-TRG) 2nd ed., ICAO Doc 9995 (EBT), FAA 14 CFR Parts 61/121, SACAA CATS-FCL

---

## Cross-cutting conventions (apply to every service below)

- Base URL: `/api/v1/{service}`
- Auth: `Authorization: Bearer <JWT>` — claims required: `sub` (userId), `tenant_id`, `roles[]`, `pilot_id?`, `instructor_id?`
- Response envelope (success): `{ "data": <T>, "meta": { "requestId": "uuid", "timestamp": "ISO8601", "pagination?": { "page": int, "pageSize": int, "total": int } } }`
- Response envelope (error): `{ "error": { "code": "STRING_CONST", "message": "string", "details?": object }, "meta": { "requestId": "uuid", "timestamp": "ISO8601" } }`
- Error codes: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 410 `IMMUTABLE_RECORD`, 422 `BUSINESS_RULE_VIOLATION`, 500 `INTERNAL_ERROR`
- All UUIDs: PostgreSQL `gen_random_uuid()` (RFC 4122 v4)
- All timestamps: `TIMESTAMPTZ`, ISO 8601 with Zulu offset on the wire
- All money/duration: integer minutes for duration; no floats for compliance figures
- Soft delete only on training records (`deleted_at`)
- `audit_log` table is owned by `reporting-service` (already implemented); every mutation in domains A-F writes one row via the shared `auditLogger` middleware
- EventBridge bus: `aerocap-{env}-training-bus` — every event carries `{ tenantId, traceId, occurredAt, schemaVersion, payload }`
- All list endpoints: `?page=1&pageSize=25&sort=field:asc&filter[...]`, max `pageSize=100`

**Inspector-driven design principle:** every entity stores `assessed_at`, `session_type`, `simulator_id`, `simulator_qualification_level`, `instructor_id`, `instructor_qualification` wherever a training event is recorded. The inspector must be able to answer "who, what, where, when, what level, signed by whom" from a single row.

---

# SERVICE A — `training-programmes`

**Regulatory anchor:** Part-FCL.725 (type-rating course), FCL.740 (revalidation), ORO.FC.230 (recurrent training & checking), ICAO Doc 9868 §II.2 (course design), Part-ORA.ATO.230 (training programme approval).

**Purpose:** Define curricula (type-rating, recurrent, OPC/LPC, EBT), break them into phases and modules with hard prerequisite chains, capture authority approval references, and expose gate criteria that downstream services (cbta, deficit-tracking, regulatory-reports) consume.

---

## A.1 Entity model

| Entity | Key fields | Notes |
|---|---|---|
| `TrainingProgramme` | id, tenantId, code, title, aircraftType, programmeType (TYPE_RATING\|RECURRENT\|OPC\|LPC\|EBT\|MCC\|JOC\|UPRT\|LIFUS\|TRI_COURSE\|TRE_COURSE), regulatoryFramework (EASA\|FAA\|SACAA\|DGCA\|CAAC), authorityApprovalRef, approvalValidFrom, approvalValidUntil, version, status (DRAFT\|APPROVED\|RETIRED), supersedesProgrammeId | ATO-approved syllabus |
| `ProgrammePhase` | id, tenantId, programmeId, sequence, code, title, durationHours, minimumSessions, deliveryMode (GROUND\|FFS\|FTD\|FNPT\|AIRCRAFT\|LIFUS\|CBT) | Ordered phases |
| `ProgrammeModule` | id, tenantId, phaseId, sequence, code, title, learningObjectives[], competencyUnitCodes[] (refs cbta CU codes), mandatory | Atomic teaching unit |
| `Prerequisite` | id, tenantId, moduleId, prerequisiteModuleId, type (HARD\|SOFT), waiverAllowedByRole (CFI\|TRE\|NONE) | DAG enforced |
| `GateCriterion` | id, tenantId, phaseId, criterionType (MIN_CU_SCORE\|ALL_MODULES_COMPLETE\|MEDICAL_VALID\|RECENCY_OK\|LIFUS_SECTORS_MIN\|EXAMINER_SIGN_OFF), parameters JSONB, blocksProgression | Inspector-visible "gate" |
| `ProgrammeEnrolment` | id, tenantId, programmeId, pilotId, enrolledAt, expectedCompletionAt, completedAt, status (ENROLLED\|IN_PROGRESS\|COMPLETED\|WITHDRAWN\|FAILED), withdrawalReason | Per-pilot |
| `ProgrammeProgress` | id, tenantId, enrolmentId, phaseId, status, startedAt, completedAt, gateOverrideBy, gateOverrideReason | Phase-level progress |

---

## A.2 DB schema

```sql
CREATE TABLE training_programme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  aircraft_type VARCHAR(32) NOT NULL,                  -- ICAO type designator e.g. A320, B738
  programme_type VARCHAR(32) NOT NULL CHECK (programme_type IN
    ('TYPE_RATING','RECURRENT','OPC','LPC','EBT','MCC','JOC','UPRT','LIFUS','TRI_COURSE','TRE_COURSE')),
  regulatory_framework VARCHAR(16) NOT NULL CHECK (regulatory_framework IN
    ('EASA','FAA','SACAA','DGCA','CAAC')),
  authority_approval_ref VARCHAR(128) NOT NULL,        -- e.g. EASA.ATO.FR.0123/TR-A320/v4
  approval_valid_from DATE NOT NULL,
  approval_valid_until DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  supersedes_programme_id UUID REFERENCES training_programme(id),
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_programme_code_version UNIQUE (tenant_id, code, version)
);
CREATE INDEX idx_programme_tenant_id ON training_programme (tenant_id, id);
CREATE INDEX idx_programme_aircraft ON training_programme (tenant_id, aircraft_type, status);

CREATE TABLE programme_phase (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  programme_id UUID NOT NULL REFERENCES training_programme(id),
  sequence INTEGER NOT NULL,
  code VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  duration_hours NUMERIC(6,2) NOT NULL,
  minimum_sessions INTEGER NOT NULL,
  delivery_mode VARCHAR(16) NOT NULL CHECK (delivery_mode IN
    ('GROUND','FFS','FTD','FNPT','AIRCRAFT','LIFUS','CBT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_phase_sequence UNIQUE (tenant_id, programme_id, sequence)
);
CREATE INDEX idx_phase_tenant_id ON programme_phase (tenant_id, id);

CREATE TABLE programme_module (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  sequence INTEGER NOT NULL,
  code VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  competency_unit_codes JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["AP","COM","FPA",...]
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_module_tenant_id ON programme_module (tenant_id, id);
CREATE INDEX idx_module_phase ON programme_module (tenant_id, phase_id, sequence);

CREATE TABLE prerequisite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  module_id UUID NOT NULL REFERENCES programme_module(id),
  prerequisite_module_id UUID NOT NULL REFERENCES programme_module(id),
  type VARCHAR(8) NOT NULL CHECK (type IN ('HARD','SOFT')),
  waiver_allowed_by_role VARCHAR(8) NOT NULL CHECK (waiver_allowed_by_role IN ('CFI','TRE','NONE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_no_self_prereq CHECK (module_id <> prerequisite_module_id),
  CONSTRAINT uq_prereq UNIQUE (tenant_id, module_id, prerequisite_module_id)
);
CREATE INDEX idx_prereq_tenant_id ON prerequisite (tenant_id, id);

CREATE TABLE gate_criterion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  criterion_type VARCHAR(32) NOT NULL CHECK (criterion_type IN
    ('MIN_CU_SCORE','ALL_MODULES_COMPLETE','MEDICAL_VALID','RECENCY_OK',
     'LIFUS_SECTORS_MIN','EXAMINER_SIGN_OFF')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {"minScore":3,"cuCodes":["AP","COM"]}
  blocks_progression BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_gate_tenant_id ON gate_criterion (tenant_id, id);
CREATE INDEX idx_gate_phase ON gate_criterion (tenant_id, phase_id);

CREATE TABLE programme_enrolment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  programme_id UUID NOT NULL REFERENCES training_programme(id),
  pilot_id UUID NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_completion_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'ENROLLED' CHECK (status IN
    ('ENROLLED','IN_PROGRESS','COMPLETED','WITHDRAWN','FAILED')),
  withdrawal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_enrolment_active UNIQUE (tenant_id, programme_id, pilot_id, deleted_at)
);
CREATE INDEX idx_enrolment_tenant_id ON programme_enrolment (tenant_id, id);
CREATE INDEX idx_enrolment_pilot ON programme_enrolment (tenant_id, pilot_id, status);

CREATE TABLE programme_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  enrolment_id UUID NOT NULL REFERENCES programme_enrolment(id),
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  status VARCHAR(16) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN
    ('NOT_STARTED','IN_PROGRESS','GATE_BLOCKED','COMPLETED','FAILED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  gate_override_by UUID,
  gate_override_reason TEXT,
  gate_override_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_progress UNIQUE (tenant_id, enrolment_id, phase_id)
);
CREATE INDEX idx_progress_tenant_id ON programme_progress (tenant_id, id);
```

---

## A.3 OpenAPI 3.0

```yaml
openapi: 3.0.3
info: { title: AeroCap Training Programmes API, version: 1.0.0 }
servers: [{ url: https://api.aerocap.aero/api/v1/training-programmes }]
security: [{ bearerAuth: [] }]
paths:
  /programmes:
    get:
      summary: List programmes
      parameters:
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: pageSize, in: query, schema: { type: integer, default: 25, maximum: 100 } }
        - { name: aircraftType, in: query, schema: { type: string } }
        - { name: programmeType, in: query, schema: { $ref: '#/components/schemas/ProgrammeType' } }
        - { name: status, in: query, schema: { type: string, enum: [DRAFT,APPROVED,RETIRED] } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeListResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }
    post:
      summary: Create programme (CFI only)
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
  /programmes/{id}:
    get:
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeResponse' }}}}
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }
    patch:
      summary: Update draft programme
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeUpdate' }}}}
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '410': { $ref: '#/components/responses/Immutable' }
        '500': { $ref: '#/components/responses/InternalError' }
  /programmes/{id}/approve:
    post:
      summary: Approve programme (CFI only) — locks structure
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      responses:
        '200': { description: Approved, content: { application/json: { schema: { $ref: '#/components/schemas/ProgrammeResponse' }}}}
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
  /programmes/{id}/retire:
    post:
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      responses:
        '200': { description: Retired }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }
  /programmes/{id}/phases:
    get: { responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/PhaseListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}, parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]}
    post:
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/PhaseCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/PhaseResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
  /phases/{phaseId}/modules:
    get: { responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ModuleListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}, parameters: [{ name: phaseId, in: path, required: true, schema: { type: string, format: uuid }}]}
    post:
      parameters: [{ name: phaseId, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/ModuleCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/ModuleResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
  /modules/{moduleId}/prerequisites:
    get: { responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/PrereqListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}, parameters: [{ name: moduleId, in: path, required: true, schema: { type: string, format: uuid }}]}
    post:
      parameters: [{ name: moduleId, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/PrereqCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/PrereqResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '409': { description: Cycle detected, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
        '500': { $ref: '#/components/responses/InternalError' }
  /phases/{phaseId}/gates:
    get: { responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/GateListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}, parameters: [{ name: phaseId, in: path, required: true, schema: { type: string, format: uuid }}]}
    post:
      parameters: [{ name: phaseId, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/GateCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/GateResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }
  /enrolments:
    get: { parameters: [{ name: pilotId, in: query, schema: { type: string, format: uuid }}, { name: status, in: query, schema: { type: string }}, { name: page, in: query, schema: { type: integer, default: 1 }}, { name: pageSize, in: query, schema: { type: integer, default: 25 }}], responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/EnrolmentListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '500': { $ref: '#/components/responses/InternalError' }}}
    post:
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/EnrolmentCreate' }}}}
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/EnrolmentResponse' }}}}
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
  /enrolments/{id}:
    get: { parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}], responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/EnrolmentResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}}
  /enrolments/{id}/progress:
    get: { parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}], responses: { '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ProgressListResponse' }}}}, '401': { $ref: '#/components/responses/Unauthenticated' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '500': { $ref: '#/components/responses/InternalError' }}}
  /enrolments/{id}/gate-override:
    post:
      summary: Override a blocked gate (CFI only)
      parameters: [{ name: id, in: path, required: true, schema: { type: string, format: uuid }}]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/GateOverrideRequest' }}}}
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/ProgressResponse' }}}}
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  schemas:
    ProgrammeType: { type: string, enum: [TYPE_RATING,RECURRENT,OPC,LPC,EBT,MCC,JOC,UPRT,LIFUS,TRI_COURSE,TRE_COURSE] }
    Programme:
      type: object
      required: [id, tenantId, code, title, aircraftType, programmeType, regulatoryFramework, authorityApprovalRef, approvalValidFrom, approvalValidUntil, version, status, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        code: { type: string }
        title: { type: string }
        aircraftType: { type: string }
        programmeType: { $ref: '#/components/schemas/ProgrammeType' }
        regulatoryFramework: { type: string, enum: [EASA,FAA,SACAA,DGCA,CAAC] }
        authorityApprovalRef: { type: string }
        approvalValidFrom: { type: string, format: date }
        approvalValidUntil: { type: string, format: date }
        version: { type: integer }
        status: { type: string, enum: [DRAFT,APPROVED,RETIRED] }
        supersedesProgrammeId: { type: string, format: uuid, nullable: true }
        createdBy: { type: string, format: uuid }
        approvedBy: { type: string, format: uuid, nullable: true }
        approvedAt: { type: string, format: date-time, nullable: true }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
    ProgrammeCreate:
      type: object
      required: [code, title, aircraftType, programmeType, regulatoryFramework, authorityApprovalRef, approvalValidFrom, approvalValidUntil]
      properties:
        code: { type: string, maxLength: 64 }
        title: { type: string, maxLength: 255 }
        aircraftType: { type: string }
        programmeType: { $ref: '#/components/schemas/ProgrammeType' }
        regulatoryFramework: { type: string, enum: [EASA,FAA,SACAA,DGCA,CAAC] }
        authorityApprovalRef: { type: string }
        approvalValidFrom: { type: string, format: date }
        approvalValidUntil: { type: string, format: date }
        supersedesProgrammeId: { type: string, format: uuid, nullable: true }
    ProgrammeUpdate:
      type: object
      properties:
        title: { type: string }
        approvalValidUntil: { type: string, format: date }
        authorityApprovalRef: { type: string }
    Phase:
      type: object
      required: [id, tenantId, programmeId, sequence, code, title, durationHours, minimumSessions, deliveryMode]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        programmeId: { type: string, format: uuid }
        sequence: { type: integer, minimum: 1 }
        code: { type: string }
        title: { type: string }
        durationHours: { type: number }
        minimumSessions: { type: integer, minimum: 1 }
        deliveryMode: { type: string, enum: [GROUND,FFS,FTD,FNPT,AIRCRAFT,LIFUS,CBT] }
    PhaseCreate: { allOf: [{ $ref: '#/components/schemas/Phase' }] }
    Module:
      type: object
      required: [id, tenantId, phaseId, sequence, code, title, mandatory]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        phaseId: { type: string, format: uuid }
        sequence: { type: integer }
        code: { type: string }
        title: { type: string }
        learningObjectives: { type: array, items: { type: string } }
        competencyUnitCodes: { type: array, items: { type: string, enum: [AP,COM,FPA,FPM,LT,PSD,SA,WM] } }
        mandatory: { type: boolean }
    ModuleCreate: { allOf: [{ $ref: '#/components/schemas/Module' }] }
    Prerequisite:
      type: object
      required: [id, tenantId, moduleId, prerequisiteModuleId, type, waiverAllowedByRole]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        moduleId: { type: string, format: uuid }
        prerequisiteModuleId: { type: string, format: uuid }
        type: { type: string, enum: [HARD,SOFT] }
        waiverAllowedByRole: { type: string, enum: [CFI,TRE,NONE] }
    PrereqCreate: { allOf: [{ $ref: '#/components/schemas/Prerequisite' }] }
    Gate:
      type: object
      required: [id, tenantId, phaseId, criterionType, parameters, blocksProgression]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        phaseId: { type: string, format: uuid }
        criterionType: { type: string, enum: [MIN_CU_SCORE,ALL_MODULES_COMPLETE,MEDICAL_VALID,RECENCY_OK,LIFUS_SECTORS_MIN,EXAMINER_SIGN_OFF] }
        parameters: { type: object, additionalProperties: true }
        blocksProgression: { type: boolean }
    GateCreate: { allOf: [{ $ref: '#/components/schemas/Gate' }] }
    Enrolment:
      type: object
      required: [id, tenantId, programmeId, pilotId, enrolledAt, expectedCompletionAt, status]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        programmeId: { type: string, format: uuid }
        pilotId: { type: string, format: uuid }
        enrolledAt: { type: string, format: date-time }
        expectedCompletionAt: { type: string, format: date-time }
        completedAt: { type: string, format: date-time, nullable: true }
        status: { type: string, enum: [ENROLLED,IN_PROGRESS,COMPLETED,WITHDRAWN,FAILED] }
        withdrawalReason: { type: string, nullable: true }
    EnrolmentCreate:
      type: object
      required: [programmeId, pilotId, expectedCompletionAt]
      properties:
        programmeId: { type: string, format: uuid }
        pilotId: { type: string, format: uuid }
        expectedCompletionAt: { type: string, format: date-time }
    Progress:
      type: object
      required: [id, tenantId, enrolmentId, phaseId, status]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        enrolmentId: { type: string, format: uuid }
        phaseId: { type: string, format: uuid }
        status: { type: string, enum: [NOT_STARTED,IN_PROGRESS,GATE_BLOCKED,COMPLETED,FAILED] }
        startedAt: { type: string, format: date-time, nullable: true }
        completedAt: { type: string, format: date-time, nullable: true }
        gateOverrideBy: { type: string, format: uuid, nullable: true }
        gateOverrideReason: { type: string, nullable: true }
        gateOverrideAt: { type: string, format: date-time, nullable: true }
    GateOverrideRequest:
      type: object
      required: [phaseId, reason]
      properties:
        phaseId: { type: string, format: uuid }
        reason: { type: string, minLength: 20 }
    Meta:
      type: object
      required: [requestId, timestamp]
      properties:
        requestId: { type: string, format: uuid }
        timestamp: { type: string, format: date-time }
        pagination:
          type: object
          properties: { page: {type: integer}, pageSize: {type: integer}, total: {type: integer}}
    Error:
      type: object
      properties:
        error:
          type: object
          required: [code, message]
          properties: { code: {type: string}, message: {type: string}, details: {type: object}}
        meta: { $ref: '#/components/schemas/Meta' }
    ProgrammeResponse:    { type: object, properties: { data: {$ref: '#/components/schemas/Programme'}, meta: {$ref: '#/components/schemas/Meta'}}}
    ProgrammeListResponse:{ type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Programme'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    PhaseResponse:        { type: object, properties: { data: {$ref: '#/components/schemas/Phase'}, meta: {$ref: '#/components/schemas/Meta'}}}
    PhaseListResponse:    { type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Phase'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    ModuleResponse:       { type: object, properties: { data: {$ref: '#/components/schemas/Module'}, meta: {$ref: '#/components/schemas/Meta'}}}
    ModuleListResponse:   { type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Module'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    PrereqResponse:       { type: object, properties: { data: {$ref: '#/components/schemas/Prerequisite'}, meta: {$ref: '#/components/schemas/Meta'}}}
    PrereqListResponse:   { type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Prerequisite'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    GateResponse:         { type: object, properties: { data: {$ref: '#/components/schemas/Gate'}, meta: {$ref: '#/components/schemas/Meta'}}}
    GateListResponse:     { type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Gate'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    EnrolmentResponse:    { type: object, properties: { data: {$ref: '#/components/schemas/Enrolment'}, meta: {$ref: '#/components/schemas/Meta'}}}
    EnrolmentListResponse:{ type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Enrolment'}}, meta: {$ref: '#/components/schemas/Meta'}}}
    ProgressResponse:     { type: object, properties: { data: {$ref: '#/components/schemas/Progress'}, meta: {$ref: '#/components/schemas/Meta'}}}
    ProgressListResponse: { type: object, properties: { data: {type: array, items: {$ref: '#/components/schemas/Progress'}}, meta: {$ref: '#/components/schemas/Meta'}}}
  responses:
    BadRequest:             { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    Unauthenticated:        { description: Missing/invalid JWT, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    Forbidden:              { description: Role not allowed, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    NotFound:               { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    Immutable:              { description: Record locked, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    BusinessRuleViolation:  { description: Rule violated, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
    InternalError:          { description: Server error, content: { application/json: { schema: { $ref: '#/components/schemas/Error' }}}}
```

---

## A.4 TypeScript interfaces

```ts
export type ProgrammeType = 'TYPE_RATING'|'RECURRENT'|'OPC'|'LPC'|'EBT'|'MCC'|'JOC'|'UPRT'|'LIFUS'|'TRI_COURSE'|'TRE_COURSE';
export type RegulatoryFramework = 'EASA'|'FAA'|'SACAA'|'DGCA'|'CAAC';
export type ProgrammeStatus = 'DRAFT'|'APPROVED'|'RETIRED';
export type DeliveryMode = 'GROUND'|'FFS'|'FTD'|'FNPT'|'AIRCRAFT'|'LIFUS'|'CBT';
export type CompetencyUnitCode = 'AP'|'COM'|'FPA'|'FPM'|'LT'|'PSD'|'SA'|'WM';
export type GateCriterionType = 'MIN_CU_SCORE'|'ALL_MODULES_COMPLETE'|'MEDICAL_VALID'|'RECENCY_OK'|'LIFUS_SECTORS_MIN'|'EXAMINER_SIGN_OFF';
export type EnrolmentStatus = 'ENROLLED'|'IN_PROGRESS'|'COMPLETED'|'WITHDRAWN'|'FAILED';
export type ProgressStatus = 'NOT_STARTED'|'IN_PROGRESS'|'GATE_BLOCKED'|'COMPLETED'|'FAILED';

export interface TrainingProgramme {
  id: string; tenantId: string; code: string; title: string;
  aircraftType: string; programmeType: ProgrammeType;
  regulatoryFramework: RegulatoryFramework; authorityApprovalRef: string;
  approvalValidFrom: string; approvalValidUntil: string;
  version: number; status: ProgrammeStatus;
  supersedesProgrammeId?: string | null;
  createdBy: string; approvedBy?: string | null; approvedAt?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface ProgrammePhase {
  id: string; tenantId: string; programmeId: string;
  sequence: number; code: string; title: string;
  durationHours: number; minimumSessions: number; deliveryMode: DeliveryMode;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface ProgrammeModule {
  id: string; tenantId: string; phaseId: string;
  sequence: number; code: string; title: string;
  learningObjectives: string[]; competencyUnitCodes: CompetencyUnitCode[];
  mandatory: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface Prerequisite {
  id: string; tenantId: string; moduleId: string; prerequisiteModuleId: string;
  type: 'HARD'|'SOFT'; waiverAllowedByRole: 'CFI'|'TRE'|'NONE';
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface GateCriterion {
  id: string; tenantId: string; phaseId: string;
  criterionType: GateCriterionType; parameters: Record<string, unknown>;
  blocksProgression: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface ProgrammeEnrolment {
  id: string; tenantId: string; programmeId: string; pilotId: string;
  enrolledAt: string; expectedCompletionAt: string; completedAt?: string | null;
  status: EnrolmentStatus; withdrawalReason?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface ProgrammeProgress {
  id: string; tenantId: string; enrolmentId: string; phaseId: string;
  status: ProgressStatus;
  startedAt?: string | null; completedAt?: string | null;
  gateOverrideBy?: string | null; gateOverrideReason?: string | null; gateOverrideAt?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
```

---

## A.5 Zod schemas

```ts
import { z } from 'zod';

export const programmeTypeZ = z.enum(['TYPE_RATING','RECURRENT','OPC','LPC','EBT','MCC','JOC','UPRT','LIFUS','TRI_COURSE','TRE_COURSE']);
export const regulatoryFrameworkZ = z.enum(['EASA','FAA','SACAA','DGCA','CAAC']);
export const deliveryModeZ = z.enum(['GROUND','FFS','FTD','FNPT','AIRCRAFT','LIFUS','CBT']);
export const cuCodeZ = z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM']);
export const gateCriterionTypeZ = z.enum(['MIN_CU_SCORE','ALL_MODULES_COMPLETE','MEDICAL_VALID','RECENCY_OK','LIFUS_SECTORS_MIN','EXAMINER_SIGN_OFF']);

export const programmeCreateZ = z.object({
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  aircraftType: z.string().min(2).max(8),
  programmeType: programmeTypeZ,
  regulatoryFramework: regulatoryFrameworkZ,
  authorityApprovalRef: z.string().min(1).max(128),
  approvalValidFrom: z.string().date(),
  approvalValidUntil: z.string().date(),
  supersedesProgrammeId: z.string().uuid().nullable().optional()
}).refine(d => d.approvalValidUntil > d.approvalValidFrom, { message: 'validUntil must be after validFrom' });
export type ProgrammeCreateInput = z.infer<typeof programmeCreateZ>;

export const programmeUpdateZ = z.object({
  title: z.string().min(1).max(255).optional(),
  approvalValidUntil: z.string().date().optional(),
  authorityApprovalRef: z.string().min(1).max(128).optional()
});
export type ProgrammeUpdateInput = z.infer<typeof programmeUpdateZ>;

export const phaseCreateZ = z.object({
  sequence: z.number().int().min(1),
  code: z.string().min(1).max(32),
  title: z.string().min(1).max(255),
  durationHours: z.number().positive().max(999.99),
  minimumSessions: z.number().int().min(1),
  deliveryMode: deliveryModeZ
});
export type PhaseCreateInput = z.infer<typeof phaseCreateZ>;

export const moduleCreateZ = z.object({
  sequence: z.number().int().min(1),
  code: z.string().min(1).max(32),
  title: z.string().min(1).max(255),
  learningObjectives: z.array(z.string().min(1)).max(50),
  competencyUnitCodes: z.array(cuCodeZ).max(8),
  mandatory: z.boolean()
});
export type ModuleCreateInput = z.infer<typeof moduleCreateZ>;

export const prereqCreateZ = z.object({
  prerequisiteModuleId: z.string().uuid(),
  type: z.enum(['HARD','SOFT']),
  waiverAllowedByRole: z.enum(['CFI','TRE','NONE'])
});
export type PrereqCreateInput = z.infer<typeof prereqCreateZ>;

export const gateCreateZ = z.object({
  criterionType: gateCriterionTypeZ,
  parameters: z.record(z.unknown()),
  blocksProgression: z.boolean()
});
export type GateCreateInput = z.infer<typeof gateCreateZ>;

export const enrolmentCreateZ = z.object({
  programmeId: z.string().uuid(),
  pilotId: z.string().uuid(),
  expectedCompletionAt: z.string().datetime()
});
export type EnrolmentCreateInput = z.infer<typeof enrolmentCreateZ>;

export const gateOverrideZ = z.object({
  phaseId: z.string().uuid(),
  reason: z.string().min(20).max(2000)
});
export type GateOverrideInput = z.infer<typeof gateOverrideZ>;
```

---

## A.6 EventBridge events

| Event name | Trigger | Payload (in addition to envelope) |
|---|---|---|
| `programme.created` | POST programme | `{ programmeId, code, version, programmeType, aircraftType, status }` |
| `programme.approved` | POST /approve | `{ programmeId, version, approvedBy, authorityApprovalRef }` |
| `programme.retired` | POST /retire | `{ programmeId, version, retiredBy, supersededBy? }` |
| `programme.enrolment.created` | POST enrolment | `{ enrolmentId, programmeId, pilotId, expectedCompletionAt }` |
| `programme.phase.completed` | progress reaches COMPLETED | `{ enrolmentId, phaseId, completedAt, pilotId }` |
| `programme.gate.blocked` | progression attempt fails gate | `{ enrolmentId, phaseId, criterionType, blockingDetails }` |
| `programme.gate.overridden` | POST gate-override | `{ enrolmentId, phaseId, overrideBy, reason }` |
| `programme.enrolment.completed` | last phase completes & all gates pass | `{ enrolmentId, programmeId, pilotId, completedAt }` |
| `programme.enrolment.failed` | gate failure not waived OR withdraw | `{ enrolmentId, reason }` |

---

## A.7 Business rules

- **R-A-1** A programme cannot be APPROVED unless `phases.count >= 1` and every phase has `modules.count >= 1`. (Doc 9868 §II.2.3)
- **R-A-2** Editing phases/modules is forbidden once `status = APPROVED`; a new version must be created via "supersede". (ORA.ATO.230)
- **R-A-3** `approvalValidUntil - approvalValidFrom <= 3 years` for type-rating programmes (FCL.740 cycle).
- **R-A-4** Prerequisite graph MUST be a DAG; cycle attempts return `409 CONFLICT`.
- **R-A-5** Only `CFI` may call `/approve` and `/retire`. `INSTRUCTOR` and `ADMIN` are forbidden (403). `PILOT` is forbidden.
- **R-A-6** `programme.enrolment.created` requires the pilot's medical to be currently valid (cross-check `hris-service`) — otherwise 422.
- **R-A-7** Gate override only by `CFI`; reason length >= 20 chars; auto-emits `programme.gate.overridden` and writes audit row.

---

# SERVICE B — `instructor-records`

**Regulatory anchor:** Part-FCL Subpart J (FCL.905–FCL.1015), ORA.ATO.110 (personnel), Part-ORO Appendix 9, FAA 14 CFR §61.195.

**Purpose:** Single source of truth for instructor/examiner authorisations — what each TRI/TRE/SFI/CRI/SFE is rated to teach/examine, on which aircraft type, with what validity window, including refresher/proficiency check status.

---

## B.1 Entity model

| Entity | Key fields |
|---|---|
| `InstructorRecord` | id, tenantId, userId (FK user-service), employeeNumber, primaryRole (CFI\|TRI\|TRE\|SFI\|SFE\|CRI\|FI\|IRI), hireDate, status (ACTIVE\|INACTIVE\|SUSPENDED) |
| `InstructorQualification` | id, tenantId, instructorRecordId, qualificationType (TRI\|TRE\|SFI\|SFE\|CRI\|FI\|IRI\|EXAMINER_SE\|EXAMINER_ME), aircraftType, regulatoryFramework, authorityReferenceNumber, issuedAt, validFrom, validUntil, issuingAuthority, restrictions[], status (VALID\|EXPIRING\|EXPIRED\|REVOKED) |
| `ExaminerAuthorisation` | id, tenantId, instructorRecordId, authorisationType (OPC\|LPC\|SKILL_TEST\|PROFICIENCY_CHECK\|TYPE_RATING_TEST), aircraftType, validFrom, validUntil, authorityReferenceNumber, conductedTestsCount, restrictions[] |
| `InstructorTrainingRecord` | id, tenantId, instructorRecordId, eventType (INITIAL_COURSE\|REFRESHER\|STANDARDISATION\|ASSESSMENT_OF_COMPETENCE\|PROFICIENCY_CHECK), eventDate, validUntil, conductedByExaminerId, simulatorId, simulatorQualificationLevel, outcome (PASS\|FAIL), documentRef |
| `InstructorAssignmentRestriction` | id, tenantId, instructorRecordId, restrictionType (NO_SOLO_LIFUS\|UNDER_SUPERVISION\|SPECIFIC_PROGRAMME), parameters JSONB, validUntil, imposedBy, reason |

---

## B.2 DB schema

```sql
CREATE TABLE instructor_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  user_id UUID NOT NULL,
  employee_number VARCHAR(64) NOT NULL,
  primary_role VARCHAR(8) NOT NULL CHECK (primary_role IN ('CFI','TRI','TRE','SFI','SFE','CRI','FI','IRI')),
  hire_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_instr_user UNIQUE (tenant_id, user_id),
  CONSTRAINT uq_instr_emp UNIQUE (tenant_id, employee_number)
);
CREATE INDEX idx_instr_tenant_id ON instructor_record (tenant_id, id);

CREATE TABLE instructor_qualification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  instructor_record_id UUID NOT NULL REFERENCES instructor_record(id),
  qualification_type VARCHAR(16) NOT NULL CHECK (qualification_type IN
    ('TRI','TRE','SFI','SFE','CRI','FI','IRI','EXAMINER_SE','EXAMINER_ME')),
  aircraft_type VARCHAR(32) NOT NULL,
  regulatory_framework VARCHAR(16) NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','DGCA','CAAC')),
  authority_reference_number VARCHAR(128) NOT NULL,
  issued_at DATE NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  issuing_authority VARCHAR(128) NOT NULL,
  restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','EXPIRING','EXPIRED','REVOKED')),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_qual_ref UNIQUE (tenant_id, authority_reference_number)
);
CREATE INDEX idx_iq_tenant_id ON instructor_qualification (tenant_id, id);
CREATE INDEX idx_iq_instructor ON instructor_qualification (tenant_id, instructor_record_id, aircraft_type, status);
CREATE INDEX idx_iq_expiry ON instructor_qualification (tenant_id, valid_until) WHERE status = 'VALID';

CREATE TABLE examiner_authorisation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  instructor_record_id UUID NOT NULL REFERENCES instructor_record(id),
  authorisation_type VARCHAR(24) NOT NULL CHECK (authorisation_type IN
    ('OPC','LPC','SKILL_TEST','PROFICIENCY_CHECK','TYPE_RATING_TEST')),
  aircraft_type VARCHAR(32) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  authority_reference_number VARCHAR(128) NOT NULL,
  conducted_tests_count INTEGER NOT NULL DEFAULT 0,
  restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_ea_tenant_id ON examiner_authorisation (tenant_id, id);
CREATE INDEX idx_ea_instructor ON examiner_authorisation (tenant_id, instructor_record_id, aircraft_type);

CREATE TABLE instructor_training_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  instructor_record_id UUID NOT NULL REFERENCES instructor_record(id),
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN
    ('INITIAL_COURSE','REFRESHER','STANDARDISATION','ASSESSMENT_OF_COMPETENCE','PROFICIENCY_CHECK')),
  event_date DATE NOT NULL,
  valid_until DATE NOT NULL,
  conducted_by_examiner_id UUID NOT NULL,
  simulator_id UUID NOT NULL,
  simulator_qualification_level VARCHAR(8) NOT NULL,        -- e.g. FFS_D
  outcome VARCHAR(8) NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  document_ref VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_itr_tenant_id ON instructor_training_record (tenant_id, id);
CREATE INDEX idx_itr_instructor ON instructor_training_record (tenant_id, instructor_record_id, event_type, event_date DESC);

CREATE TABLE instructor_assignment_restriction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  instructor_record_id UUID NOT NULL REFERENCES instructor_record(id),
  restriction_type VARCHAR(32) NOT NULL CHECK (restriction_type IN
    ('NO_SOLO_LIFUS','UNDER_SUPERVISION','SPECIFIC_PROGRAMME')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_until DATE,
  imposed_by UUID NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_iar_tenant_id ON instructor_assignment_restriction (tenant_id, id);
```

---

## B.3 OpenAPI 3.0 (endpoints summary — full envelope/error responses as in §A.3)

```yaml
paths:
  /instructors:                                   { get: list, post: create }      # CFI/ADMIN
  /instructors/{id}:                              { get, patch }
  /instructors/{id}/qualifications:               { get, post }
  /instructors/{id}/qualifications/{qid}:         { get, patch }
  /instructors/{id}/qualifications/{qid}/revoke:  { post }                          # CFI only
  /instructors/{id}/examiner-authorisations:      { get, post }
  /instructors/{id}/training-records:             { get, post }
  /instructors/{id}/restrictions:                 { get, post }
  /instructors/{id}/restrictions/{rid}:           { patch, delete }
  /instructors/eligibility-check:                 { post }                          # used by booking-service
```

All endpoints carry the standard 400/401/403/404/422/500 response set. `eligibility-check` body:

```yaml
EligibilityCheckRequest:
  type: object
  required: [instructorId, sessionType, aircraftType, sessionStartAt]
  properties:
    instructorId:  { type: string, format: uuid }
    sessionType:   { type: string, enum: [OPC,LPC,RECURRENT,LIFUS,TYPE_RATING,UPRT,EBT] }
    aircraftType:  { type: string }
    sessionStartAt:{ type: string, format: date-time }
EligibilityCheckResponse:
  type: object
  properties:
    eligible: { type: boolean }
    matchedQualificationId: { type: string, format: uuid, nullable: true }
    matchedAuthorisationId: { type: string, format: uuid, nullable: true }
    reasons: { type: array, items: { type: string } }
```

---

## B.4 TypeScript interfaces

```ts
export type PrimaryRole = 'CFI'|'TRI'|'TRE'|'SFI'|'SFE'|'CRI'|'FI'|'IRI';
export type InstructorStatus = 'ACTIVE'|'INACTIVE'|'SUSPENDED';
export type QualificationType = 'TRI'|'TRE'|'SFI'|'SFE'|'CRI'|'FI'|'IRI'|'EXAMINER_SE'|'EXAMINER_ME';
export type QualificationStatus = 'VALID'|'EXPIRING'|'EXPIRED'|'REVOKED';
export type ExaminerAuthType = 'OPC'|'LPC'|'SKILL_TEST'|'PROFICIENCY_CHECK'|'TYPE_RATING_TEST';
export type InstructorEventType = 'INITIAL_COURSE'|'REFRESHER'|'STANDARDISATION'|'ASSESSMENT_OF_COMPETENCE'|'PROFICIENCY_CHECK';

export interface InstructorRecord {
  id: string; tenantId: string; userId: string; employeeNumber: string;
  primaryRole: PrimaryRole; hireDate: string; status: InstructorStatus;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface InstructorQualification {
  id: string; tenantId: string; instructorRecordId: string;
  qualificationType: QualificationType; aircraftType: string;
  regulatoryFramework: 'EASA'|'FAA'|'SACAA'|'DGCA'|'CAAC';
  authorityReferenceNumber: string;
  issuedAt: string; validFrom: string; validUntil: string;
  issuingAuthority: string; restrictions: string[]; status: QualificationStatus;
  revokedAt?: string | null; revokedBy?: string | null; revocationReason?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface ExaminerAuthorisation {
  id: string; tenantId: string; instructorRecordId: string;
  authorisationType: ExaminerAuthType; aircraftType: string;
  validFrom: string; validUntil: string;
  authorityReferenceNumber: string; conductedTestsCount: number; restrictions: string[];
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface InstructorTrainingRecord {
  id: string; tenantId: string; instructorRecordId: string;
  eventType: InstructorEventType; eventDate: string; validUntil: string;
  conductedByExaminerId: string; simulatorId: string; simulatorQualificationLevel: string;
  outcome: 'PASS'|'FAIL'; documentRef?: string | null;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface InstructorAssignmentRestriction {
  id: string; tenantId: string; instructorRecordId: string;
  restrictionType: 'NO_SOLO_LIFUS'|'UNDER_SUPERVISION'|'SPECIFIC_PROGRAMME';
  parameters: Record<string, unknown>;
  validUntil?: string | null; imposedBy: string; reason: string;
  createdAt: string; updatedAt: string; deletedAt?: string | null;
}
export interface EligibilityCheckResult {
  eligible: boolean;
  matchedQualificationId?: string | null;
  matchedAuthorisationId?: string | null;
  reasons: string[];
}
```

---

## B.5 Zod schemas

```ts
import { z } from 'zod';

export const primaryRoleZ = z.enum(['CFI','TRI','TRE','SFI','SFE','CRI','FI','IRI']);
export const qualificationTypeZ = z.enum(['TRI','TRE','SFI','SFE','CRI','FI','IRI','EXAMINER_SE','EXAMINER_ME']);
export const examinerAuthTypeZ = z.enum(['OPC','LPC','SKILL_TEST','PROFICIENCY_CHECK','TYPE_RATING_TEST']);
export const instructorEventTypeZ = z.enum(['INITIAL_COURSE','REFRESHER','STANDARDISATION','ASSESSMENT_OF_COMPETENCE','PROFICIENCY_CHECK']);

export const instructorCreateZ = z.object({
  userId: z.string().uuid(),
  employeeNumber: z.string().min(1).max(64),
  primaryRole: primaryRoleZ,
  hireDate: z.string().date()
});
export type InstructorCreateInput = z.infer<typeof instructorCreateZ>;

export const qualificationCreateZ = z.object({
  qualificationType: qualificationTypeZ,
  aircraftType: z.string().min(2).max(32),
  regulatoryFramework: z.enum(['EASA','FAA','SACAA','DGCA','CAAC']),
  authorityReferenceNumber: z.string().min(1).max(128),
  issuedAt: z.string().date(),
  validFrom: z.string().date(),
  validUntil: z.string().date(),
  issuingAuthority: z.string().min(1).max(128),
  restrictions: z.array(z.string()).default([])
}).refine(d => d.validUntil > d.validFrom, { message: 'validUntil after validFrom' });
export type QualificationCreateInput = z.infer<typeof qualificationCreateZ>;

export const examinerAuthCreateZ = z.object({
  authorisationType: examinerAuthTypeZ,
  aircraftType: z.string().min(2).max(32),
  validFrom: z.string().date(),
  validUntil: z.string().date(),
  authorityReferenceNumber: z.string().min(1).max(128),
  restrictions: z.array(z.string()).default([])
});
export type ExaminerAuthCreateInput = z.infer<typeof examinerAuthCreateZ>;

export const instructorTrainingRecordCreateZ = z.object({
  eventType: instructorEventTypeZ,
  eventDate: z.string().date(),
  validUntil: z.string().date(),
  conductedByExaminerId: z.string().uuid(),
  simulatorId: z.string().uuid(),
  simulatorQualificationLevel: z.string().min(1).max(8),
  outcome: z.enum(['PASS','FAIL']),
  documentRef: z.string().max(255).optional()
});
export type InstructorTrainingRecordCreateInput = z.infer<typeof instructorTrainingRecordCreateZ>;

export const restrictionCreateZ = z.object({
  restrictionType: z.enum(['NO_SOLO_LIFUS','UNDER_SUPERVISION','SPECIFIC_PROGRAMME']),
  parameters: z.record(z.unknown()),
  validUntil: z.string().date().nullable().optional(),
  reason: z.string().min(10).max(2000)
});
export type RestrictionCreateInput = z.infer<typeof restrictionCreateZ>;

export const eligibilityCheckZ = z.object({
  instructorId: z.string().uuid(),
  sessionType: z.enum(['OPC','LPC','RECURRENT','LIFUS','TYPE_RATING','UPRT','EBT']),
  aircraftType: z.string().min(2).max(32),
  sessionStartAt: z.string().datetime()
});
export type EligibilityCheckInput = z.infer<typeof eligibilityCheckZ>;
```

---

## B.6 EventBridge events

| Event | Payload |
|---|---|
| `instructor.created` | `{ instructorId, userId, primaryRole }` |
| `instructor.qualification.added` | `{ instructorId, qualificationId, qualificationType, aircraftType, validUntil }` |
| `instructor.qualification.expiring` | `{ instructorId, qualificationId, validUntil, daysUntilExpiry }` (emitted by scheduler at 90/60/30/14/7) |
| `instructor.qualification.expired` | `{ instructorId, qualificationId, expiredAt }` |
| `instructor.qualification.revoked` | `{ instructorId, qualificationId, revokedBy, reason }` |
| `instructor.examiner_auth.added` | `{ instructorId, authorisationId, authorisationType, aircraftType, validUntil }` |
| `instructor.training.recorded` | `{ instructorId, eventType, outcome, validUntil }` |
| `instructor.restriction.imposed` | `{ instructorId, restrictionId, restrictionType, validUntil }` |
| `instructor.restriction.lifted` | `{ instructorId, restrictionId, liftedBy }` |
| `instructor.eligibility.failed` | `{ instructorId, sessionType, aircraftType, reasons[] }` (audit only) |

---

## B.7 Business rules

- **R-B-1** TRI revalidation per FCL.940.TRI: every 3 years, requires `STANDARDISATION` OR `REFRESHER` plus `ASSESSMENT_OF_COMPETENCE` within last 12 months of validity. System computes `valid_until` from latest qualifying records.
- **R-B-2** TRE authority (Part-FCL.1015): max 3-year validity; revalidation requires authority assessment — `examiner_authorisation.valid_until` cannot be extended client-side; must come via authority record.
- **R-B-3** `instructor.qualification.status` auto-flips to `EXPIRING` at T-60 days, `EXPIRED` at T+0.
- **R-B-4** Booking-service MUST call `/eligibility-check` before reservation confirmation. If `eligible = false`, booking returns 422.
- **R-B-5** Revoke action requires CFI and a `reason` >= 20 chars; emits `instructor.qualification.revoked` and creates a `SUSPENDED` flag if all qualifications for type are revoked.
- **R-B-6** Restriction `NO_SOLO_LIFUS` blocks line-ops-interface from assigning the instructor as sole-instructor on a LIFUS sector.

---

# SERVICE C — `deficit-tracking`

**Regulatory anchor:** ICAO Doc 9995 §3 (EBT remediation), Part-ORO.FC.230 GM (remedial), Part-FCL Subpart H (proficiency).

**Purpose:** Open, schedule, escalate, and close remedial actions triggered by any CBTA score `<= 2` on any of the 8 competency units. Enforces the 30-day re-assessment window and 21-day CFI escalation.

---

## C.1 Entity model

| Entity | Key fields |
|---|---|
| `Deficit` | id, tenantId, pilotId, originatingAssessmentId, competencyUnitCode, originatingScore (1\|2), originatingSessionId, openedAt, severity (REMEDIAL\|TRAINING_REQUIRED), status (OPEN\|REASSESSMENT_SCHEDULED\|UNDER_REMEDIATION\|RESOLVED\|ESCALATED\|WAIVED), dueAt, escalatedAt, resolvedAt, resolutionAssessmentId, instructorId, cfiId |
| `RemedialAction` | id, tenantId, deficitId, actionType (BRIEFING\|GROUND_TRAINING\|FFS_SESSION\|FTD_SESSION\|LINE_OPS_FOCUS), description, plannedDate, completedDate, instructorId, durationMinutes, notes |
| `Reassessment` | id, tenantId, deficitId, scheduledFor, scheduledSlotId (refs booking), conductedAt, conductedByInstructorId, resultingAssessmentId, outcome (PASS\|FAIL\|NO_SHOW\|CANCELLED) |
| `DeficitEscalation` | id, tenantId, deficitId, escalationLevel (LEVEL_1_CFI\|LEVEL_2_HEAD_OF_TRAINING\|LEVEL_3_AUTHORITY), triggeredAt, triggeredBy (SYSTEM\|USER), acknowledgedAt, acknowledgedBy, notes |

---

## C.2 DB schema

```sql
CREATE TABLE deficit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  originating_assessment_id UUID NOT NULL,                 -- refs cbta-service
  competency_unit_code VARCHAR(8) NOT NULL CHECK (competency_unit_code IN
    ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  originating_score SMALLINT NOT NULL CHECK (originating_score IN (1,2)),
  originating_session_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('REMEDIAL','TRAINING_REQUIRED')),
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN
    ('OPEN','REASSESSMENT_SCHEDULED','UNDER_REMEDIATION','RESOLVED','ESCALATED','WAIVED')),
  due_at TIMESTAMPTZ NOT NULL,                             -- opened_at + 30d
  escalated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_assessment_id UUID,
  instructor_id UUID NOT NULL,                             -- instructor who recorded the trigger
  cfi_id UUID,                                             -- assigned CFI on escalation
  waived_by UUID,
  waived_reason TEXT,
  waived_at TIMESTAMPTZ,
  simulator_id UUID NOT NULL,
  simulator_qualification_level VARCHAR(8) NOT NULL,
  instructor_qualification VARCHAR(16) NOT NULL,
  session_type VARCHAR(16) NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_deficit_tenant_id ON deficit (tenant_id, id);
CREATE INDEX idx_deficit_pilot_status ON deficit (tenant_id, pilot_id, status);
CREATE INDEX idx_deficit_due ON deficit (tenant_id, due_at) WHERE status NOT IN ('RESOLVED','WAIVED');

CREATE TABLE remedial_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  deficit_id UUID NOT NULL REFERENCES deficit(id),
  action_type VARCHAR(24) NOT NULL CHECK (action_type IN
    ('BRIEFING','GROUND_TRAINING','FFS_SESSION','FTD_SESSION','LINE_OPS_FOCUS')),
  description TEXT NOT NULL,
  planned_date DATE NOT NULL,
  completed_date DATE,
  instructor_id UUID NOT NULL,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_ra_tenant_id ON remedial_action (tenant_id, id);
CREATE INDEX idx_ra_deficit ON remedial_action (tenant_id, deficit_id);

CREATE TABLE reassessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  deficit_id UUID NOT NULL REFERENCES deficit(id),
  scheduled_for TIMESTAMPTZ NOT NULL,
  scheduled_slot_id UUID,
  conducted_at TIMESTAMPTZ,
  conducted_by_instructor_id UUID,
  resulting_assessment_id UUID,
  outcome VARCHAR(16) CHECK (outcome IN ('PASS','FAIL','NO_SHOW','CANCELLED')),
  simulator_id UUID,
  simulator_qualification_level VARCHAR(8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_reass_tenant_id ON reassessment (tenant_id, id);
CREATE INDEX idx_reass_deficit ON reassessment (tenant_id, deficit_id);

CREATE TABLE deficit_escalation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  deficit_id UUID NOT NULL REFERENCES deficit(id),
  escalation_level VARCHAR(32) NOT NULL CHECK (escalation_level IN
    ('LEVEL_1_CFI','LEVEL_2_HEAD_OF_TRAINING','LEVEL_3_AUTHORITY')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_by VARCHAR(8) NOT NULL CHECK (triggered_by IN ('SYSTEM','USER')),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_esc_tenant_id ON deficit_escalation (tenant_id, id);
CREATE INDEX idx_esc_deficit ON deficit_escalation (tenant_id, deficit_id);
```

---

## C.3 OpenAPI 3.0 (endpoints summary)

```yaml
paths:
  /deficits:
    get:  { roles: [CFI,INSTRUCTOR,OPS], filters: [pilotId, status, competencyUnitCode, openedAfter, dueBefore, page, pageSize] }
    post: { roles: [SYSTEM,CFI,INSTRUCTOR], body: DeficitCreate } # normally driven by cbta event
  /deficits/{id}:
    get:    { roles: [CFI,INSTRUCTOR,PILOT (own only),OPS] }
    patch:  { roles: [CFI,INSTRUCTOR], body: DeficitUpdate }
  /deficits/{id}/remedial-actions:
    get:  {}
    post: { body: RemedialActionCreate, roles: [CFI,INSTRUCTOR] }
  /deficits/{id}/remedial-actions/{aid}/complete:
    post: { body: { completedDate, notes, durationMinutes }, roles: [CFI,INSTRUCTOR] }
  /deficits/{id}/reassessments:
    get:  {}
    post: { body: ReassessmentSchedule, roles: [CFI,INSTRUCTOR] }    # must be within 30 days of openedAt
  /deficits/{id}/reassessments/{rid}/record-outcome:
    post: { body: ReassessmentOutcome, roles: [CFI,TRE,INSTRUCTOR] } # PASS resolves deficit
  /deficits/{id}/escalate:
    post: { body: { reason }, roles: [CFI,SYSTEM] }
  /deficits/{id}/waive:
    post: { body: { reason (min 50), authorityRef }, roles: [CFI] }
  /deficits/{id}/escalations:
    get:  {}
  /deficits/{id}/acknowledge-escalation:
    post: { roles: [CFI] }
```

Every endpoint emits standard 400/401/403/404/422/500 (and 410 for closed deficits being edited).

---

## C.4 TypeScript interfaces

```ts
export type CUCode = 'AP'|'COM'|'FPA'|'FPM'|'LT'|'PSD'|'SA'|'WM';
export type DeficitSeverity = 'REMEDIAL'|'TRAINING_REQUIRED';
export type DeficitStatus = 'OPEN'|'REASSESSMENT_SCHEDULED'|'UNDER_REMEDIATION'|'RESOLVED'|'ESCALATED'|'WAIVED';
export type RemedialActionType = 'BRIEFING'|'GROUND_TRAINING'|'FFS_SESSION'|'FTD_SESSION'|'LINE_OPS_FOCUS';
export type ReassessmentOutcomeT = 'PASS'|'FAIL'|'NO_SHOW'|'CANCELLED';
export type EscalationLevel = 'LEVEL_1_CFI'|'LEVEL_2_HEAD_OF_TRAINING'|'LEVEL_3_AUTHORITY';

export interface Deficit {
  id: string; tenantId: string; pilotId: string;
  originatingAssessmentId: string; competencyUnitCode: CUCode; originatingScore: 1|2;
  originatingSessionId: string; openedAt: string;
  severity: DeficitSeverity; status: DeficitStatus;
  dueAt: string; escalatedAt?: string|null; resolvedAt?: string|null;
  resolutionAssessmentId?: string|null;
  instructorId: string; cfiId?: string|null;
  waivedBy?: string|null; waivedReason?: string|null; waivedAt?: string|null;
  simulatorId: string; simulatorQualificationLevel: string;
  instructorQualification: string; sessionType: string; assessedAt: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface RemedialAction {
  id: string; tenantId: string; deficitId: string;
  actionType: RemedialActionType; description: string;
  plannedDate: string; completedDate?: string|null;
  instructorId: string; durationMinutes?: number|null; notes?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface Reassessment {
  id: string; tenantId: string; deficitId: string;
  scheduledFor: string; scheduledSlotId?: string|null;
  conductedAt?: string|null; conductedByInstructorId?: string|null;
  resultingAssessmentId?: string|null; outcome?: ReassessmentOutcomeT|null;
  simulatorId?: string|null; simulatorQualificationLevel?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface DeficitEscalation {
  id: string; tenantId: string; deficitId: string;
  escalationLevel: EscalationLevel; triggeredAt: string;
  triggeredBy: 'SYSTEM'|'USER';
  acknowledgedAt?: string|null; acknowledgedBy?: string|null; notes?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
```

---

## C.5 Zod schemas

```ts
import { z } from 'zod';
export const cuCodeZ = z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM']);

export const deficitCreateZ = z.object({
  pilotId: z.string().uuid(),
  originatingAssessmentId: z.string().uuid(),
  competencyUnitCode: cuCodeZ,
  originatingScore: z.literal(1).or(z.literal(2)),
  originatingSessionId: z.string().uuid(),
  severity: z.enum(['REMEDIAL','TRAINING_REQUIRED']),
  instructorId: z.string().uuid(),
  simulatorId: z.string().uuid(),
  simulatorQualificationLevel: z.string().min(1).max(8),
  instructorQualification: z.string().min(1).max(16),
  sessionType: z.string().min(1).max(16),
  assessedAt: z.string().datetime()
});
export type DeficitCreateInput = z.infer<typeof deficitCreateZ>;

export const remedialActionCreateZ = z.object({
  actionType: z.enum(['BRIEFING','GROUND_TRAINING','FFS_SESSION','FTD_SESSION','LINE_OPS_FOCUS']),
  description: z.string().min(10).max(2000),
  plannedDate: z.string().date(),
  instructorId: z.string().uuid()
});
export type RemedialActionCreateInput = z.infer<typeof remedialActionCreateZ>;

export const remedialActionCompleteZ = z.object({
  completedDate: z.string().date(),
  durationMinutes: z.number().int().positive().max(720),
  notes: z.string().max(2000).optional()
});
export type RemedialActionCompleteInput = z.infer<typeof remedialActionCompleteZ>;

export const reassessmentScheduleZ = z.object({
  scheduledFor: z.string().datetime(),
  scheduledSlotId: z.string().uuid().optional()
});
export type ReassessmentScheduleInput = z.infer<typeof reassessmentScheduleZ>;

export const reassessmentOutcomeZ = z.object({
  conductedAt: z.string().datetime(),
  conductedByInstructorId: z.string().uuid(),
  resultingAssessmentId: z.string().uuid(),
  outcome: z.enum(['PASS','FAIL','NO_SHOW','CANCELLED']),
  simulatorId: z.string().uuid().optional(),
  simulatorQualificationLevel: z.string().max(8).optional()
});
export type ReassessmentOutcomeInput = z.infer<typeof reassessmentOutcomeZ>;

export const deficitWaiveZ = z.object({
  reason: z.string().min(50).max(4000),
  authorityRef: z.string().min(1).max(128)
});
export type DeficitWaiveInput = z.infer<typeof deficitWaiveZ>;

export const escalateZ = z.object({ reason: z.string().min(10).max(2000) });
export type EscalateInput = z.infer<typeof escalateZ>;
```

---

## C.6 EventBridge events

| Event | Payload |
|---|---|
| `deficit.opened` | `{ deficitId, pilotId, competencyUnitCode, originatingScore, dueAt, severity }` |
| `deficit.remedial.planned` | `{ deficitId, actionId, actionType, plannedDate }` |
| `deficit.remedial.completed` | `{ deficitId, actionId, completedDate }` |
| `deficit.reassessment.scheduled` | `{ deficitId, reassessmentId, scheduledFor }` |
| `deficit.reassessment.recorded` | `{ deficitId, reassessmentId, outcome }` |
| `deficit.resolved` | `{ deficitId, resolvedAt, resolutionAssessmentId }` |
| `deficit.escalated` | `{ deficitId, escalationLevel, triggeredBy, escalatedAt }` (auto at T+21 if not resolved) |
| `deficit.overdue` | `{ deficitId, dueAt, daysOverdue }` (auto at T+30) |
| `deficit.waived` | `{ deficitId, waivedBy, authorityRef }` |

---

## C.7 Business rules

- **R-C-1** `cbta.assessment.recorded` event with any CU score `<= 2` MUST auto-create a `deficit` row. `severity = TRAINING_REQUIRED` if score = 1, else `REMEDIAL`. (ICAO 9995 §3.4)
- **R-C-2** `due_at = opened_at + 30 days`. Reassessment scheduled `> due_at` returns 422.
- **R-C-3** At T+21 days from `opened_at` without `status IN (RESOLVED,WAIVED)`, scheduler creates `LEVEL_1_CFI` escalation, sets `status = ESCALATED`, emits `deficit.escalated`.
- **R-C-4** At T+30 days unresolved, scheduler emits `deficit.overdue` daily and creates `LEVEL_2_HEAD_OF_TRAINING` after T+45.
- **R-C-5** Recording a reassessment with `outcome = PASS` automatically transitions `status -> RESOLVED`, sets `resolved_at`, `resolution_assessment_id`. Reassessment `FAIL` keeps status, opens new remedial cycle, emits `deficit.reassessment.recorded`.
- **R-C-6** Only CFI may waive; waiving requires `reason >= 50 chars` and `authorityRef` (e.g., authority CAA acknowledgement). Waive is final but visible in regulatory reports.
- **R-C-7** A pilot cannot pass a gate criterion `MIN_CU_SCORE` while any deficit on that CU is open. (cross-service check used by training-programmes gate evaluator)
- **R-C-8** Pilot can view own deficits read-only; cannot waive or modify.

---

# SERVICE D — `scenario-library`

**Regulatory anchor:** Part-ORA.ATO.230 (training manual), Part-ORO Appendix 9, CS-FSTD(A) scenario credit, AMC1 ORO.FC.231 EBT scenarios.

**Purpose:** ATO-approved scenario definitions per aircraft type — the "what we trained" half of the inspector audit. Includes scenario fingerprint (initial conditions, malfunctions, weather, route), competency-unit coverage map, approval lineage, and instructor brief/debrief templates.

---

## D.1 Entity model

| Entity | Key fields |
|---|---|
| `Scenario` | id, tenantId, code, title, aircraftType, scenarioCategory (NORMAL\|ABNORMAL\|EMERGENCY\|LOFT\|EBT\|UPRT\|CRM_FOCUS), phaseOfFlight (PREFLIGHT\|TAXI\|TAKEOFF\|CLIMB\|CRUISE\|DESCENT\|APPROACH\|LANDING\|GO_AROUND\|ALL), minimumFstdLevel (FNPT_II\|FTD_2\|FFS_C\|FFS_D), approvalStatus (DRAFT\|APPROVED\|RETIRED), authorityApprovalRef, version, supersedesScenarioId |
| `ScenarioInitialCondition` | id, tenantId, scenarioId, airport (ICAO), runway, weight, fuel, cg, weatherJson, ataChapterRefs[] |
| `ScenarioInjection` | id, tenantId, scenarioId, sequence, triggerType (TIME\|EVENT\|PHASE\|ATC), triggerSpec JSONB, malfunctionCode (ATA-style), description, expectedCrewResponse, severity |
| `ScenarioCompetencyMapping` | id, tenantId, scenarioId, competencyUnitCode, weight (1–5), observableBehaviours[] |
| `ScenarioApproval` | id, tenantId, scenarioId, approvedBy, approvedAt, authorityReference, validFrom, validUntil, revokedAt, revokedBy, revokeReason |
| `ScenarioBriefTemplate` | id, tenantId, scenarioId, briefMarkdown, debriefMarkdown, instructorNotes, pilotPrereadRefs[] |

---

## D.2 DB schema

```sql
CREATE TABLE scenario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  aircraft_type VARCHAR(32) NOT NULL,
  scenario_category VARCHAR(16) NOT NULL CHECK (scenario_category IN
    ('NORMAL','ABNORMAL','EMERGENCY','LOFT','EBT','UPRT','CRM_FOCUS')),
  phase_of_flight VARCHAR(16) NOT NULL CHECK (phase_of_flight IN
    ('PREFLIGHT','TAXI','TAKEOFF','CLIMB','CRUISE','DESCENT','APPROACH','LANDING','GO_AROUND','ALL')),
  minimum_fstd_level VARCHAR(8) NOT NULL CHECK (minimum_fstd_level IN ('FNPT_II','FTD_2','FFS_C','FFS_D')),
  approval_status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT','APPROVED','RETIRED')),
  authority_approval_ref VARCHAR(128),
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_scenario_id UUID REFERENCES scenario(id),
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_scenario_code_version UNIQUE (tenant_id, code, version)
);
CREATE INDEX idx_scen_tenant_id ON scenario (tenant_id, id);
CREATE INDEX idx_scen_aircraft ON scenario (tenant_id, aircraft_type, approval_status);

CREATE TABLE scenario_initial_condition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  scenario_id UUID NOT NULL REFERENCES scenario(id),
  airport_icao CHAR(4) NOT NULL,
  runway VARCHAR(8) NOT NULL,
  weight_kg INTEGER NOT NULL,
  fuel_kg INTEGER NOT NULL,
  cg_percent NUMERIC(4,2) NOT NULL,
  weather JSONB NOT NULL,            -- {wind:{dir,kt}, vis_m, ceiling_ft, ...}
  ata_chapter_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sic_tenant_id ON scenario_initial_condition (tenant_id, id);

CREATE TABLE scenario_injection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  scenario_id UUID NOT NULL REFERENCES scenario(id),
  sequence INTEGER NOT NULL,
  trigger_type VARCHAR(8) NOT NULL CHECK (trigger_type IN ('TIME','EVENT','PHASE','ATC')),
  trigger_spec JSONB NOT NULL,
  malfunction_code VARCHAR(32) NOT NULL,           -- e.g. ATA-32-HYD_LO_PRESS
  description TEXT NOT NULL,
  expected_crew_response TEXT NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('NORMAL','ABNORMAL','EMERGENCY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_inj_seq UNIQUE (tenant_id, scenario_id, sequence)
);
CREATE INDEX idx_inj_tenant_id ON scenario_injection (tenant_id, id);

CREATE TABLE scenario_competency_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  scenario_id UUID NOT NULL REFERENCES scenario(id),
  competency_unit_code VARCHAR(8) NOT NULL CHECK (competency_unit_code IN
    ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  weight SMALLINT NOT NULL CHECK (weight BETWEEN 1 AND 5),
  observable_behaviours JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_scen_cu UNIQUE (tenant_id, scenario_id, competency_unit_code)
);
CREATE INDEX idx_scm_tenant_id ON scenario_competency_mapping (tenant_id, id);

CREATE TABLE scenario_approval (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  scenario_id UUID NOT NULL REFERENCES scenario(id),
  approved_by UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  authority_reference VARCHAR(128) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_sa_tenant_id ON scenario_approval (tenant_id, id);

CREATE TABLE scenario_brief_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  scenario_id UUID NOT NULL REFERENCES scenario(id),
  brief_markdown TEXT NOT NULL,
  debrief_markdown TEXT NOT NULL,
  instructor_notes TEXT,
  pilot_preread_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_brief_scenario UNIQUE (tenant_id, scenario_id)
);
CREATE INDEX idx_sbt_tenant_id ON scenario_brief_template (tenant_id, id);
```

---

## D.3 OpenAPI 3.0 (endpoints summary)

```yaml
paths:
  /scenarios:
    get:  { filters: [aircraftType, category, phase, status, page, pageSize], roles: ALL }
    post: { body: ScenarioCreate, roles: [CFI,INSTRUCTOR] }
  /scenarios/{id}:
    get:    {}
    patch:  { roles: [CFI,INSTRUCTOR], only when status=DRAFT }
  /scenarios/{id}/initial-conditions:        { get, post (one allowed) }
  /scenarios/{id}/injections:                { get, post, delete by id }
  /scenarios/{id}/competency-mapping:        { get, post }
  /scenarios/{id}/brief-template:            { get, put }
  /scenarios/{id}/approve:                   { post, body: ScenarioApproveRequest, roles: [CFI] }
  /scenarios/{id}/revoke-approval:           { post, body: { reason }, roles: [CFI] }
  /scenarios/{id}/clone:                     { post, returns new DRAFT version }
  /scenarios/search:                         { post, body: { competencyUnitCodes[], aircraftType, minimumFstdLevel } }
```

Standard error responses (400/401/403/404/410/422/500) on every endpoint.

---

## D.4 TypeScript interfaces

```ts
export type ScenarioCategory = 'NORMAL'|'ABNORMAL'|'EMERGENCY'|'LOFT'|'EBT'|'UPRT'|'CRM_FOCUS';
export type PhaseOfFlight = 'PREFLIGHT'|'TAXI'|'TAKEOFF'|'CLIMB'|'CRUISE'|'DESCENT'|'APPROACH'|'LANDING'|'GO_AROUND'|'ALL';
export type MinimumFstdLevel = 'FNPT_II'|'FTD_2'|'FFS_C'|'FFS_D';
export type ScenarioApprovalStatus = 'DRAFT'|'APPROVED'|'RETIRED';
export type TriggerType = 'TIME'|'EVENT'|'PHASE'|'ATC';
export type InjectionSeverity = 'NORMAL'|'ABNORMAL'|'EMERGENCY';

export interface Scenario {
  id: string; tenantId: string; code: string; title: string;
  aircraftType: string; scenarioCategory: ScenarioCategory;
  phaseOfFlight: PhaseOfFlight; minimumFstdLevel: MinimumFstdLevel;
  approvalStatus: ScenarioApprovalStatus; authorityApprovalRef?: string|null;
  version: number; supersedesScenarioId?: string|null;
  description?: string|null; durationMinutes: number; createdBy: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ScenarioInitialCondition {
  id: string; tenantId: string; scenarioId: string;
  airportIcao: string; runway: string;
  weightKg: number; fuelKg: number; cgPercent: number;
  weather: Record<string, unknown>; ataChapterRefs: string[];
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ScenarioInjection {
  id: string; tenantId: string; scenarioId: string;
  sequence: number; triggerType: TriggerType; triggerSpec: Record<string, unknown>;
  malfunctionCode: string; description: string; expectedCrewResponse: string;
  severity: InjectionSeverity;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ScenarioCompetencyMapping {
  id: string; tenantId: string; scenarioId: string;
  competencyUnitCode: 'AP'|'COM'|'FPA'|'FPM'|'LT'|'PSD'|'SA'|'WM';
  weight: 1|2|3|4|5; observableBehaviours: string[];
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ScenarioApproval {
  id: string; tenantId: string; scenarioId: string;
  approvedBy: string; approvedAt: string;
  authorityReference: string; validFrom: string; validUntil: string;
  revokedAt?: string|null; revokedBy?: string|null; revokeReason?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ScenarioBriefTemplate {
  id: string; tenantId: string; scenarioId: string;
  briefMarkdown: string; debriefMarkdown: string;
  instructorNotes?: string|null; pilotPrereadRefs: string[];
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
```

---

## D.5 Zod schemas

```ts
import { z } from 'zod';

export const scenarioCategoryZ = z.enum(['NORMAL','ABNORMAL','EMERGENCY','LOFT','EBT','UPRT','CRM_FOCUS']);
export const phaseOfFlightZ = z.enum(['PREFLIGHT','TAXI','TAKEOFF','CLIMB','CRUISE','DESCENT','APPROACH','LANDING','GO_AROUND','ALL']);
export const minimumFstdLevelZ = z.enum(['FNPT_II','FTD_2','FFS_C','FFS_D']);

export const scenarioCreateZ = z.object({
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  aircraftType: z.string().min(2).max(32),
  scenarioCategory: scenarioCategoryZ,
  phaseOfFlight: phaseOfFlightZ,
  minimumFstdLevel: minimumFstdLevelZ,
  description: z.string().max(4000).optional(),
  durationMinutes: z.number().int().min(5).max(480)
});
export type ScenarioCreateInput = z.infer<typeof scenarioCreateZ>;

export const initialConditionCreateZ = z.object({
  airportIcao: z.string().length(4),
  runway: z.string().min(2).max(8),
  weightKg: z.number().int().positive(),
  fuelKg: z.number().int().nonnegative(),
  cgPercent: z.number().min(0).max(100),
  weather: z.object({
    windDir: z.number().min(0).max(360),
    windKt: z.number().nonnegative(),
    visMeters: z.number().nonnegative(),
    ceilingFt: z.number().nonnegative(),
    tempC: z.number(),
    qnh: z.number().positive()
  }).passthrough(),
  ataChapterRefs: z.array(z.string()).default([])
});
export type InitialConditionCreateInput = z.infer<typeof initialConditionCreateZ>;

export const injectionCreateZ = z.object({
  sequence: z.number().int().min(1),
  triggerType: z.enum(['TIME','EVENT','PHASE','ATC']),
  triggerSpec: z.record(z.unknown()),
  malfunctionCode: z.string().min(1).max(32),
  description: z.string().min(1).max(2000),
  expectedCrewResponse: z.string().min(1).max(2000),
  severity: z.enum(['NORMAL','ABNORMAL','EMERGENCY'])
});
export type InjectionCreateInput = z.infer<typeof injectionCreateZ>;

export const competencyMappingCreateZ = z.object({
  competencyUnitCode: z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM']),
  weight: z.number().int().min(1).max(5),
  observableBehaviours: z.array(z.string().min(1)).max(20)
});
export type CompetencyMappingCreateInput = z.infer<typeof competencyMappingCreateZ>;

export const scenarioApproveZ = z.object({
  authorityReference: z.string().min(1).max(128),
  validFrom: z.string().date(),
  validUntil: z.string().date()
}).refine(d => d.validUntil > d.validFrom);
export type ScenarioApproveInput = z.infer<typeof scenarioApproveZ>;

export const briefTemplateUpsertZ = z.object({
  briefMarkdown: z.string().min(1).max(20000),
  debriefMarkdown: z.string().min(1).max(20000),
  instructorNotes: z.string().max(10000).optional(),
  pilotPrereadRefs: z.array(z.string()).max(50).default([])
});
export type BriefTemplateUpsertInput = z.infer<typeof briefTemplateUpsertZ>;

export const scenarioSearchZ = z.object({
  competencyUnitCodes: z.array(z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM'])).min(1),
  aircraftType: z.string().min(2).max(32),
  minimumFstdLevel: minimumFstdLevelZ.optional(),
  category: scenarioCategoryZ.optional()
});
export type ScenarioSearchInput = z.infer<typeof scenarioSearchZ>;
```

---

## D.6 EventBridge events

| Event | Payload |
|---|---|
| `scenario.created` | `{ scenarioId, code, version, aircraftType, category }` |
| `scenario.updated` | `{ scenarioId, version }` |
| `scenario.approved` | `{ scenarioId, version, authorityReference, validUntil }` |
| `scenario.approval.revoked` | `{ scenarioId, revokedBy, reason }` |
| `scenario.cloned` | `{ sourceScenarioId, newScenarioId, newVersion }` |
| `scenario.retired` | `{ scenarioId }` |
| `scenario.injection.changed` | `{ scenarioId, injectionId, action: 'CREATED'|'UPDATED'|'DELETED' }` |

---

## D.7 Business rules

- **R-D-1** A scenario cannot be referenced by a booking-service session unless `approval_status = APPROVED` and current date is between `valid_from` and `valid_until`. (ORA.ATO.230)
- **R-D-2** Every approved scenario MUST have at least one `scenario_competency_mapping` (otherwise CBTA cannot map outcomes to CUs). Approval call fails 422.
- **R-D-3** Editing injections/initial-conditions while `approval_status = APPROVED` is forbidden — must clone to new draft version (R-A-2 analogue).
- **R-D-4** `minimum_fstd_level` MUST match or be below the simulator's qualification level at booking time; booking-service validates via API call.
- **R-D-5** Scenarios with `category = EBT` MUST cover ≥3 distinct CUs (ICAO Doc 9995 EBT design rule). Approve fails 422 otherwise.
- **R-D-6** Scenario versions form a chain via `supersedes_scenario_id`; retired versions remain readable for historical inspection.

---

# SERVICE E — `regulatory-reports`

**Regulatory anchor:** EASA Part-ARO.RAMP, FAA AC 120-54A audit support, ICAO Doc 8335 (oversight). Answers the **7 inspector questions** via materialised views and on-demand PDF/JSON exports.

**Purpose:** Generate, version, sign, store, and serve inspector-grade reports — pilot-level, fleet-level, or authority-level. Reads from all other services; writes immutable signed reports.

---

## E.1 Entity model

| Entity | Key fields |
|---|---|
| `ReportTemplate` | id, tenantId, code, title, regulatoryFramework, templateType (PILOT_COMPLIANCE\|FLEET_COMPLIANCE\|AUTHORITY_AUDIT\|INCIDENT_PACKAGE\|TRAINING_LOG_EXTRACT), schemaVersion, layoutSpec JSONB, isAuthorityApproved |
| `ReportRun` | id, tenantId, templateId, scope JSONB (pilotIds[]/fleetIds[]/dateRange), requestedBy, requestedAt, status (QUEUED\|RUNNING\|SUCCEEDED\|FAILED), startedAt, finishedAt, error, outputDocumentId, signedAt, signedBy, signatureHash |
| `ReportDocument` | id, tenantId, reportRunId, format (PDF\|JSON\|CSV\|XML), storageKey (S3), sizeBytes, sha256, generatedAt |
| `PilotComplianceSnapshot` | id, tenantId, pilotId, snapshotAt, question1Status, question2Status, question3Status, question4Status, question5Status, question6Status, question7Status, payload JSONB, overallCompliant, expiresAt |
| `InspectorAccessToken` | id, tenantId, inspectorEmail, scope JSONB, issuedAt, validUntil, revokedAt, accessLog JSONB |

The 7 inspector questions map to `questionXStatus` enum: `PASS|WARN|FAIL|NOT_APPLICABLE|UNKNOWN`.

---

## E.2 DB schema

```sql
CREATE TABLE report_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  regulatory_framework VARCHAR(16) NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','DGCA','CAAC','INTERNAL')),
  template_type VARCHAR(32) NOT NULL CHECK (template_type IN
    ('PILOT_COMPLIANCE','FLEET_COMPLIANCE','AUTHORITY_AUDIT','INCIDENT_PACKAGE','TRAINING_LOG_EXTRACT')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  layout_spec JSONB NOT NULL,
  is_authority_approved BOOLEAN NOT NULL DEFAULT FALSE,
  authority_approval_ref VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_tpl_code UNIQUE (tenant_id, code, schema_version)
);
CREATE INDEX idx_tpl_tenant_id ON report_template (tenant_id, id);

CREATE TABLE report_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  template_id UUID NOT NULL REFERENCES report_template(id),
  scope JSONB NOT NULL,
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  output_document_id UUID,
  signed_at TIMESTAMPTZ,
  signed_by UUID,
  signature_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_run_tenant_id ON report_run (tenant_id, id);
CREATE INDEX idx_run_status ON report_run (tenant_id, status, requested_at DESC);

CREATE TABLE report_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  report_run_id UUID NOT NULL REFERENCES report_run(id),
  format VARCHAR(8) NOT NULL CHECK (format IN ('PDF','JSON','CSV','XML')),
  storage_key VARCHAR(512) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_doc_tenant_id ON report_document (tenant_id, id);
CREATE INDEX idx_doc_run ON report_document (tenant_id, report_run_id);

CREATE TABLE pilot_compliance_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  q1_training_cycle_status      VARCHAR(16) NOT NULL CHECK (q1_training_cycle_status IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q2_medical_status             VARCHAR(16) NOT NULL CHECK (q2_medical_status            IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q3_recency_status             VARCHAR(16) NOT NULL CHECK (q3_recency_status            IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q4_cu_coverage_status         VARCHAR(16) NOT NULL CHECK (q4_cu_coverage_status        IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q5_open_deficits_status       VARCHAR(16) NOT NULL CHECK (q5_open_deficits_status      IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q6_instructor_qual_status     VARCHAR(16) NOT NULL CHECK (q6_instructor_qual_status    IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  q7_simulator_qual_status      VARCHAR(16) NOT NULL CHECK (q7_simulator_qual_status     IN ('PASS','WARN','FAIL','NOT_APPLICABLE','UNKNOWN')),
  payload JSONB NOT NULL,                       -- full evidence per question
  overall_compliant BOOLEAN NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,              -- snapshot freshness window
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_snap_tenant_id ON pilot_compliance_snapshot (tenant_id, id);
CREATE INDEX idx_snap_pilot ON pilot_compliance_snapshot (tenant_id, pilot_id, snapshot_at DESC);

CREATE TABLE inspector_access_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  inspector_email VARCHAR(255) NOT NULL,
  inspector_name VARCHAR(255) NOT NULL,
  authority VARCHAR(128) NOT NULL,
  scope JSONB NOT NULL,                          -- {pilotIds?, fleetIds?, reportTemplates?, expiresAt}
  token_hash CHAR(64) NOT NULL,                  -- bcrypt of bearer token, never stored plain
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  access_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_iat_tenant_id ON inspector_access_token (tenant_id, id);
CREATE UNIQUE INDEX idx_iat_token ON inspector_access_token (tenant_id, token_hash);
```

---

## E.3 OpenAPI 3.0 (endpoints summary)

```yaml
paths:
  /report-templates:                                { get, post (CFI/ADMIN) }
  /report-templates/{id}:                           { get, patch }
  /report-runs:                                     { get list, post (CFI/OPS) }      # async job
  /report-runs/{id}:                                { get }
  /report-runs/{id}/cancel:                         { post (requester or CFI) }
  /report-runs/{id}/sign:                           { post (CFI) }                    # locks output
  /report-runs/{id}/documents:                      { get }
  /report-documents/{id}/download:                  { get, returns 302 to S3 signed URL }
  /pilots/{pilotId}/compliance-snapshot:            { get, post (refresh) }
  /pilots/{pilotId}/compliance-snapshot/history:    { get }
  /pilots/{pilotId}/inspector-summary:              { get, query=token via /inspector/auth }
  /fleets/{aircraftType}/compliance-overview:       { get (CFI/OPS) }
  /inspector-tokens:                                { get list, post (CFI), }
  /inspector-tokens/{id}/revoke:                    { post (CFI) }
  /inspector/auth:                                  { post { token } -> short-lived JWT }
  /inspector/pilots/{pilotId}/answers:              { get, secured by inspector JWT }
```

---

## E.4 TypeScript interfaces

```ts
export type QuestionStatus = 'PASS'|'WARN'|'FAIL'|'NOT_APPLICABLE'|'UNKNOWN';
export type ReportTemplateType = 'PILOT_COMPLIANCE'|'FLEET_COMPLIANCE'|'AUTHORITY_AUDIT'|'INCIDENT_PACKAGE'|'TRAINING_LOG_EXTRACT';
export type ReportRunStatus = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED';
export type ReportFormat = 'PDF'|'JSON'|'CSV'|'XML';

export interface ReportTemplate {
  id: string; tenantId: string; code: string; title: string;
  regulatoryFramework: 'EASA'|'FAA'|'SACAA'|'DGCA'|'CAAC'|'INTERNAL';
  templateType: ReportTemplateType; schemaVersion: number;
  layoutSpec: Record<string, unknown>;
  isAuthorityApproved: boolean; authorityApprovalRef?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ReportRun {
  id: string; tenantId: string; templateId: string;
  scope: Record<string, unknown>; requestedBy: string; requestedAt: string;
  status: ReportRunStatus; startedAt?: string|null; finishedAt?: string|null;
  error?: string|null; outputDocumentId?: string|null;
  signedAt?: string|null; signedBy?: string|null; signatureHash?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface ReportDocument {
  id: string; tenantId: string; reportRunId: string;
  format: ReportFormat; storageKey: string; sizeBytes: number; sha256: string;
  generatedAt: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface PilotComplianceSnapshot {
  id: string; tenantId: string; pilotId: string; snapshotAt: string;
  q1TrainingCycleStatus: QuestionStatus;
  q2MedicalStatus: QuestionStatus;
  q3RecencyStatus: QuestionStatus;
  q4CuCoverageStatus: QuestionStatus;
  q5OpenDeficitsStatus: QuestionStatus;
  q6InstructorQualStatus: QuestionStatus;
  q7SimulatorQualStatus: QuestionStatus;
  payload: Record<string, unknown>; overallCompliant: boolean; expiresAt: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface InspectorAccessToken {
  id: string; tenantId: string; inspectorEmail: string; inspectorName: string;
  authority: string; scope: Record<string, unknown>;
  issuedAt: string; validUntil: string;
  revokedAt?: string|null; revokedBy?: string|null;
  accessLog: Array<{ at: string; ip: string; path: string; ua: string }>;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
```

---

## E.5 Zod schemas

```ts
import { z } from 'zod';

export const reportTemplateCreateZ = z.object({
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  regulatoryFramework: z.enum(['EASA','FAA','SACAA','DGCA','CAAC','INTERNAL']),
  templateType: z.enum(['PILOT_COMPLIANCE','FLEET_COMPLIANCE','AUTHORITY_AUDIT','INCIDENT_PACKAGE','TRAINING_LOG_EXTRACT']),
  layoutSpec: z.record(z.unknown()),
  isAuthorityApproved: z.boolean().default(false),
  authorityApprovalRef: z.string().max(128).optional()
});
export type ReportTemplateCreateInput = z.infer<typeof reportTemplateCreateZ>;

export const reportRunCreateZ = z.object({
  templateId: z.string().uuid(),
  scope: z.object({
    pilotIds: z.array(z.string().uuid()).optional(),
    fleetTypes: z.array(z.string()).optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    includeWaivedDeficits: z.boolean().default(true)
  }).refine(s => s.pilotIds?.length || s.fleetTypes?.length, { message: 'Must scope to pilots or fleet' }),
  outputFormats: z.array(z.enum(['PDF','JSON','CSV','XML'])).min(1).default(['PDF'])
});
export type ReportRunCreateInput = z.infer<typeof reportRunCreateZ>;

export const snapshotRefreshZ = z.object({
  forceRecompute: z.boolean().default(false)
});
export type SnapshotRefreshInput = z.infer<typeof snapshotRefreshZ>;

export const inspectorTokenCreateZ = z.object({
  inspectorEmail: z.string().email(),
  inspectorName: z.string().min(1).max(255),
  authority: z.string().min(1).max(128),
  scope: z.object({
    pilotIds: z.array(z.string().uuid()).optional(),
    fleetTypes: z.array(z.string()).optional(),
    reportTemplates: z.array(z.string().uuid()).optional()
  }),
  validForHours: z.number().int().min(1).max(168)         // max 7 days
});
export type InspectorTokenCreateInput = z.infer<typeof inspectorTokenCreateZ>;

export const inspectorAuthZ = z.object({
  token: z.string().min(40).max(255)
});
export type InspectorAuthInput = z.infer<typeof inspectorAuthZ>;
```

---

## E.6 EventBridge events

| Event | Payload |
|---|---|
| `report.template.created` | `{ templateId, code, templateType }` |
| `report.run.queued` | `{ runId, templateId, scope, requestedBy }` |
| `report.run.started` | `{ runId, startedAt }` |
| `report.run.succeeded` | `{ runId, outputDocumentId, finishedAt }` |
| `report.run.failed` | `{ runId, error }` |
| `report.run.signed` | `{ runId, signedBy, signatureHash }` |
| `pilot.compliance.snapshot.refreshed` | `{ pilotId, snapshotId, overallCompliant, failingQuestions: number[] }` |
| `pilot.compliance.degraded` | `{ pilotId, fromStatus, toStatus, changedQuestions: number[] }` |
| `inspector.token.issued` | `{ tokenId, inspectorEmail, authority, validUntil }` |
| `inspector.token.used` | `{ tokenId, path, at, ip }` |
| `inspector.token.revoked` | `{ tokenId, revokedBy }` |

---

## E.7 Business rules — mapping the 7 questions

| Q | Question | Source | Logic |
|---|---|---|---|
| 1 | Pilot completed training cycle? | training-programmes | `programme_enrolment.status = COMPLETED` for the current applicable programme. Else WARN if IN_PROGRESS within window, FAIL if expired. |
| 2 | Medical valid? | hris-service | `pilot_profile.medical_valid_until > now()`; WARN at 30d, FAIL at 0. |
| 3 | Recency (FCL.060) | hris-service + line-ops-interface | ≥3 landings in last 90d. WARN at 75d gap, FAIL at violation. |
| 4 | All 8 CUs assessed in current cycle | cbta-service | For each of AP, COM, FPA, FPM, LT, PSD, SA, WM exists a `cbta_assessment` within the cycle window. FAIL if any missing. |
| 5 | Open deficits/remedials? | deficit-tracking | Any deficit with `status NOT IN (RESOLVED,WAIVED)` => WARN; any overdue or escalated => FAIL. |
| 6 | Instructor/examiner qualified for session | instructor-records + cbta sessions | For every session in cycle, instructor had valid qualification at `assessed_at`. FAIL if not. |
| 7 | Simulator approved at required level | booking-service simulator + scenario-library `minimum_fstd_level` | `simulator_qualification_level >= scenario.minimum_fstd_level` AND simulator certificate valid at `assessed_at`. |

- **R-E-1** Snapshots are cache: `expires_at = snapshot_at + 24h`. GET refreshes if expired.
- **R-E-2** Signed reports are immutable (`signed_at IS NOT NULL`) — PATCH/DELETE return 410.
- **R-E-3** Inspector tokens: max validity 7 days, scope MUST be present, every access appended to `access_log` and emits `inspector.token.used` for security audit.
- **R-E-4** Inspector access is read-only and only via `/inspector/...` paths. Standard endpoints reject inspector JWT (different audience claim).
- **R-E-5** Report runs are async; expected SLA p95 < 60s for single pilot, < 5min for fleet of 200.
- **R-E-6** Reports are stored in S3 with bucket policy enforcing tenant isolation via prefix `{tenantId}/reports/{runId}/...`.

---

# SERVICE F — `line-ops-interface`

**Regulatory anchor:** FCL.725.A (LIFUS for type-rating completion: 100 sectors / 1500h ICAO), ORO.FC.515 (line training programme), AMC1 ORO.FC.515.

**Purpose:** Capture sectors flown under line training (LIFUS) and ongoing line operations evidence that feeds recency (Q3), CU coverage (Q4), and programme phase progress for LIFUS phases. Provides the API the airline OPS/dispatch system or eFB integration calls to push sector data.

---

## F.1 Entity model

| Entity | Key fields |
|---|---|
| `LineTrainingAssignment` | id, tenantId, pilotId, programmeEnrolmentId, lineTrainingCaptainId (instructor_record), startDate, plannedSectors, completedSectors, status (PLANNED\|ACTIVE\|COMPLETED\|TERMINATED), terminationReason |
| `SectorLog` | id, tenantId, pilotId, lineTrainingAssignmentId (nullable for normal line), flightDate, flightNumber, aircraftRegistration, aircraftType, departureIcao, arrivalIcao, blockOutAt, takeoffAt, landingAt, blockInAt, blockTimeMinutes, flightTimeMinutes, pilotFlyingRole (PF\|PM), commanderId, instructorId (nullable), landingsCount, nightFlight, ifrTime, picTime, sicTime, takeoffsCount |
| `SectorAssessment` | id, tenantId, sectorLogId, instructorId, debriefAt, overallOutcome (SATISFACTORY\|UNSATISFACTORY\|RECOMMENDED_FOR_RELEASE), competencyScores JSONB (CU code -> 1-5), narrative, simulatorId (nullable for line — keep field NULL but require for cross-credited sim sectors), simulatorQualificationLevel, instructorQualification, sessionType (LIFUS), assessedAt |
| `LineCheckRelease` | id, tenantId, pilotId, programmeEnrolmentId, releasedAt, releasedBy (CFI), sectorsAccumulated, picRequirementMet, narrative, documentRef |
| `RecencyEvent` | id, tenantId, pilotId, eventType (LANDING\|TAKEOFF\|NIGHT_LANDING\|IFR_APPROACH), eventAt, sectorLogId |

---

## F.2 DB schema

```sql
CREATE TABLE line_training_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  programme_enrolment_id UUID NOT NULL,
  line_training_captain_id UUID NOT NULL,
  start_date DATE NOT NULL,
  planned_sectors INTEGER NOT NULL CHECK (planned_sectors >= 1),
  completed_sectors INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','TERMINATED')),
  termination_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_lta_tenant_id ON line_training_assignment (tenant_id, id);
CREATE INDEX idx_lta_pilot ON line_training_assignment (tenant_id, pilot_id, status);

CREATE TABLE sector_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  line_training_assignment_id UUID REFERENCES line_training_assignment(id),
  flight_date DATE NOT NULL,
  flight_number VARCHAR(16) NOT NULL,
  aircraft_registration VARCHAR(16) NOT NULL,
  aircraft_type VARCHAR(32) NOT NULL,
  departure_icao CHAR(4) NOT NULL,
  arrival_icao CHAR(4) NOT NULL,
  block_out_at TIMESTAMPTZ NOT NULL,
  takeoff_at TIMESTAMPTZ NOT NULL,
  landing_at TIMESTAMPTZ NOT NULL,
  block_in_at TIMESTAMPTZ NOT NULL,
  block_time_minutes INTEGER NOT NULL,
  flight_time_minutes INTEGER NOT NULL,
  pilot_flying_role VARCHAR(2) NOT NULL CHECK (pilot_flying_role IN ('PF','PM')),
  commander_id UUID NOT NULL,
  instructor_id UUID,
  landings_count SMALLINT NOT NULL DEFAULT 1 CHECK (landings_count >= 0),
  takeoffs_count SMALLINT NOT NULL DEFAULT 1 CHECK (takeoffs_count >= 0),
  night_flight_minutes INTEGER NOT NULL DEFAULT 0,
  ifr_time_minutes INTEGER NOT NULL DEFAULT 0,
  pic_time_minutes INTEGER NOT NULL DEFAULT 0,
  sic_time_minutes INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(16) NOT NULL CHECK (source IN ('EFB','OPS_SYSTEM','MANUAL')),
  immutable_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_sector UNIQUE (tenant_id, pilot_id, flight_date, flight_number, departure_icao, arrival_icao)
);
CREATE INDEX idx_sl_tenant_id ON sector_log (tenant_id, id);
CREATE INDEX idx_sl_pilot_date ON sector_log (tenant_id, pilot_id, flight_date DESC);
CREATE INDEX idx_sl_assignment ON sector_log (tenant_id, line_training_assignment_id);

CREATE TABLE sector_assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  sector_log_id UUID NOT NULL REFERENCES sector_log(id),
  instructor_id UUID NOT NULL,
  debrief_at TIMESTAMPTZ NOT NULL,
  overall_outcome VARCHAR(32) NOT NULL CHECK (overall_outcome IN
    ('SATISFACTORY','UNSATISFACTORY','RECOMMENDED_FOR_RELEASE')),
  competency_scores JSONB NOT NULL,                         -- {"AP":3,"COM":4,...}
  narrative TEXT NOT NULL,
  simulator_id UUID,
  simulator_qualification_level VARCHAR(8),
  instructor_qualification VARCHAR(16) NOT NULL,
  session_type VARCHAR(16) NOT NULL DEFAULT 'LIFUS',
  assessed_at TIMESTAMPTZ NOT NULL,
  immutable_after TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_sa_sector UNIQUE (tenant_id, sector_log_id)
);
CREATE INDEX idx_sa_tenant_id ON sector_assessment (tenant_id, id);

CREATE TABLE line_check_release (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  programme_enrolment_id UUID NOT NULL,
  released_at TIMESTAMPTZ NOT NULL,
  released_by UUID NOT NULL,
  sectors_accumulated INTEGER NOT NULL,
  pic_requirement_met BOOLEAN NOT NULL,
  narrative TEXT NOT NULL,
  document_ref VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_release_per_enrolment UNIQUE (tenant_id, programme_enrolment_id)
);
CREATE INDEX idx_lcr_tenant_id ON line_check_release (tenant_id, id);

CREATE TABLE recency_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  pilot_id UUID NOT NULL,
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('LANDING','TAKEOFF','NIGHT_LANDING','IFR_APPROACH')),
  event_at TIMESTAMPTZ NOT NULL,
  sector_log_id UUID NOT NULL REFERENCES sector_log(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_re_tenant_id ON recency_event (tenant_id, id);
CREATE INDEX idx_re_pilot_event ON recency_event (tenant_id, pilot_id, event_type, event_at DESC);
```

---

## F.3 OpenAPI 3.0 (endpoints summary)

```yaml
paths:
  /line-training-assignments:                                   { get, post (CFI/INSTRUCTOR) }
  /line-training-assignments/{id}:                              { get, patch }
  /line-training-assignments/{id}/terminate:                    { post (CFI) }
  /sectors:                                                     { get (PILOT own only/CFI/OPS), post }
  /sectors/bulk:                                                { post — eFB/OPS integration, idempotent on (pilotId,flightDate,flightNumber) }
  /sectors/{id}:                                                { get, patch (within 48h or CFI override) }
  /sectors/{id}/assessment:                                     { get, put (LTC instructor) }
  /pilots/{pilotId}/recency:                                    { get — returns currentLandings90d, currentTakeoffs90d, status }
  /pilots/{pilotId}/sector-summary:                             { get — totals by date range }
  /line-check-releases:                                         { get, post (CFI) }
  /line-check-releases/{id}:                                    { get }
  /webhooks/efb-sync:                                           { post, HMAC-signed payload, idempotency-key required }
```

Standard 400/401/403/404/409/410/422/500 responses on every endpoint.

---

## F.4 TypeScript interfaces

```ts
export type LtaStatus = 'PLANNED'|'ACTIVE'|'COMPLETED'|'TERMINATED';
export type PilotFlyingRole = 'PF'|'PM';
export type SectorSource = 'EFB'|'OPS_SYSTEM'|'MANUAL';
export type SectorOutcome = 'SATISFACTORY'|'UNSATISFACTORY'|'RECOMMENDED_FOR_RELEASE';
export type RecencyEventType = 'LANDING'|'TAKEOFF'|'NIGHT_LANDING'|'IFR_APPROACH';

export interface LineTrainingAssignment {
  id: string; tenantId: string; pilotId: string; programmeEnrolmentId: string;
  lineTrainingCaptainId: string; startDate: string;
  plannedSectors: number; completedSectors: number;
  status: LtaStatus; terminationReason?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface SectorLog {
  id: string; tenantId: string; pilotId: string;
  lineTrainingAssignmentId?: string|null;
  flightDate: string; flightNumber: string;
  aircraftRegistration: string; aircraftType: string;
  departureIcao: string; arrivalIcao: string;
  blockOutAt: string; takeoffAt: string; landingAt: string; blockInAt: string;
  blockTimeMinutes: number; flightTimeMinutes: number;
  pilotFlyingRole: PilotFlyingRole;
  commanderId: string; instructorId?: string|null;
  landingsCount: number; takeoffsCount: number;
  nightFlightMinutes: number; ifrTimeMinutes: number;
  picTimeMinutes: number; sicTimeMinutes: number;
  source: SectorSource; immutableAfter: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface SectorAssessment {
  id: string; tenantId: string; sectorLogId: string;
  instructorId: string; debriefAt: string;
  overallOutcome: SectorOutcome;
  competencyScores: Partial<Record<'AP'|'COM'|'FPA'|'FPM'|'LT'|'PSD'|'SA'|'WM', 1|2|3|4|5>>;
  narrative: string;
  simulatorId?: string|null; simulatorQualificationLevel?: string|null;
  instructorQualification: string; sessionType: 'LIFUS';
  assessedAt: string; immutableAfter: string;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface LineCheckRelease {
  id: string; tenantId: string; pilotId: string; programmeEnrolmentId: string;
  releasedAt: string; releasedBy: string;
  sectorsAccumulated: number; picRequirementMet: boolean;
  narrative: string; documentRef?: string|null;
  createdAt: string; updatedAt: string; deletedAt?: string|null;
}
export interface RecencyStatus {
  pilotId: string;
  landings90d: number; takeoffs90d: number;
  nightLandings90d: number; ifrApproaches90d: number;
  lastLandingAt?: string|null;
  meetsFcl060: boolean;
  warning75d: boolean;
}
```

---

## F.5 Zod schemas

```ts
import { z } from 'zod';

export const ltaCreateZ = z.object({
  pilotId: z.string().uuid(),
  programmeEnrolmentId: z.string().uuid(),
  lineTrainingCaptainId: z.string().uuid(),
  startDate: z.string().date(),
  plannedSectors: z.number().int().min(1).max(500)
});
export type LtaCreateInput = z.infer<typeof ltaCreateZ>;

export const sectorCreateZ = z.object({
  pilotId: z.string().uuid(),
  lineTrainingAssignmentId: z.string().uuid().nullable().optional(),
  flightDate: z.string().date(),
  flightNumber: z.string().min(1).max(16),
  aircraftRegistration: z.string().min(2).max(16),
  aircraftType: z.string().min(2).max(32),
  departureIcao: z.string().length(4),
  arrivalIcao: z.string().length(4),
  blockOutAt: z.string().datetime(),
  takeoffAt: z.string().datetime(),
  landingAt: z.string().datetime(),
  blockInAt: z.string().datetime(),
  pilotFlyingRole: z.enum(['PF','PM']),
  commanderId: z.string().uuid(),
  instructorId: z.string().uuid().nullable().optional(),
  landingsCount: z.number().int().min(0).max(20),
  takeoffsCount: z.number().int().min(0).max(20),
  nightFlightMinutes: z.number().int().min(0),
  ifrTimeMinutes: z.number().int().min(0),
  picTimeMinutes: z.number().int().min(0),
  sicTimeMinutes: z.number().int().min(0),
  source: z.enum(['EFB','OPS_SYSTEM','MANUAL'])
}).superRefine((d, ctx) => {
  if (new Date(d.blockOutAt) >= new Date(d.takeoffAt)) ctx.addIssue({ code: 'custom', message: 'takeoffAt must be after blockOutAt' });
  if (new Date(d.takeoffAt) >= new Date(d.landingAt)) ctx.addIssue({ code: 'custom', message: 'landingAt must be after takeoffAt' });
  if (new Date(d.landingAt) >= new Date(d.blockInAt)) ctx.addIssue({ code: 'custom', message: 'blockInAt must be after landingAt' });
});
export type SectorCreateInput = z.infer<typeof sectorCreateZ>;

export const sectorBulkCreateZ = z.object({
  idempotencyKey: z.string().uuid(),
  sectors: z.array(sectorCreateZ).min(1).max(200)
});
export type SectorBulkCreateInput = z.infer<typeof sectorBulkCreateZ>;

export const sectorAssessmentUpsertZ = z.object({
  debriefAt: z.string().datetime(),
  overallOutcome: z.enum(['SATISFACTORY','UNSATISFACTORY','RECOMMENDED_FOR_RELEASE']),
  competencyScores: z.record(
    z.enum(['AP','COM','FPA','FPM','LT','PSD','SA','WM']),
    z.number().int().min(1).max(5)
  ),
  narrative: z.string().min(20).max(8000),
  instructorQualification: z.string().min(1).max(16),
  sessionType: z.literal('LIFUS').default('LIFUS'),
  assessedAt: z.string().datetime()
});
export type SectorAssessmentUpsertInput = z.infer<typeof sectorAssessmentUpsertZ>;

export const lineCheckReleaseCreateZ = z.object({
  pilotId: z.string().uuid(),
  programmeEnrolmentId: z.string().uuid(),
  releasedAt: z.string().datetime(),
  narrative: z.string().min(50).max(8000),
  documentRef: z.string().max(255).optional()
});
export type LineCheckReleaseCreateInput = z.infer<typeof lineCheckReleaseCreateZ>;
```

---

## F.6 EventBridge events

| Event | Payload |
|---|---|
| `lineops.assignment.created` | `{ assignmentId, pilotId, plannedSectors }` |
| `lineops.assignment.terminated` | `{ assignmentId, pilotId, reason }` |
| `lineops.sector.recorded` | `{ sectorId, pilotId, flightDate, flightNumber, landingsCount, assignmentId? }` |
| `lineops.sector.bulk.ingested` | `{ count, idempotencyKey, failures }` |
| `lineops.sector.assessed` | `{ sectorId, assessmentId, overallOutcome, instructorId }` |
| `lineops.sector.unsatisfactory` | `{ sectorId, pilotId, instructorId }` (triggers deficit-tracking via failing CU scores in payload) |
| `lineops.recency.degraded` | `{ pilotId, landings90d, daysUntilFcl060Breach }` |
| `lineops.recency.breached` | `{ pilotId, breachedAt }` |
| `lineops.linecheck.released` | `{ releaseId, pilotId, sectorsAccumulated }` |
| `lineops.lifus.completed` | `{ assignmentId, pilotId, sectorsAccumulated, programmeEnrolmentId }` (sectors >= plannedSectors with all SATISFACTORY) |

---

## F.7 Business rules

- **R-F-1** Sector logs are immutable after `immutable_after` (block-in + 48h) except by CFI with documented override (R-F-3).
- **R-F-2** Sector assessment is immutable after `immutable_after` except by `CFI` or `TRE` with override reason >= 30 chars.
- **R-F-3** Any modification post-immutable timestamp writes a delta row to `audit_log` and emits `lineops.sector.amended`.
- **R-F-4** When `overall_outcome = UNSATISFACTORY` or any CU score `<= 2`, the service publishes data that `deficit-tracking` consumes to auto-open deficit (R-C-1).
- **R-F-5** Recency calculation (Q3): rolling 90 days; `landings >= 3` to meet FCL.060(b). Scheduler emits `lineops.recency.degraded` at 75-day mark when only 1 landing remains until breach.
- **R-F-6** `lineops.lifus.completed` emits ONLY when `completed_sectors >= planned_sectors` AND all sector assessments in the assignment have `overall_outcome IN (SATISFACTORY, RECOMMENDED_FOR_RELEASE)` AND a `line_check_release` exists.
- **R-F-7** LIFUS minimum 100 sectors per FCL.725.A unless training programme specifies a higher number. Approve of programme phase `LIFUS` MUST set `gate_criterion LIFUS_SECTORS_MIN` accordingly.
- **R-F-8** Bulk sector ingestion is idempotent on `idempotencyKey` + `(pilotId, flightDate, flightNumber, departureIcao, arrivalIcao)` — duplicates return 200 with the original IDs.
- **R-F-9** Webhook `/webhooks/efb-sync` requires `X-Aerocap-Signature` HMAC-SHA256 with per-tenant secret; invalid signature returns 401. Idempotency-key TTL = 24h.

---

# MASTER SUMMARY

| Service | Entities | Endpoints (logical) | EventBridge events |
|---|---:|---:|---:|
| A — training-programmes | 7 | 14 | 9 |
| B — instructor-records | 5 | 11 | 10 |
| C — deficit-tracking | 4 | 13 | 9 |
| D — scenario-library | 6 | 12 | 7 |
| E — regulatory-reports | 5 | 16 | 11 |
| F — line-ops-interface | 5 | 13 | 10 |
| **TOTAL** | **32 entities** | **79 endpoints** | **56 events** |

- **Services delivered:** 6
- **Tables created:** 32
- **OpenAPI paths:** 79 (all paginated where list, all secured Bearer JWT, all with 400/401/403/404/422/500 envelope)
- **TypeScript interfaces / Zod schemas:** 1:1 mapping enforced
- **EventBridge events:** 56 (every state transition is observable)
- **Composite tenant index** (`tenant_id, id`) on every table
- **Soft-delete** column present on every training record
- **48h immutability** enforced on sector logs and sector assessments (R-F-1, R-F-2)

---

## Open questions requiring CFI / authority input

- `[OPEN-1]` Confirm cycle length per programme type per regulator: EASA OPC = 6 months, LPC = 1 year, recurrent = 1 year — but local authority variances (CAAC, DGCA) need confirmation. (affects Q1/Q4 cycle window logic)
- `[OPEN-2]` Should `programme_enrolment` allow concurrent active enrolments for the same pilot (e.g., type rating + UPRT in parallel)? Current schema unique constraint blocks duplicates per programme but not across programmes — confirm with Head of Training.
- `[OPEN-3]` `TRE` examiner authorisation revalidation cadence varies: EASA = 3 years, FAA Designated Examiner = annual. Need authority-by-authority validity matrix to drive `valid_until` calculation defaults in R-B-2.
- `[OPEN-4]` Deficit waiver requires `authorityRef`. Is the authority always the NAA, or can the AOC Head of Training waive internally? (R-C-6)
- `[OPEN-5]` Confirm 30-day re-assessment window applies uniformly under ICAO Doc 9995, or whether airline-specific Training Manual can vary it (some ATOs use 14 or 45 days).
- `[OPEN-6]` `scenario_library.minimum_fstd_level` enumeration — confirm SACAA equivalence for `FFS_D` vs CS-FSTD(A) Level D for cross-region scenarios.
- `[OPEN-7]` Should the inspector token grant access to PII (pilot full names, dates of birth, licence numbers) or only operational identifiers (employee number)? GDPR Art. 6(1)(c) lawful basis presumed, but principle of minimisation — needs DPO review.
- `[OPEN-8]` LIFUS sector count: FCL.725.A says "as defined in OM-D"; some operators require 40, others 100, some 1500 hours. Confirm authoritative per-AOC config source for `LIFUS_SECTORS_MIN`.
- `[OPEN-9]` Recency Q3: FCL.060(b) is 3 landings/90d for passenger ops. For cargo-only operators (FedEx-style) the rule differs — does AeroCap need a `pilot_profile.operation_type` flag in hris-service to drive this?
- `[OPEN-10]` Q4 — "current cycle": is the cycle bound to the calendar year, the programme enrolment window, or a rolling 12 months from last LPC? Different national authorities differ; need ATO Training Manual ruling.
- `[OPEN-11]` Cross-border data residency: pilot training records for a French pilot trained in South Africa — does primary record live in FR (GDPR) tenant DB or ZA tenant DB? Affects schema-per-tenant routing and Q-replication.
- `[OPEN-12]` Should `sector_log` accept PIC time AND SIC time on the same row (current schema does), or enforce mutually exclusive? Some authorities reject blended logging.
- `[OPEN-13]` `report.run.signed` — what signature standard? PKCS#7 detached PDF signature, eIDAS qualified e-signature, or simple SHA256-of-content stored on chain? Authority preference per region.
- `[OPEN-14]` Whether `INSTRUCTOR` role at line-ops-interface includes line-training captains (LTC) only, or also includes type-rating instructors flying as observer — terminology needs CFI ratification.
- `[OPEN-15]` Notification channel routing: does each tenant pick email vs SMS vs push, or fixed by event type? Affects EventBridge → notification fan-out service design.

---

End of specification. This document is the binding contract; any deviation by the implementation team must be raised as a written CR against this version before code is written.
