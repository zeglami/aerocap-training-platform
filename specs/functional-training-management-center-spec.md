# AeroCap Functional Training Management Center Specification

**Date:** 2026-05-30  
**Status:** Draft contract for implementation  
**Source agents:** `spec-generator`, `training-management`  
**Scope:** Training programmes, phases, modules, enrolments, session assessment requirements, CBTA gate rules, remedial deficit triggers, instructor/examiner validity, simulator qualification evidence, regulatory reporting handoff

---

## 0. Regulatory Baseline

| Regulation | Product implication |
|---|---|
| EASA Part-FCL FCL.060 | Recent experience must be inspectable: 3 take-offs and landings in 90 days, or an accepted check in the previous 6 months. |
| EASA Part-FCL FCL.625 and FCL.740 | IR and type-rating revalidation require valid LPC/OPC evidence, examiner qualification, and timing relative to expiry. |
| EASA Part-ORA ORA.ATO.110 and ORA.ATO.220 | Training manuals, approved syllabi, and training records must be retained and audit-ready for at least 5 years. |
| EASA Part-ORO ORO.FC.230 | Recurrent and EBT programme cycles must capture operator checks, manoeuvre phase evidence, and annual licence/proficiency evidence where applicable. |
| EASA CS-FSTD(A) ORA.FSTD.100 | Simulator level and approval reference must be stored on sessions that count toward training or checking credit. |
| ICAO Doc 9868 and Doc 9995 | CBTA/EBT records must be per-competency, not global pass/fail only. Scores below standard trigger training action. |
| FAA Part 61/141 and AC 120-54B | FAA/AQP tenants require jurisdiction-aware rule variants for proficiency standards, simulator credit, and recency evidence. |
| SACAA CATS-FCL | South Africa tenant uses ICAO-compatible records with SACAA-specific licence and revalidation references. |

**Core rule:** the system must answer an inspector's question without reconstructing evidence from multiple mutable sources: who trained, who assessed, on which approved simulator, under which syllabus revision, at what time, against which competency targets, and with what signed outcome.

---

## 1. Domain Assumptions

- AeroCap is multi-tenant. Every domain table is tenant-scoped with `tenant_id`, and `tenantId` is always sourced from the JWT, never from request bodies.
- API responses use UUIDs only. No sequential identifiers are exposed.
- Training records are never physically deleted through application workflows. Use soft delete plus audit trail.
- Programme definitions can be drafted, approved, retired, and superseded. Enrolments always point to the exact approved programme revision used at the time of training.
- CBTA uses the 8 standard competency units: `AP`, `COM`, `FPA`, `FPM`, `LT`, `PSD`, `SA`, `WM`.
- Competency score scale is integer `1..5`. Scores `1` or `2` automatically create or update an open deficit.
- Session types are: `ITR`, `RECURRENT`, `OPC`, `LPC`, `LINE_CHECK`, `UPRT`, `EBT`, `FREE_PRACTICE`.
- Records that count for regulatory credit require simulator, instructor/examiner, scenario, per-competency scores, outcome, and digital signature evidence.
- Records become immutable 48 hours after instructor signature unless a CFI or TRE applies a documented override.

---

## 2. Entity Model

### 2.1 TrainingProgramme

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| code | string | yes | Unique per tenant/version, e.g. `TR-B737-INITIAL` |
| name | string | yes | Human-readable programme name |
| type | enum | yes | `INITIAL`, `RECURRENT`, `UPGRADE`, `CONVERSION`, `OPC`, `LPC`, `EBT`, `UPRT`, `LIFUS`, `TRI_COURSE`, `TRE_COURSE` |
| aircraftType | string | yes | ICAO type or family, e.g. `A320`, `B737` |
| regulatoryFramework | enum | yes | `EASA`, `FAA`, `SACAA`, `ICAO`, `CAAC`, `DGCA` |
| regulatoryBasis | string[] | yes | Must include at least one citation |
| validityMonths | number | no | Required if programme grants/revalidates qualification |
| prerequisiteRatings | string[] | yes | Empty array allowed |
| authorityApprovalRef | string | yes | ATO/TRTO/operator approval reference |
| approvalValidFrom | date | yes | Required before approval |
| approvalValidUntil | date | no | Nullable for non-expiring authority approval |
| version | number | yes | Starts at 1 |
| status | enum | yes | `DRAFT`, `APPROVED`, `RETIRED` |
| supersedesProgrammeId | UUID | no | Same tenant only |
| approvedBy | UUID | no | User ID, CFI/authorized manager |
| approvedAt | datetime | no | Required when status becomes `APPROVED` |
| createdAt, updatedAt, deletedAt | datetime | yes/no | Standard audit fields |

Relationship: one programme has many phases, competency targets, enrolments, and scenario requirements.

### 2.2 ProgrammePhase

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| programmeId | UUID | yes | References `training_programme` |
| sequence | number | yes | Unique per programme |
| code | string | yes | e.g. `PH-FFS-D` |
| name | string | yes | Display name |
| deliveryMode | enum | yes | `CBT`, `GROUND`, `FBS`, `FTD`, `FNPT`, `FFS`, `AIRCRAFT`, `LIFUS` |
| minimumSessions | number | yes | Integer >= 0 |
| plannedDurationMinutes | number | yes | Integer >= 0 |
| gateStrategy | enum | yes | `ALL_CRITERIA`, `ANY_CRITERION`, `CFI_OVERRIDE_ALLOWED` |

Relationship: one phase has many modules, gate criteria, scenario requirements, and progress rows.

### 2.3 ProgrammeModule

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| phaseId | UUID | yes | References `programme_phase` |
| sequence | number | yes | Unique per phase |
| code | string | yes | e.g. `FFS-03` |
| name | string | yes | Module/session title |
| sessionType | enum | yes | Session type validated by this module |
| minimumDurationMinutes | number | yes | Integer >= 0 |
| competencyUnitCodes | string[] | yes | Subset of 8 CBTA units |
| learningObjectives | string[] | yes | Empty array allowed |
| mandatory | boolean | yes | Defaults true |
| minimumOverallScore | number | no | `1..5`; does not replace per-CU targets |

Relationship: modules can have prerequisites and module completion records.

### 2.4 ProgrammePrerequisite

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| moduleId | UUID | yes | Target module |
| prerequisiteModuleId | UUID | no | Module prerequisite |
| prerequisiteProgrammeId | UUID | no | Prior programme prerequisite |
| prerequisiteRatingCode | string | no | Licence/rating prerequisite |
| type | enum | yes | `HARD`, `SOFT`, `ADVISORY` |
| waiverAllowedByRole | enum | yes | `NONE`, `CFI`, `TRE` |

Exactly one of `prerequisiteModuleId`, `prerequisiteProgrammeId`, or `prerequisiteRatingCode` must be present.

### 2.5 CompetencyTarget

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| programmeId | UUID | yes | References programme |
| phaseId | UUID | no | Optional phase-specific override |
| competencyUnitCode | enum | yes | `AP`, `COM`, `FPA`, `FPM`, `LT`, `PSD`, `SA`, `WM` |
| minimumScore | number | yes | Integer `1..5`, normally `3` |
| remedialTriggerScore | number | yes | Normally `2` |
| requiredAssessmentCount | number | yes | Minimum number of valid assessments in cycle |

### 2.6 GateCriterion

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| phaseId | UUID | yes | References phase |
| type | enum | yes | `ALL_MODULES_COMPLETE`, `MIN_CU_SCORE`, `MEDICAL_VALID`, `RECENCY_OK`, `LICENCE_VALID`, `INSTRUCTOR_SIGN_OFF`, `EXAMINER_SIGN_OFF`, `LIFUS_SECTORS_MIN`, `NO_OPEN_DEFICITS` |
| parameters | object | yes | JSON object, schema depends on type |
| blocksProgression | boolean | yes | Defaults true |
| evidenceService | string | no | e.g. `hris-service`, `cbta-service` |

