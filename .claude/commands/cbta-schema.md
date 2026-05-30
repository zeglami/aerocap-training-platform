# CBTA Schema Generator

Generate CBTA (Competency-Based Training & Assessment) evaluation schemas, TypeScript types, and DB migrations aligned with EASA/ICAO regulatory standards.

## Usage
```
/cbta-schema <competency-unit> [description]
```
Example: `/cbta-schema "upset-prevention" "UPRT competency unit for A320 type rating"`

## What to produce

### 1. Regulatory Mapping
Output the standard CBTA competency framework mapping:
- Competency Unit name and code
- Competency Elements (sub-skills)
- Performance Criteria per element
- Behavioral Indicators (observable evidence)
- Assessment grades: `NOT_OBSERVED | BELOW_STANDARD | AT_STANDARD | ABOVE_STANDARD`

### 2. TypeScript Types (`src/types/cbta.ts`)
```typescript
// Generate interfaces for:
// - CompetencyUnit
// - CompetencyElement
// - PerformanceIndicator
// - Assessment (links pilot + simulator session + unit)
// - AssessmentResult (per element, with grade + examiner notes)
// - CBTAProgress (aggregated pilot progress across all units)

// Every type must include:
// - id: string (UUID)
// - tenantId: string
// - createdAt: Date
// - updatedAt: Date
// - deletedAt?: Date  (soft delete)
```

### 3. Zod Validation Schemas (`src/schemas/cbta.schema.ts`)
- Schema for creating/updating an assessment
- Schema for submitting element results
- Schema for bulk import (HRIS sync)
- Export inferred TypeScript types from each schema

### 4. DB Migration (`migrations/cbta_init.sql`)
Tables to generate:
- `competency_units` — master data (shared across tenants)
- `competency_elements` — linked to unit
- `assessments` — per pilot per session per unit (tenant-scoped)
- `assessment_results` — per element, grade, notes (tenant-scoped)
- `cbta_progress` — materialized view or aggregation table per pilot

All tenant-scoped tables: `tenant_id VARCHAR(36) NOT NULL`.
Include composite indexes on `(tenant_id, pilot_id)`, `(tenant_id, session_id)`.
Include GDPR soft-delete: `deleted_at TIMESTAMP`.

### 5. Repository (`src/repositories/cbta.repository.ts`)
Methods:
- `getAssessmentsByPilot(tenantId, pilotId, options)` — paginated
- `createAssessment(tenantId, data)` — returns created record
- `submitResults(tenantId, assessmentId, results)` — upsert per element
- `getPilotProgress(tenantId, pilotId)` — aggregated across all units
- `generateRegulatoryReport(tenantId, pilotId, dateRange)` — for compliance export

All queries MUST filter by `tenant_id`.

### 6. Regulatory Report Template
Generate a JSON structure for the regulatory compliance report that maps to EASA FCL.735 requirements. Include fields for: pilot licence number, assessment date, examiner ID, competency unit results, overall determination (PASS/FAIL/INCOMPLETE).

## Rules
- Never expose pilot data across tenants.
- Assessment results are immutable once `finalised = true` (append-only after sign-off).
- All grade changes must create an audit log entry.
- GDPR right to erasure: implement pseudonymisation, not hard delete, for regulatory data.