### 2.7 ProgrammeEnrolment

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| programmeId | UUID | yes | Must reference approved programme |
| pilotId | UUID | yes | Same tenant |
| enrolledBy | UUID | yes | User ID |
| enrolledAt | datetime | yes | Defaults now |
| expectedCompletionAt | datetime | no | Required for initial/recurrent training |
| completedAt | datetime | no | Set only after all blocking gates clear |
| status | enum | yes | `ENROLLED`, `IN_PROGRESS`, `GATE_BLOCKED`, `COMPLETED`, `WITHDRAWN`, `FAILED` |
| withdrawalReason | string | no | Required if withdrawn |

### 2.8 ProgrammeProgress

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| enrolmentId | UUID | yes | References enrolment |
| phaseId | UUID | yes | References phase |
| status | enum | yes | `NOT_STARTED`, `IN_PROGRESS`, `GATE_BLOCKED`, `COMPLETED`, `FAILED` |
| startedAt | datetime | no | Set when first module starts |
| completedAt | datetime | no | Set after phase gates clear |
| gateOverrideBy | UUID | no | CFI/TRE user ID |
| gateOverrideReason | string | no | Required for override |
| gateOverrideAt | datetime | no | Required for override |

### 2.9 TrainingSessionRecord

This entity is the regulatory evidence envelope for a conducted session. It may reference booking-service reservation IDs and CBTA assessments, but it must preserve enough data to remain inspectable even if upstream display values change.

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| enrolmentId | UUID | no | Nullable for free practice or standalone check |
| programmeModuleId | UUID | no | Required when session counts toward programme progress |
| reservationId | UUID | no | Booking-service reservation |
| pilotId | UUID | yes | Same tenant |
| instructorId | UUID | yes | Required for regulatory credit |
| instructorQualification | string | yes | Snapshot, e.g. `TRI A320`, `TRE B737` |
| examinerRequired | boolean | yes | Derived from session type/module |
| examinerId | UUID | no | Required for OPC/LPC/ITR final check |
| examinerAuthorisationRef | string | no | Required when examinerId present |
| sessionType | enum | yes | Session type |
| scenarioId | UUID | no | Approved scenario-library scenario |
| aircraftType | string | yes | Snapshot |
| simulatorId | UUID | no | Required for simulator session |
| simulatorQualificationLevel | enum | no | `FFS_A`, `FFS_B`, `FFS_C`, `FFS_D`, `FTD`, `FNPT`, `AIRCRAFT`, `N_A` |
| simulatorApprovalRef | string | no | Required if simulator used for credit |
| startedAt | datetime | yes | Actual start |
| endedAt | datetime | yes | Actual end |
| durationMinutes | number | yes | Derived, must meet module minimum if applicable |
| assessedAt | datetime | yes | When assessment was completed |
| outcome | enum | yes | `PASS`, `FURTHER_TRAINING_REQUIRED`, `FAIL`, `TRAINING_ONLY` |
| instructorSignatureHash | string | no | Required after sign-off |
| signedAt | datetime | no | Required with signature |
| lockedAt | datetime | no | Auto-set 48h after signature |
| amendmentReason | string | no | Required for post-lock mutation |

### 2.10 CompetencyAssessment

| Field | Type | Required | Constraints |
|---|---:|---:|---|
| id | UUID | yes | Primary key |
| tenantId | string | yes | From JWT only |
| sessionRecordId | UUID | yes | References session record |
| competencyUnitCode | enum | yes | 8 CBTA units |
| score | number | yes | Integer `1..5` |
| behaviouralMarkers | object[] | yes | Observed markers and notes |
| notes | string | no | Instructor comments |
| assessedBy | UUID | yes | Instructor/examiner user ID |
| assessedAt | datetime | yes | Timestamp |

### 2.11 AuditLog Reference

The domain writes mutation audit entries to the platform `audit_log` table. The owning table is shared infrastructure, but every mutation in this spec must record:

| Field | Type | Required |
|---|---:|---:|
| tenantId | string | yes |
| actorUserId | UUID | yes |
| action | string | yes |
| entityType | string | yes |
| entityId | UUID | yes |
| before | object | no |
| after | object | no |
| reason | string | no |
| occurredAt | datetime | yes |
| requestId | UUID | yes |

---

## 3. Business Rules

### 3.1 Programme Approval

| Rule | IF | THEN | ELSE |
|---|---|---|---|
| Programme approval | status changes to `APPROVED` | require authority approval ref, valid from date, at least one phase, at least one competency target, and audit entry | return `422 BUSINESS_RULE_VIOLATION` |
| Approved programme mutation | approved programme already has enrolments | create a new version instead of mutating regulatory fields | allow non-regulatory metadata updates only |
| Retirement | programme status becomes `RETIRED` | block new enrolments | existing enrolments continue on their recorded revision |

### 3.2 Enrolment

| Rule | IF | THEN | ELSE |
|---|---|---|---|
| Tenant isolation | request body contains tenantId | reject body field and source tenant from JWT | continue |
| Programme status | programme is not `APPROVED` | reject enrolment | create enrolment |
| Duplicate active enrolment | pilot already has active enrolment for same programme version | return `409 CONFLICT` | create enrolment |
| Prerequisites | hard prerequisite missing | return `422 BUSINESS_RULE_VIOLATION` | enrol |

### 3.3 Session Validity

| Rule | IF | THEN | ELSE |
|---|---|---|---|
| Instructor qualification | session type requires TRI/TRE and instructor record is invalid or expired | mark session `TRAINING_ONLY` and block programme credit | allow credit |
| Examiner requirement | sessionType is `ITR`, `OPC`, or `LPC` | require examiner ID and authorisation reference | reject sign-off |
| Simulator credit | session uses simulator for regulatory credit | require simulator qualification level and approval reference | reject sign-off |
| Duration | session duration below module minimum | block module completion | record as non-credit training |
| Same-day fatigue guard | pilot already has simulator session that calendar day | warn/block according to tenant policy | allow scheduling |
| LPC/OPC gaming guard | previous LPC/OPC within 30 days | require CFI override | allow scheduling |

### 3.4 CBTA and Deficits

| Rule | IF | THEN | ELSE |
|---|---|---|---|
| Per-CU scoring | session counts toward CBTA/EBT | require scores for all module competency units | reject sign-off |
| Automatic deficit | any competency score <= 2 | emit `training.deficit.triggered` and create/update open deficit | no deficit |
| Remedial due date | deficit opened | set reassessment due within 30 days | n/a |
| Escalation | deficit remains open 21 days after creation | notify CFI and emit escalation event | no escalation |
| Progression gate | phase has `NO_OPEN_DEFICITS` and pilot has open deficit | set progress `GATE_BLOCKED` | allow completion |

### 3.5 Immutability

| Rule | IF | THEN | ELSE |
|---|---|---|---|
| 48h lock | signedAt older than 48 hours | set lockedAt and reject normal edits | allow instructor edit |
| CFI/TRE override | locked record edit requested by CFI/TRE with reason | create amendment and audit entry | reject |
| Deletion | regulatory record deletion requested | soft delete only with reason and audit entry | n/a |

---

## 4. DB Schema

```sql
CREATE TABLE training_programme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN (
    'INITIAL','RECURRENT','UPGRADE','CONVERSION','OPC','LPC','EBT','UPRT','LIFUS','TRI_COURSE','TRE_COURSE'
  )),
  aircraft_type VARCHAR(32) NOT NULL,
  regulatory_framework VARCHAR(16) NOT NULL CHECK (regulatory_framework IN ('EASA','FAA','SACAA','ICAO','CAAC','DGCA')),
  regulatory_basis JSONB NOT NULL DEFAULT '[]'::jsonb,
  validity_months INTEGER,
  prerequisite_ratings JSONB NOT NULL DEFAULT '[]'::jsonb,
  authority_approval_ref VARCHAR(128) NOT NULL,
  approval_valid_from DATE NOT NULL,
  approval_valid_until DATE,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','RETIRED')),
  supersedes_programme_id UUID REFERENCES training_programme(id),
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_training_programme_code_version UNIQUE (tenant_id, code, version)
);
CREATE INDEX idx_training_programme_tenant_id ON training_programme (tenant_id, id);
CREATE INDEX idx_training_programme_lookup ON training_programme (tenant_id, aircraft_type, type, status);

CREATE TABLE programme_phase (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  programme_id UUID NOT NULL REFERENCES training_programme(id),
  sequence INTEGER NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  delivery_mode VARCHAR(16) NOT NULL CHECK (delivery_mode IN ('CBT','GROUND','FBS','FTD','FNPT','FFS','AIRCRAFT','LIFUS')),
  minimum_sessions INTEGER NOT NULL DEFAULT 0,
  planned_duration_minutes INTEGER NOT NULL DEFAULT 0,
  gate_strategy VARCHAR(32) NOT NULL DEFAULT 'ALL_CRITERIA' CHECK (gate_strategy IN ('ALL_CRITERIA','ANY_CRITERION','CFI_OVERRIDE_ALLOWED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_programme_phase_sequence UNIQUE (tenant_id, programme_id, sequence)
);
CREATE INDEX idx_programme_phase_tenant_id ON programme_phase (tenant_id, id);
CREATE INDEX idx_programme_phase_programme ON programme_phase (tenant_id, programme_id, sequence);

CREATE TABLE programme_module (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  sequence INTEGER NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  session_type VARCHAR(32) NOT NULL CHECK (session_type IN ('ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE')),
  minimum_duration_minutes INTEGER NOT NULL DEFAULT 0,
  competency_unit_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  learning_objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  mandatory BOOLEAN NOT NULL DEFAULT TRUE,
  minimum_overall_score INTEGER CHECK (minimum_overall_score BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_programme_module_sequence UNIQUE (tenant_id, phase_id, sequence)
);
CREATE INDEX idx_programme_module_tenant_id ON programme_module (tenant_id, id);
CREATE INDEX idx_programme_module_phase ON programme_module (tenant_id, phase_id, sequence);

CREATE TABLE programme_prerequisite (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  module_id UUID NOT NULL REFERENCES programme_module(id),
  prerequisite_module_id UUID REFERENCES programme_module(id),
  prerequisite_programme_id UUID REFERENCES training_programme(id),
  prerequisite_rating_code VARCHAR(64),
  type VARCHAR(16) NOT NULL CHECK (type IN ('HARD','SOFT','ADVISORY')),
  waiver_allowed_by_role VARCHAR(16) NOT NULL DEFAULT 'NONE' CHECK (waiver_allowed_by_role IN ('NONE','CFI','TRE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_prerequisite_one_source CHECK (
    ((prerequisite_module_id IS NOT NULL)::int +
     (prerequisite_programme_id IS NOT NULL)::int +
     (prerequisite_rating_code IS NOT NULL)::int) = 1
  ),
  CONSTRAINT chk_prerequisite_no_self_module CHECK (module_id <> prerequisite_module_id)
);
CREATE INDEX idx_programme_prerequisite_tenant_id ON programme_prerequisite (tenant_id, id);
CREATE INDEX idx_programme_prerequisite_module ON programme_prerequisite (tenant_id, module_id);

CREATE TABLE competency_target (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  programme_id UUID NOT NULL REFERENCES training_programme(id),
  phase_id UUID REFERENCES programme_phase(id),
  competency_unit_code VARCHAR(8) NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  minimum_score INTEGER NOT NULL DEFAULT 3 CHECK (minimum_score BETWEEN 1 AND 5),
  remedial_trigger_score INTEGER NOT NULL DEFAULT 2 CHECK (remedial_trigger_score BETWEEN 1 AND 5),
  required_assessment_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_competency_target UNIQUE (tenant_id, programme_id, phase_id, competency_unit_code)
);
CREATE INDEX idx_competency_target_tenant_id ON competency_target (tenant_id, id);
CREATE INDEX idx_competency_target_programme ON competency_target (tenant_id, programme_id);

CREATE TABLE gate_criterion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  type VARCHAR(32) NOT NULL CHECK (type IN (
    'ALL_MODULES_COMPLETE','MIN_CU_SCORE','MEDICAL_VALID','RECENCY_OK','LICENCE_VALID',
    'INSTRUCTOR_SIGN_OFF','EXAMINER_SIGN_OFF','LIFUS_SECTORS_MIN','NO_OPEN_DEFICITS'
  )),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocks_progression BOOLEAN NOT NULL DEFAULT TRUE,
  evidence_service VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_gate_criterion_tenant_id ON gate_criterion (tenant_id, id);
CREATE INDEX idx_gate_criterion_phase ON gate_criterion (tenant_id, phase_id);

CREATE TABLE programme_enrolment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  programme_id UUID NOT NULL REFERENCES training_programme(id),
  pilot_id UUID NOT NULL,
  enrolled_by UUID NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_completion_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status VARCHAR(24) NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED','IN_PROGRESS','GATE_BLOCKED','COMPLETED','WITHDRAWN','FAILED')),
  withdrawal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_programme_enrolment_tenant_id ON programme_enrolment (tenant_id, id);
CREATE INDEX idx_programme_enrolment_pilot ON programme_enrolment (tenant_id, pilot_id, status);
CREATE UNIQUE INDEX uq_programme_enrolment_active
  ON programme_enrolment (tenant_id, programme_id, pilot_id)
  WHERE deleted_at IS NULL AND status IN ('ENROLLED','IN_PROGRESS','GATE_BLOCKED');

CREATE TABLE programme_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  enrolment_id UUID NOT NULL REFERENCES programme_enrolment(id),
  phase_id UUID NOT NULL REFERENCES programme_phase(id),
  status VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','GATE_BLOCKED','COMPLETED','FAILED')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  gate_override_by UUID,
  gate_override_reason TEXT,
  gate_override_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_programme_progress UNIQUE (tenant_id, enrolment_id, phase_id)
);
CREATE INDEX idx_programme_progress_tenant_id ON programme_progress (tenant_id, id);
CREATE INDEX idx_programme_progress_enrolment ON programme_progress (tenant_id, enrolment_id);

CREATE TABLE training_session_record (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  enrolment_id UUID REFERENCES programme_enrolment(id),
  programme_module_id UUID REFERENCES programme_module(id),
  reservation_id UUID,
  pilot_id UUID NOT NULL,
  instructor_id UUID NOT NULL,
  instructor_qualification VARCHAR(128) NOT NULL,
  examiner_required BOOLEAN NOT NULL DEFAULT FALSE,
  examiner_id UUID,
  examiner_authorisation_ref VARCHAR(128),
  session_type VARCHAR(32) NOT NULL CHECK (session_type IN ('ITR','RECURRENT','OPC','LPC','LINE_CHECK','UPRT','EBT','FREE_PRACTICE')),
  scenario_id UUID,
  aircraft_type VARCHAR(32) NOT NULL,
  simulator_id UUID,
  simulator_qualification_level VARCHAR(16) CHECK (simulator_qualification_level IN ('FFS_A','FFS_B','FFS_C','FFS_D','FTD','FNPT','AIRCRAFT','N_A')),
  simulator_approval_ref VARCHAR(128),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('PASS','FURTHER_TRAINING_REQUIRED','FAIL','TRAINING_ONLY')),
  instructor_signature_hash VARCHAR(255),
  signed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  amendment_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_training_session_time CHECK (ended_at > started_at),
  CONSTRAINT chk_training_session_examiner CHECK (
    examiner_required = FALSE OR (examiner_id IS NOT NULL AND examiner_authorisation_ref IS NOT NULL)
  )
);
CREATE INDEX idx_training_session_record_tenant_id ON training_session_record (tenant_id, id);
CREATE INDEX idx_training_session_record_pilot ON training_session_record (tenant_id, pilot_id, assessed_at DESC);
CREATE INDEX idx_training_session_record_enrolment ON training_session_record (tenant_id, enrolment_id);

CREATE TABLE competency_assessment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(36) NOT NULL,
  session_record_id UUID NOT NULL REFERENCES training_session_record(id),
  competency_unit_code VARCHAR(8) NOT NULL CHECK (competency_unit_code IN ('AP','COM','FPA','FPM','LT','PSD','SA','WM')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  behavioural_markers JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  assessed_by UUID NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_competency_assessment UNIQUE (tenant_id, session_record_id, competency_unit_code)
);
CREATE INDEX idx_competency_assessment_tenant_id ON competency_assessment (tenant_id, id);
CREATE INDEX idx_competency_assessment_session ON competency_assessment (tenant_id, session_record_id);
```

**Audit trail:** every `INSERT`, `UPDATE`, soft delete, sign-off, lock override, and gate override must write an `audit_log` row with before/after JSON and the request ID.

---

## 5. OpenAPI 3.0 Spec

```yaml
openapi: 3.0.3
info:
  title: AeroCap Functional Training Management Center API
  version: 1.0.0
servers:
  - url: https://api.aerocap.aero/api/v1
security:
  - bearerAuth: []

paths:
  /training/programmes:
    get:
      summary: List training programmes
      parameters:
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/PageSize'
        - name: aircraftType
          in: query
          schema: { type: string }
        - name: type
          in: query
          schema: { $ref: '#/components/schemas/ProgrammeType' }
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/ProgrammeStatus' }
      responses:
        '200':
          description: Programme list
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/TrainingProgramme' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }
    post:
      summary: Create draft programme
      description: CFI or training admin only. tenantId is taken from JWT.
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateProgrammeRequest' }
      responses:
        '201':
          description: Programme created
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingProgramme' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/programmes/{programmeId}:
    get:
      summary: Get programme detail
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
      responses:
        '200':
          description: Programme detail
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingProgrammeDetail' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }
    patch:
      summary: Update draft programme metadata
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/UpdateProgrammeRequest' }
      responses:
        '200':
          description: Programme updated
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingProgramme' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/programmes/{programmeId}/approve:
    post:
      summary: Approve a complete programme revision
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [authorityApprovalRef, approvalValidFrom]
              properties:
                authorityApprovalRef: { type: string }
                approvalValidFrom: { type: string, format: date }
                approvalValidUntil: { type: string, format: date, nullable: true }
      responses:
        '200':
          description: Programme approved
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingProgramme' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/programmes/{programmeId}/phases:
    post:
      summary: Add phase to draft programme
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreatePhaseRequest' }
      responses:
        '201':
          description: Phase created
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/ProgrammePhase' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/phases/{phaseId}/modules:
    post:
      summary: Add module to phase
      parameters:
        - $ref: '#/components/parameters/PhaseId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateModuleRequest' }
      responses:
        '201':
          description: Module created
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/ProgrammeModule' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/programmes/{programmeId}/enrolments:
    get:
      summary: List programme enrolments
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/PageSize'
        - name: status
          in: query
          schema: { $ref: '#/components/schemas/EnrolmentStatus' }
      responses:
        '200':
          description: Enrolment list
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/ProgrammeEnrolment' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }
    post:
      summary: Enrol pilot into approved programme
      parameters:
        - $ref: '#/components/parameters/ProgrammeId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateEnrolmentRequest' }
      responses:
        '201':
          description: Enrolment created
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/ProgrammeEnrolment' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/enrolments/{enrolmentId}/progress:
    get:
      summary: Get enrolment progress and gate status
      parameters:
        - $ref: '#/components/parameters/EnrolmentId'
      responses:
        '200':
          description: Progress detail
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/ProgrammeProgress' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/sessions:
    get:
      summary: List training session records
      parameters:
        - $ref: '#/components/parameters/Page'
        - $ref: '#/components/parameters/PageSize'
        - name: pilotId
          in: query
          schema: { type: string, format: uuid }
        - name: sessionType
          in: query
          schema: { $ref: '#/components/schemas/SessionType' }
      responses:
        '200':
          description: Session list
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/TrainingSessionRecord' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '500': { $ref: '#/components/responses/InternalError' }
    post:
      summary: Create training session record
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CreateSessionRecordRequest' }
      responses:
        '201':
          description: Session created
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingSessionRecord' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/sessions/{sessionRecordId}/assessments:
    put:
      summary: Replace per-competency assessment set
      parameters:
        - $ref: '#/components/parameters/SessionRecordId'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/UpsertCompetencyAssessmentsRequest' }
      responses:
        '200':
          description: Assessments saved
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data:
                        type: array
                        items: { $ref: '#/components/schemas/CompetencyAssessment' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '410': { $ref: '#/components/responses/ImmutableRecord' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

  /training/sessions/{sessionRecordId}/sign:
    post:
      summary: Instructor/examiner sign-off
      parameters:
        - $ref: '#/components/parameters/SessionRecordId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [signatureHash]
              properties:
                signatureHash: { type: string, minLength: 32 }
      responses:
        '200':
          description: Session signed
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { $ref: '#/components/schemas/TrainingSessionRecord' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '422': { $ref: '#/components/responses/BusinessRuleViolation' }
        '500': { $ref: '#/components/responses/InternalError' }

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    Page:
      name: page
      in: query
      schema: { type: integer, minimum: 1, default: 1 }
    PageSize:
      name: pageSize
      in: query
      schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
    ProgrammeId:
      name: programmeId
      in: path
      required: true
      schema: { type: string, format: uuid }
    PhaseId:
      name: phaseId
      in: path
      required: true
      schema: { type: string, format: uuid }
    EnrolmentId:
      name: enrolmentId
      in: path
      required: true
      schema: { type: string, format: uuid }
    SessionRecordId:
      name: sessionRecordId
      in: path
      required: true
      schema: { type: string, format: uuid }

  responses:
    BadRequest:
      description: Validation error
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    Unauthenticated:
      description: Missing or invalid token
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    Forbidden:
      description: Insufficient permissions
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    NotFound:
      description: Resource not found
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    Conflict:
      description: Conflict
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    ImmutableRecord:
      description: Record is immutable
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    BusinessRuleViolation:
      description: Domain rule failed
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    InternalError:
      description: Unexpected error
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }

  schemas:
    Envelope:
      type: object
      required: [data, meta, error]
      properties:
        data: {}
        meta:
          type: object
          required: [requestId, timestamp]
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
    ErrorEnvelope:
      type: object
      required: [data, meta, error]
      properties:
        data: { nullable: true }
        meta:
          type: object
          required: [requestId, timestamp]
          properties:
            requestId: { type: string, format: uuid }
            timestamp: { type: string, format: date-time }
        error:
          type: object
          required: [code, message]
          properties:
            code: { type: string }
            message: { type: string }
            details: { type: object, additionalProperties: true }
    ProgrammeType:
      type: string
      enum: [INITIAL, RECURRENT, UPGRADE, CONVERSION, OPC, LPC, EBT, UPRT, LIFUS, TRI_COURSE, TRE_COURSE]
    ProgrammeStatus:
      type: string
      enum: [DRAFT, APPROVED, RETIRED]
    SessionType:
      type: string
      enum: [ITR, RECURRENT, OPC, LPC, LINE_CHECK, UPRT, EBT, FREE_PRACTICE]
    EnrolmentStatus:
      type: string
      enum: [ENROLLED, IN_PROGRESS, GATE_BLOCKED, COMPLETED, WITHDRAWN, FAILED]
    TrainingProgramme:
      type: object
      required: [id, tenantId, code, name, type, aircraftType, regulatoryFramework, regulatoryBasis, prerequisiteRatings, authorityApprovalRef, approvalValidFrom, version, status, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        code: { type: string }
        name: { type: string }
        type: { $ref: '#/components/schemas/ProgrammeType' }
        aircraftType: { type: string }
        regulatoryFramework: { type: string, enum: [EASA, FAA, SACAA, ICAO, CAAC, DGCA] }
        regulatoryBasis: { type: array, items: { type: string } }
        validityMonths: { type: integer, nullable: true }
        prerequisiteRatings: { type: array, items: { type: string } }
        authorityApprovalRef: { type: string }
        approvalValidFrom: { type: string, format: date }
        approvalValidUntil: { type: string, format: date, nullable: true }
        version: { type: integer }
        status: { $ref: '#/components/schemas/ProgrammeStatus' }
        supersedesProgrammeId: { type: string, format: uuid, nullable: true }
        approvedBy: { type: string, format: uuid, nullable: true }
        approvedAt: { type: string, format: date-time, nullable: true }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
        deletedAt: { type: string, format: date-time, nullable: true }
    TrainingProgrammeDetail:
      allOf:
        - $ref: '#/components/schemas/TrainingProgramme'
        - type: object
          properties:
            phases:
              type: array
              items: { $ref: '#/components/schemas/ProgrammePhase' }
            competencyTargets:
              type: array
              items: { $ref: '#/components/schemas/CompetencyTarget' }
    ProgrammePhase:
      type: object
      required: [id, tenantId, programmeId, sequence, code, name, deliveryMode, minimumSessions, plannedDurationMinutes, gateStrategy, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        programmeId: { type: string, format: uuid }
        sequence: { type: integer }
        code: { type: string }
        name: { type: string }
        deliveryMode: { type: string, enum: [CBT, GROUND, FBS, FTD, FNPT, FFS, AIRCRAFT, LIFUS] }
        minimumSessions: { type: integer }
        plannedDurationMinutes: { type: integer }
        gateStrategy: { type: string, enum: [ALL_CRITERIA, ANY_CRITERION, CFI_OVERRIDE_ALLOWED] }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
        deletedAt: { type: string, format: date-time, nullable: true }
    ProgrammeModule:
      type: object
      required: [id, tenantId, phaseId, sequence, code, name, sessionType, minimumDurationMinutes, competencyUnitCodes, learningObjectives, mandatory, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        phaseId: { type: string, format: uuid }
        sequence: { type: integer }
        code: { type: string }
        name: { type: string }
        sessionType: { $ref: '#/components/schemas/SessionType' }
        minimumDurationMinutes: { type: integer }
        competencyUnitCodes:
          type: array
          items: { type: string, enum: [AP, COM, FPA, FPM, LT, PSD, SA, WM] }
        learningObjectives: { type: array, items: { type: string } }
        mandatory: { type: boolean }
        minimumOverallScore: { type: integer, nullable: true }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
        deletedAt: { type: string, format: date-time, nullable: true }
    CompetencyTarget:
      type: object
      required: [id, tenantId, programmeId, competencyUnitCode, minimumScore, remedialTriggerScore, requiredAssessmentCount]
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        programmeId: { type: string, format: uuid }
        phaseId: { type: string, format: uuid, nullable: true }
        competencyUnitCode: { type: string, enum: [AP, COM, FPA, FPM, LT, PSD, SA, WM] }
        minimumScore: { type: integer, minimum: 1, maximum: 5 }
        remedialTriggerScore: { type: integer, minimum: 1, maximum: 5 }
        requiredAssessmentCount: { type: integer, minimum: 1 }
    ProgrammeEnrolment:
      type: object
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        programmeId: { type: string, format: uuid }
        pilotId: { type: string, format: uuid }
        enrolledBy: { type: string, format: uuid }
        enrolledAt: { type: string, format: date-time }
        expectedCompletionAt: { type: string, format: date-time, nullable: true }
        completedAt: { type: string, format: date-time, nullable: true }
        status: { $ref: '#/components/schemas/EnrolmentStatus' }
        withdrawalReason: { type: string, nullable: true }
    ProgrammeProgress:
      type: object
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        enrolmentId: { type: string, format: uuid }
        phaseId: { type: string, format: uuid }
        status: { type: string, enum: [NOT_STARTED, IN_PROGRESS, GATE_BLOCKED, COMPLETED, FAILED] }
        startedAt: { type: string, format: date-time, nullable: true }
        completedAt: { type: string, format: date-time, nullable: true }
        gateOverrideBy: { type: string, format: uuid, nullable: true }
        gateOverrideReason: { type: string, nullable: true }
        gateOverrideAt: { type: string, format: date-time, nullable: true }
    TrainingSessionRecord:
      type: object
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        enrolmentId: { type: string, format: uuid, nullable: true }
        programmeModuleId: { type: string, format: uuid, nullable: true }
        reservationId: { type: string, format: uuid, nullable: true }
        pilotId: { type: string, format: uuid }
        instructorId: { type: string, format: uuid }
        instructorQualification: { type: string }
        examinerRequired: { type: boolean }
        examinerId: { type: string, format: uuid, nullable: true }
        examinerAuthorisationRef: { type: string, nullable: true }
        sessionType: { $ref: '#/components/schemas/SessionType' }
        scenarioId: { type: string, format: uuid, nullable: true }
        aircraftType: { type: string }
        simulatorId: { type: string, format: uuid, nullable: true }
        simulatorQualificationLevel: { type: string, enum: [FFS_A, FFS_B, FFS_C, FFS_D, FTD, FNPT, AIRCRAFT, N_A], nullable: true }
        simulatorApprovalRef: { type: string, nullable: true }
        startedAt: { type: string, format: date-time }
        endedAt: { type: string, format: date-time }
        durationMinutes: { type: integer }
        assessedAt: { type: string, format: date-time }
        outcome: { type: string, enum: [PASS, FURTHER_TRAINING_REQUIRED, FAIL, TRAINING_ONLY] }
        instructorSignatureHash: { type: string, nullable: true }
        signedAt: { type: string, format: date-time, nullable: true }
        lockedAt: { type: string, format: date-time, nullable: true }
        amendmentReason: { type: string, nullable: true }
    CompetencyAssessment:
      type: object
      properties:
        id: { type: string, format: uuid }
        tenantId: { type: string }
        sessionRecordId: { type: string, format: uuid }
        competencyUnitCode: { type: string, enum: [AP, COM, FPA, FPM, LT, PSD, SA, WM] }
        score: { type: integer, minimum: 1, maximum: 5 }
        behaviouralMarkers:
          type: array
          items: { type: object, additionalProperties: true }
        notes: { type: string, nullable: true }
        assessedBy: { type: string, format: uuid }
        assessedAt: { type: string, format: date-time }
    CreateProgrammeRequest:
      type: object
      required: [code, name, type, aircraftType, regulatoryFramework, regulatoryBasis, prerequisiteRatings, authorityApprovalRef, approvalValidFrom]
      properties:
        code: { type: string }
        name: { type: string }
        type: { $ref: '#/components/schemas/ProgrammeType' }
        aircraftType: { type: string }
        regulatoryFramework: { type: string, enum: [EASA, FAA, SACAA, ICAO, CAAC, DGCA] }
        regulatoryBasis: { type: array, minItems: 1, items: { type: string } }
        validityMonths: { type: integer, nullable: true }
        prerequisiteRatings: { type: array, items: { type: string } }
        authorityApprovalRef: { type: string }
        approvalValidFrom: { type: string, format: date }
        approvalValidUntil: { type: string, format: date, nullable: true }
    UpdateProgrammeRequest:
      type: object
      properties:
        name: { type: string }
        regulatoryBasis: { type: array, minItems: 1, items: { type: string } }
        validityMonths: { type: integer, nullable: true }
        prerequisiteRatings: { type: array, items: { type: string } }
        authorityApprovalRef: { type: string }
        approvalValidFrom: { type: string, format: date }
        approvalValidUntil: { type: string, format: date, nullable: true }
    CreatePhaseRequest:
      type: object
      required: [sequence, code, name, deliveryMode, minimumSessions, plannedDurationMinutes, gateStrategy]
      properties:
        sequence: { type: integer }
        code: { type: string }
        name: { type: string }
        deliveryMode: { type: string, enum: [CBT, GROUND, FBS, FTD, FNPT, FFS, AIRCRAFT, LIFUS] }
        minimumSessions: { type: integer }
        plannedDurationMinutes: { type: integer }
        gateStrategy: { type: string, enum: [ALL_CRITERIA, ANY_CRITERION, CFI_OVERRIDE_ALLOWED] }
    CreateModuleRequest:
      type: object
      required: [sequence, code, name, sessionType, minimumDurationMinutes, competencyUnitCodes, learningObjectives, mandatory]
      properties:
        sequence: { type: integer }
        code: { type: string }
        name: { type: string }
        sessionType: { $ref: '#/components/schemas/SessionType' }
        minimumDurationMinutes: { type: integer }
        competencyUnitCodes: { type: array, items: { type: string, enum: [AP, COM, FPA, FPM, LT, PSD, SA, WM] } }
        learningObjectives: { type: array, items: { type: string } }
        mandatory: { type: boolean }
        minimumOverallScore: { type: integer, minimum: 1, maximum: 5, nullable: true }
    CreateEnrolmentRequest:
      type: object
      required: [pilotId]
      properties:
        pilotId: { type: string, format: uuid }
        expectedCompletionAt: { type: string, format: date-time, nullable: true }
    CreateSessionRecordRequest:
      type: object
      required: [pilotId, instructorId, instructorQualification, sessionType, aircraftType, startedAt, endedAt, assessedAt, outcome]
      properties:
        enrolmentId: { type: string, format: uuid, nullable: true }
        programmeModuleId: { type: string, format: uuid, nullable: true }
        reservationId: { type: string, format: uuid, nullable: true }
        pilotId: { type: string, format: uuid }
        instructorId: { type: string, format: uuid }
        instructorQualification: { type: string }
        examinerRequired: { type: boolean, default: false }
        examinerId: { type: string, format: uuid, nullable: true }
        examinerAuthorisationRef: { type: string, nullable: true }
        sessionType: { $ref: '#/components/schemas/SessionType' }
        scenarioId: { type: string, format: uuid, nullable: true }
        aircraftType: { type: string }
        simulatorId: { type: string, format: uuid, nullable: true }
        simulatorQualificationLevel: { type: string, enum: [FFS_A, FFS_B, FFS_C, FFS_D, FTD, FNPT, AIRCRAFT, N_A], nullable: true }
        simulatorApprovalRef: { type: string, nullable: true }
        startedAt: { type: string, format: date-time }
        endedAt: { type: string, format: date-time }
        assessedAt: { type: string, format: date-time }
        outcome: { type: string, enum: [PASS, FURTHER_TRAINING_REQUIRED, FAIL, TRAINING_ONLY] }
    UpsertCompetencyAssessmentsRequest:
      type: object
      required: [assessments]
      properties:
        assessments:
          type: array
          minItems: 1
          items:
            type: object
            required: [competencyUnitCode, score, behaviouralMarkers]
            properties:
              competencyUnitCode: { type: string, enum: [AP, COM, FPA, FPM, LT, PSD, SA, WM] }
              score: { type: integer, minimum: 1, maximum: 5 }
              behaviouralMarkers:
                type: array
                items: { type: object, additionalProperties: true }
              notes: { type: string, nullable: true }
```

---

## 6. TypeScript Interfaces

```typescript
export type ProgrammeType =
  | 'INITIAL' | 'RECURRENT' | 'UPGRADE' | 'CONVERSION'
  | 'OPC' | 'LPC' | 'EBT' | 'UPRT' | 'LIFUS' | 'TRI_COURSE' | 'TRE_COURSE';

export type RegulatoryFramework = 'EASA' | 'FAA' | 'SACAA' | 'ICAO' | 'CAAC' | 'DGCA';
export type ProgrammeStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';
export type DeliveryMode = 'CBT' | 'GROUND' | 'FBS' | 'FTD' | 'FNPT' | 'FFS' | 'AIRCRAFT' | 'LIFUS';
export type GateStrategy = 'ALL_CRITERIA' | 'ANY_CRITERION' | 'CFI_OVERRIDE_ALLOWED';
export type SessionType = 'ITR' | 'RECURRENT' | 'OPC' | 'LPC' | 'LINE_CHECK' | 'UPRT' | 'EBT' | 'FREE_PRACTICE';
export type CompetencyUnitCode = 'AP' | 'COM' | 'FPA' | 'FPM' | 'LT' | 'PSD' | 'SA' | 'WM';
export type EnrolmentStatus = 'ENROLLED' | 'IN_PROGRESS' | 'GATE_BLOCKED' | 'COMPLETED' | 'WITHDRAWN' | 'FAILED';
export type ProgressStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'GATE_BLOCKED' | 'COMPLETED' | 'FAILED';
export type SimulatorQualificationLevel = 'FFS_A' | 'FFS_B' | 'FFS_C' | 'FFS_D' | 'FTD' | 'FNPT' | 'AIRCRAFT' | 'N_A';
export type TrainingOutcome = 'PASS' | 'FURTHER_TRAINING_REQUIRED' | 'FAIL' | 'TRAINING_ONLY';

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  pagination?: { page: number; pageSize: number; total: number };
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
  error: null | { code: string; message: string; details?: Record<string, unknown> };
}

export interface TrainingProgramme {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: ProgrammeType;
  aircraftType: string;
  regulatoryFramework: RegulatoryFramework;
  regulatoryBasis: string[];
  validityMonths: number | null;
  prerequisiteRatings: string[];
  authorityApprovalRef: string;
  approvalValidFrom: string;
  approvalValidUntil: string | null;
  version: number;
  status: ProgrammeStatus;
  supersedesProgrammeId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TrainingProgrammeDetail extends TrainingProgramme {
  phases: ProgrammePhase[];
  competencyTargets: CompetencyTarget[];
}

export interface ProgrammePhase {
  id: string;
  tenantId: string;
  programmeId: string;
  sequence: number;
  code: string;
  name: string;
  deliveryMode: DeliveryMode;
  minimumSessions: number;
  plannedDurationMinutes: number;
  gateStrategy: GateStrategy;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProgrammeModule {
  id: string;
  tenantId: string;
  phaseId: string;
  sequence: number;
  code: string;
  name: string;
  sessionType: SessionType;
  minimumDurationMinutes: number;
  competencyUnitCodes: CompetencyUnitCode[];
  learningObjectives: string[];
  mandatory: boolean;
  minimumOverallScore: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CompetencyTarget {
  id: string;
  tenantId: string;
  programmeId: string;
  phaseId: string | null;
  competencyUnitCode: CompetencyUnitCode;
  minimumScore: number;
  remedialTriggerScore: number;
  requiredAssessmentCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface GateCriterion {
  id: string;
  tenantId: string;
  phaseId: string;
  type:
    | 'ALL_MODULES_COMPLETE' | 'MIN_CU_SCORE' | 'MEDICAL_VALID' | 'RECENCY_OK'
    | 'LICENCE_VALID' | 'INSTRUCTOR_SIGN_OFF' | 'EXAMINER_SIGN_OFF'
    | 'LIFUS_SECTORS_MIN' | 'NO_OPEN_DEFICITS';
  parameters: Record<string, unknown>;
  blocksProgression: boolean;
  evidenceService: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProgrammeEnrolment {
  id: string;
  tenantId: string;
  programmeId: string;
  pilotId: string;
  enrolledBy: string;
  enrolledAt: string;
  expectedCompletionAt: string | null;
  completedAt: string | null;
  status: EnrolmentStatus;
  withdrawalReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProgrammeProgress {
  id: string;
  tenantId: string;
  enrolmentId: string;
  phaseId: string;
  status: ProgressStatus;
  startedAt: string | null;
  completedAt: string | null;
  gateOverrideBy: string | null;
  gateOverrideReason: string | null;
  gateOverrideAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TrainingSessionRecord {
  id: string;
  tenantId: string;
  enrolmentId: string | null;
  programmeModuleId: string | null;
  reservationId: string | null;
  pilotId: string;
  instructorId: string;
  instructorQualification: string;
  examinerRequired: boolean;
  examinerId: string | null;
  examinerAuthorisationRef: string | null;
  sessionType: SessionType;
  scenarioId: string | null;
  aircraftType: string;
  simulatorId: string | null;
  simulatorQualificationLevel: SimulatorQualificationLevel | null;
  simulatorApprovalRef: string | null;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  assessedAt: string;
  outcome: TrainingOutcome;
  instructorSignatureHash: string | null;
  signedAt: string | null;
  lockedAt: string | null;
  amendmentReason: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CompetencyAssessment {
  id: string;
  tenantId: string;
  sessionRecordId: string;
  competencyUnitCode: CompetencyUnitCode;
  score: number;
  behaviouralMarkers: Array<Record<string, unknown>>;
  notes: string | null;
  assessedBy: string;
  assessedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

---

## 7. Zod Schemas

```typescript
import { z } from 'zod';

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoDateTime = z.string().datetime();

export const ProgrammeTypeSchema = z.enum([
  'INITIAL', 'RECURRENT', 'UPGRADE', 'CONVERSION', 'OPC', 'LPC',
  'EBT', 'UPRT', 'LIFUS', 'TRI_COURSE', 'TRE_COURSE',
]);

export const RegulatoryFrameworkSchema = z.enum(['EASA', 'FAA', 'SACAA', 'ICAO', 'CAAC', 'DGCA']);
export const ProgrammeStatusSchema = z.enum(['DRAFT', 'APPROVED', 'RETIRED']);
export const DeliveryModeSchema = z.enum(['CBT', 'GROUND', 'FBS', 'FTD', 'FNPT', 'FFS', 'AIRCRAFT', 'LIFUS']);
export const GateStrategySchema = z.enum(['ALL_CRITERIA', 'ANY_CRITERION', 'CFI_OVERRIDE_ALLOWED']);
export const SessionTypeSchema = z.enum(['ITR', 'RECURRENT', 'OPC', 'LPC', 'LINE_CHECK', 'UPRT', 'EBT', 'FREE_PRACTICE']);
export const CompetencyUnitCodeSchema = z.enum(['AP', 'COM', 'FPA', 'FPM', 'LT', 'PSD', 'SA', 'WM']);
export const SimulatorQualificationLevelSchema = z.enum(['FFS_A', 'FFS_B', 'FFS_C', 'FFS_D', 'FTD', 'FNPT', 'AIRCRAFT', 'N_A']);
export const TrainingOutcomeSchema = z.enum(['PASS', 'FURTHER_TRAINING_REQUIRED', 'FAIL', 'TRAINING_ONLY']);

export const CreateProgrammeSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(2).max(255),
  type: ProgrammeTypeSchema,
  aircraftType: z.string().min(2).max(32),
  regulatoryFramework: RegulatoryFrameworkSchema,
  regulatoryBasis: z.array(z.string().min(1)).min(1),
  validityMonths: z.number().int().positive().nullable().optional(),
  prerequisiteRatings: z.array(z.string().min(1)).default([]),
  authorityApprovalRef: z.string().min(1).max(128),
  approvalValidFrom: isoDate,
  approvalValidUntil: isoDate.nullable().optional(),
}).strict();

export const UpdateProgrammeSchema = CreateProgrammeSchema.partial().strict();

export const ApproveProgrammeSchema = z.object({
  authorityApprovalRef: z.string().min(1).max(128),
  approvalValidFrom: isoDate,
  approvalValidUntil: isoDate.nullable().optional(),
}).strict();

export const CreatePhaseSchema = z.object({
  sequence: z.number().int().positive(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  deliveryMode: DeliveryModeSchema,
  minimumSessions: z.number().int().min(0),
  plannedDurationMinutes: z.number().int().min(0),
  gateStrategy: GateStrategySchema.default('ALL_CRITERIA'),
}).strict();

export const CreateModuleSchema = z.object({
  sequence: z.number().int().positive(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  sessionType: SessionTypeSchema,
  minimumDurationMinutes: z.number().int().min(0),
  competencyUnitCodes: z.array(CompetencyUnitCodeSchema).min(1),
  learningObjectives: z.array(z.string().min(1)).default([]),
  mandatory: z.boolean().default(true),
  minimumOverallScore: z.number().int().min(1).max(5).nullable().optional(),
}).strict();

export const CreateCompetencyTargetSchema = z.object({
  programmeId: uuid,
  phaseId: uuid.nullable().optional(),
  competencyUnitCode: CompetencyUnitCodeSchema,
  minimumScore: z.number().int().min(1).max(5).default(3),
  remedialTriggerScore: z.number().int().min(1).max(5).default(2),
  requiredAssessmentCount: z.number().int().positive().default(1),
}).strict();

export const CreateGateCriterionSchema = z.object({
  phaseId: uuid,
  type: z.enum([
    'ALL_MODULES_COMPLETE', 'MIN_CU_SCORE', 'MEDICAL_VALID', 'RECENCY_OK',
    'LICENCE_VALID', 'INSTRUCTOR_SIGN_OFF', 'EXAMINER_SIGN_OFF',
    'LIFUS_SECTORS_MIN', 'NO_OPEN_DEFICITS',
  ]),
  parameters: z.record(z.unknown()).default({}),
  blocksProgression: z.boolean().default(true),
  evidenceService: z.string().max(64).nullable().optional(),
}).strict();

export const CreateEnrolmentSchema = z.object({
  pilotId: uuid,
  expectedCompletionAt: isoDateTime.nullable().optional(),
}).strict();

export const CreateSessionRecordSchema = z.object({
  enrolmentId: uuid.nullable().optional(),
  programmeModuleId: uuid.nullable().optional(),
  reservationId: uuid.nullable().optional(),
  pilotId: uuid,
  instructorId: uuid,
  instructorQualification: z.string().min(1).max(128),
  examinerRequired: z.boolean().default(false),
  examinerId: uuid.nullable().optional(),
  examinerAuthorisationRef: z.string().max(128).nullable().optional(),
  sessionType: SessionTypeSchema,
  scenarioId: uuid.nullable().optional(),
  aircraftType: z.string().min(2).max(32),
  simulatorId: uuid.nullable().optional(),
  simulatorQualificationLevel: SimulatorQualificationLevelSchema.nullable().optional(),
  simulatorApprovalRef: z.string().max(128).nullable().optional(),
  startedAt: isoDateTime,
  endedAt: isoDateTime,
  assessedAt: isoDateTime,
  outcome: TrainingOutcomeSchema,
}).strict().superRefine((data, ctx) => {
  if (Date.parse(data.endedAt) <= Date.parse(data.startedAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endedAt'], message: 'endedAt must be after startedAt' });
  }
  if (data.examinerRequired && (!data.examinerId || !data.examinerAuthorisationRef)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['examinerId'], message: 'examinerId and examinerAuthorisationRef are required' });
  }
});

export const CompetencyAssessmentInputSchema = z.object({
  competencyUnitCode: CompetencyUnitCodeSchema,
  score: z.number().int().min(1).max(5),
  behaviouralMarkers: z.array(z.record(z.unknown())).default([]),
  notes: z.string().max(4000).nullable().optional(),
}).strict();

export const UpsertCompetencyAssessmentsSchema = z.object({
  assessments: z.array(CompetencyAssessmentInputSchema).min(1),
}).strict();

export const SignSessionSchema = z.object({
  signatureHash: z.string().min(32).max(255),
}).strict();

export type CreateProgrammeInput = z.infer<typeof CreateProgrammeSchema>;
export type UpdateProgrammeInput = z.infer<typeof UpdateProgrammeSchema>;
export type ApproveProgrammeInput = z.infer<typeof ApproveProgrammeSchema>;
export type CreatePhaseInput = z.infer<typeof CreatePhaseSchema>;
export type CreateModuleInput = z.infer<typeof CreateModuleSchema>;
export type CreateCompetencyTargetInput = z.infer<typeof CreateCompetencyTargetSchema>;
export type CreateGateCriterionInput = z.infer<typeof CreateGateCriterionSchema>;
export type CreateEnrolmentInput = z.infer<typeof CreateEnrolmentSchema>;
export type CreateSessionRecordInput = z.infer<typeof CreateSessionRecordSchema>;
export type UpsertCompetencyAssessmentsInput = z.infer<typeof UpsertCompetencyAssessmentsSchema>;
export type SignSessionInput = z.infer<typeof SignSessionSchema>;
```

---

## 8. EventBridge Events

All events use source `aerocap.training-management`, bus `aerocap-{env}-training-bus`, and envelope:

```typescript
interface TrainingEventEnvelope<T> {
  tenantId: string;
  traceId: string;
  occurredAt: string;
  schemaVersion: '1.0';
  payload: T;
}
```

| Event name | Emitted when | Payload |
|---|---|---|
| `training.programme.created` | Draft programme is created | `{ programmeId, code, version, createdBy }` |
| `training.programme.approved` | Programme revision is approved | `{ programmeId, code, version, approvedBy, authorityApprovalRef }` |
| `training.programme.retired` | Programme is retired | `{ programmeId, code, version, retiredBy, reason }` |
| `training.enrolment.created` | Pilot is enrolled | `{ enrolmentId, programmeId, pilotId, enrolledBy }` |
| `training.enrolment.gate_blocked` | Progression gate fails | `{ enrolmentId, phaseId, failedCriteria: string[] }` |
| `training.enrolment.completed` | Programme completes | `{ enrolmentId, programmeId, pilotId, completedAt }` |
| `training.session.recorded` | Session record is created | `{ sessionRecordId, pilotId, sessionType, instructorId, assessedAt }` |
| `training.session.signed` | Session is signed | `{ sessionRecordId, signedBy, signedAt, outcome }` |
| `training.session.amended` | Locked/signed session is amended | `{ sessionRecordId, amendedBy, reason }` |
| `training.competency.assessed` | Assessment set saved | `{ sessionRecordId, pilotId, scores: Record<CompetencyUnitCode, number> }` |
| `training.deficit.triggered` | Any score <= remedial trigger | `{ sessionRecordId, pilotId, competencyUnitCode, score, dueAt }` |
| `training.deficit.escalation_due` | Open deficit reaches escalation threshold | `{ pilotId, deficitId, competencyUnitCode, openedAt, cfiUserIds }` |
| `training.regulatory.evidence_ready` | Session/enrolment is ready for reports | `{ entityType, entityId, pilotId, regulatoryFramework }` |

Payload examples:

```json
{
  "tenantId": "tenant-demo",
  "traceId": "0f9f96be-998c-4cd1-9e62-640a2f95397b",
  "occurredAt": "2026-05-30T12:00:00Z",
  "schemaVersion": "1.0",
  "payload": {
    "sessionRecordId": "c0d9a669-bff3-4199-a7cc-9f756af98189",
    "pilotId": "6a267ff0-38c2-4359-b6f6-0324d4ffb12d",
    "competencyUnitCode": "FPM",
    "score": 2,
    "dueAt": "2026-06-29T12:00:00Z"
  }
}
```

---

## 9. Access Control

| Role | Read | Write |
|---|---|---|
| PILOT | Own programmes, own session records, own scores, own deficits | None |
| INSTRUCTOR/TRI | Assigned pilots and sessions they conduct | Draft session records, assessments, sign within 48h |
| TRE | OPC/LPC/ITR outcomes in tenant | Examiner sign-off, documented locked-record override |
| CFI | All training records in tenant | Programme approval, gate override, deficit escalation, locked-record amendment |
| COUNTRY_ADMIN | Configuration and user management | No training assessment writes |
| GLOBAL_ADMIN | Cross-tenant operational admin | No training assessment writes unless separately granted CFI/TRE |
| OPS/SAFETY | Aggregated compliance and due lists | None |

---

## 10. Inspector View Requirements

For each pilot, the reporting UI/API must be able to show:

- Current medical, type rating, IR, ELP, OPC/LPC status and expiry dates.
- Recent experience evidence for the current aircraft type.
- Programme enrolments, phase progress, gate status, and CFI/TRE overrides.
- All 8 CBTA competency units assessed in the current training cycle.
- Any score `1` or `2`, linked remedial action, reassessment due date, and escalation history.
- Instructor/examiner qualifications active on the date of each session.
- Simulator qualification level and approval reference active on the session date.
- Signed training record hash and amendment audit trail.

---

## 11. Open Questions

- `[OPEN: needs CFI input]` Should `FREE_PRACTICE` ever satisfy programme module progress if an instructor later validates it, or should it remain training-record-only?
- `[OPEN: verify with authority]` For full EBT-approved tenants, which OPC elements are replaced by EBT manoeuvre phase evidence and which annual LPC evidence remains mandatory?
- `[OPEN: needs product input]` Should same-day simulator booking be a hard block or high-severity warning by tenant policy?
- `[OPEN: verify with authority]` Confirm SACAA-specific retention and revalidation evidence requirements for AfraSky beyond ICAO-compatible defaults.
- `[OPEN: needs security input]` Choose the production digital signature mechanism: hash of signed payload, WebAuthn-backed signature, or external e-signature provider.

---

## 12. One-Page Summary

| Area | Count |
|---|---:|
| Primary entities | 11 |
| Database tables | 9 new domain tables plus shared `audit_log` writes |
| API endpoint groups | 8 |
| Explicit endpoints | 12 |
| EventBridge events | 13 |
| Required standard error responses | 400, 401, 403, 404, 409, 410, 422, 500 |

This specification defines the Functional Training Management Center as an inspector-first training record system. The key implementation risks are correct role separation, immutable signed records, jurisdiction-aware rule variants, and reliable integration with instructor records, HRIS licence data, booking simulator data, scenario-library approvals, deficit tracking, and regulatory reports.
