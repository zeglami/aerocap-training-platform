# Partner B2B Specification

**Domain:** partner  
**Service:** partner-service (port 3010)  
**Status:** Accepted  
**Date:** 2026-05-30  
**Author:** spec-generator

---

## Overview

AeroCap currently supports B2C self-registration (individual pilots sign up and are approved by an AeroCap manager). This spec adds B2B support: airline operators, military units, training academies, and corporate flight departments — collectively called **Partners** — manage their own pilot rosters inside AeroCap.

A Partner admin (`PARTNER_ADMIN`) can:
- View and manage their organisation's pilot roster
- Authorize and revoke simulator booking access for their pilots
- View their org's training compliance statistics

AeroCap managers and admins retain full control: they create Partner accounts, assign Partner admins, and can override any partner action.

---

## 1. Entity Model

### Partner

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK, gen_random_uuid() |
| tenant_id | TEXT | yes | FK → tenants, NOT NULL |
| name | TEXT | yes | min 2, max 255 |
| icao_code | TEXT | no | 2–8 chars, uppercase, unique per tenant |
| type | TEXT | yes | AIRLINE \| MILITARY \| TRAINING_ACADEMY \| CORPORATE \| CHARTER |
| contact_name | TEXT | yes | max 255 |
| contact_email | TEXT | yes | valid email |
| contract_ref | TEXT | no | max 100 |
| contract_start | TEXT | yes | ISO date |
| contract_end | TEXT | no | ISO date, nullable = open-ended |
| max_pilots | INTEGER | no | null = unlimited |
| status | TEXT | yes | ACTIVE \| SUSPENDED \| EXPIRED, default ACTIVE |
| notes | TEXT | no | max 4000 |
| created_by | TEXT | yes | FK → users |
| created_at | TEXT | yes | DEFAULT NOW |
| updated_at | TEXT | yes | DEFAULT NOW |
| deleted_at | TEXT | no | soft delete |

### PartnerMember

Links a user (pilot or admin) to a partner. A user can belong to at most one partner per tenant.

| Field | Type | Required | Constraints |
|---|---|---|---|
| id | UUID | yes | PK |
| tenant_id | TEXT | yes | NOT NULL |
| partner_id | TEXT | yes | FK → partners |
| user_id | TEXT | yes | FK → users |
| member_role | TEXT | yes | PILOT \| PARTNER_ADMIN \| PARTNER_COORDINATOR |
| booking_authorized | INTEGER | yes | 0/1, default 0 |
| authorized_by | TEXT | no | FK → users |
| authorized_at | TEXT | no | ISO timestamp |
| joined_at | TEXT | yes | DEFAULT NOW |
| status | TEXT | yes | ACTIVE \| SUSPENDED \| REMOVED, default ACTIVE |
| notes | TEXT | no | max 1000 |

---

## 2. Database Schema (SQLite / Aurora PostgreSQL)

```sql
-- partner-service SQLite schema

CREATE TABLE IF NOT EXISTS partners (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  name           TEXT NOT NULL,
  icao_code      TEXT,
  type           TEXT NOT NULL DEFAULT 'AIRLINE'
                   CHECK(type IN ('AIRLINE','MILITARY','TRAINING_ACADEMY','CORPORATE','CHARTER')),
  contact_name   TEXT NOT NULL,
  contact_email  TEXT NOT NULL,
  contract_ref   TEXT,
  contract_start TEXT NOT NULL,
  contract_end   TEXT,
  max_pilots     INTEGER,
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                   CHECK(status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  notes          TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  deleted_at     TEXT,
  UNIQUE(tenant_id, icao_code)
);

CREATE INDEX IF NOT EXISTS idx_partners_tenant ON partners (tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS partner_members (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  partner_id          TEXT NOT NULL REFERENCES partners(id),
  user_id             TEXT NOT NULL,
  member_role         TEXT NOT NULL DEFAULT 'PILOT'
                        CHECK(member_role IN ('PILOT','PARTNER_ADMIN','PARTNER_COORDINATOR')),
  booking_authorized  INTEGER NOT NULL DEFAULT 0,
  authorized_by       TEXT,
  authorized_at       TEXT,
  joined_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK(status IN ('ACTIVE','SUSPENDED','REMOVED')),
  notes               TEXT,
  UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members (partner_id, status)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_partner_members_user ON partner_members (tenant_id, user_id);
```

---

## 3. OpenAPI 3.0 Spec (key endpoints)

```yaml
openapi: "3.0.3"
info:
  title: AeroCap Partner Service
  version: "1.0.0"
paths:

  /api/v1/partners:
    get:
      summary: List partners (MANAGER+ or PARTNER_ADMIN sees own)
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: limit, in: query, schema: { type: integer, default: 20 } }
        - { name: status, in: query, schema: { type: string } }
      responses:
        "200": { description: Paginated partner list }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }
    post:
      summary: Create partner (MANAGER+)
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreatePartnerInput" }
      responses:
        "201": { description: Partner created }
        "400": { description: Validation error }
        "401": { description: Unauthorized }
        "403": { description: Forbidden }

  /api/v1/partners/me:
    get:
      summary: Get the partner the caller administers (PARTNER_ADMIN)
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Partner record }
        "404": { description: Not a PARTNER_ADMIN or no partner assigned }

  /api/v1/partners/{id}:
    get:
      summary: Get single partner
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200": { description: Partner record }
        "404": { description: Not found }
    patch:
      summary: Update partner (COUNTRY_ADMIN+)
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/UpdatePartnerInput" }
      responses:
        "200": { description: Updated }
    delete:
      summary: Soft delete partner (GLOBAL_ADMIN)
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "204": { description: Deleted }

  /api/v1/partners/{id}/members:
    get:
      summary: List partner members
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: page, in: query, schema: { type: integer, default: 1 } }
        - { name: limit, in: query, schema: { type: integer, default: 20 } }
      responses:
        "200": { description: Member list }
    post:
      summary: Add pilot to partner
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/AddMemberInput" }
      responses:
        "201": { description: Member added }
        "409": { description: Pilot already in a partner }

  /api/v1/partners/{id}/members/{memberId}:
    delete:
      summary: Remove member from partner
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: memberId, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "204": { description: Removed }

  /api/v1/partners/{id}/members/{memberId}/authorize:
    post:
      summary: Authorize booking for member
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: memberId, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200": { description: Authorized }
    delete:
      summary: Revoke booking authorization for member
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: memberId, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200": { description: Revoked }

  /api/v1/partners/{id}/stats:
    get:
      summary: Partner compliance statistics
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        "200": { description: Stats }

components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
  schemas:
    CreatePartnerInput:
      type: object
      required: [name, type, contactName, contactEmail, contractStart]
      properties:
        name: { type: string, minLength: 2, maxLength: 255 }
        icaoCode: { type: string, minLength: 2, maxLength: 8 }
        type: { type: string, enum: [AIRLINE, MILITARY, TRAINING_ACADEMY, CORPORATE, CHARTER] }
        contactName: { type: string, maxLength: 255 }
        contactEmail: { type: string, format: email }
        contractRef: { type: string, maxLength: 100 }
        contractStart: { type: string, format: date }
        contractEnd: { type: string, format: date }
        maxPilots: { type: integer, nullable: true }
        notes: { type: string, maxLength: 4000 }
    UpdatePartnerInput:
      type: object
      properties:
        name: { type: string }
        contactName: { type: string }
        contactEmail: { type: string, format: email }
        status: { type: string, enum: [ACTIVE, SUSPENDED, EXPIRED] }
        contractEnd: { type: string, format: date }
        maxPilots: { type: integer, nullable: true }
        notes: { type: string }
    AddMemberInput:
      type: object
      required: [userId]
      properties:
        userId: { type: string, format: uuid }
        memberRole: { type: string, enum: [PILOT, PARTNER_ADMIN, PARTNER_COORDINATOR], default: PILOT }
        notes: { type: string, maxLength: 1000 }
```

---

## 4. TypeScript Interfaces

```typescript
export type PartnerType = 'AIRLINE' | 'MILITARY' | 'TRAINING_ACADEMY' | 'CORPORATE' | 'CHARTER';
export type PartnerStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
export type MemberRole = 'PILOT' | 'PARTNER_ADMIN' | 'PARTNER_COORDINATOR';
export type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface Partner {
  id: string;
  tenantId: string;
  name: string;
  icaoCode: string | null;
  type: PartnerType;
  contactName: string;
  contactEmail: string;
  contractRef: string | null;
  contractStart: string;
  contractEnd: string | null;
  maxPilots: number | null;
  status: PartnerStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerMember {
  id: string;
  tenantId: string;
  partnerId: string;
  userId: string;
  memberRole: MemberRole;
  bookingAuthorized: boolean;
  authorizedBy: string | null;
  authorizedAt: string | null;
  joinedAt: string;
  status: MemberStatus;
  notes: string | null;
  // Joined from user-service (read-only denormalised)
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface PartnerStats {
  partnerId: string;
  totalMembers: number;
  authorizedMembers: number;
  pendingMembers: number;
  suspendedMembers: number;
}
```

---

## 5. Zod Schemas

```typescript
import { z } from 'zod';

export const PARTNER_TYPES = ['AIRLINE','MILITARY','TRAINING_ACADEMY','CORPORATE','CHARTER'] as const;
export const PARTNER_STATUSES = ['ACTIVE','SUSPENDED','EXPIRED'] as const;
export const MEMBER_ROLES = ['PILOT','PARTNER_ADMIN','PARTNER_COORDINATOR'] as const;

export const CreatePartnerSchema = z.object({
  name:          z.string().min(2).max(255),
  icaoCode:      z.string().min(2).max(8).toUpperCase().optional(),
  type:          z.enum(PARTNER_TYPES),
  contactName:   z.string().min(1).max(255),
  contactEmail:  z.string().email(),
  contractRef:   z.string().max(100).optional(),
  contractStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  contractEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxPilots:     z.number().int().positive().nullable().optional(),
  notes:         z.string().max(4000).optional(),
});
export type CreatePartnerInput = z.infer<typeof CreatePartnerSchema>;

export const UpdatePartnerSchema = z.object({
  name:         z.string().min(2).max(255).optional(),
  contactName:  z.string().max(255).optional(),
  contactEmail: z.string().email().optional(),
  status:       z.enum(PARTNER_STATUSES).optional(),
  contractEnd:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  maxPilots:    z.number().int().positive().nullable().optional(),
  notes:        z.string().max(4000).nullable().optional(),
}).strict();
export type UpdatePartnerInput = z.infer<typeof UpdatePartnerSchema>;

export const AddMemberSchema = z.object({
  userId:     z.string().uuid(),
  memberRole: z.enum(MEMBER_ROLES).default('PILOT'),
  notes:      z.string().max(1000).optional(),
});
export type AddMemberInput = z.infer<typeof AddMemberSchema>;
```

---

## 6. EventBridge Events

| Event | Source | Trigger |
|---|---|---|
| `partner.created` | `aerocap.partner` | Partner entity created |
| `partner.suspended` | `aerocap.partner` | Partner status set to SUSPENDED |
| `partner.member.added` | `aerocap.partner` | Pilot added to partner |
| `partner.member.removed` | `aerocap.partner` | Pilot removed from partner |
| `partner.member.authorized` | `aerocap.partner` | Booking auth granted to member |
| `partner.member.revoked` | `aerocap.partner` | Booking auth revoked from member |

Event envelope (all events):
```json
{
  "tenantId": "tenant-demo",
  "traceId": "uuid",
  "occurredAt": "ISO-8601",
  "schemaVersion": "1.0",
  "payload": {
    "partnerId": "uuid",
    "partnerName": "Air France",
    "userId": "uuid (where applicable)"
  }
}
```

---

## 7. Role Matrix

| Action | PILOT | INSTRUCTOR | PARTNER_ADMIN | MANAGER | COUNTRY_ADMIN | GLOBAL_ADMIN |
|---|---|---|---|---|---|---|
| List own partner (me) | — | — | ✓ | — | — | — |
| List all partners | — | — | — | ✓ | ✓ | ✓ |
| Create partner | — | — | — | ✓ | ✓ | ✓ |
| Update partner | — | — | — | — | ✓ | ✓ |
| Suspend / delete partner | — | — | — | — | — | ✓ |
| List own members | — | — | ✓ (own) | ✓ | ✓ | ✓ |
| Add / remove members | — | — | ✓ (own) | ✓ | ✓ | ✓ |
| Authorize booking | — | — | ✓ (own) | ✓ | ✓ | ✓ |
| View partner stats | — | — | ✓ (own) | ✓ | ✓ | ✓ |

---

## 8. Tenant Isolation Rules

- `tenantId` always from JWT — never from request body.
- Every partner query includes `WHERE tenant_id = ?`.
- `PARTNER_ADMIN` can only manage their own partner's members (verified against `partner_members` table).
- Cross-tenant partner access requires `GLOBAL_ADMIN` scope.

---

## 9. Open Questions / Assumptions

1. **Pilot ownership**: A pilot belongs to at most one partner per tenant. If they need to transfer, the old membership must be REMOVED first.
2. **Billing**: Contract billing terms are out of scope for v1. `contract_ref` stores the external contract reference.
3. **Partner self-service signup**: Not in v1. Partners are created by AeroCap managers.
4. **ICAO code uniqueness**: Enforced per tenant. A global airline may have the same code in multiple AeroCap regions.

---

## Summary

- **Entities**: 2 (Partner, PartnerMember)
- **Endpoints**: 11
- **New role**: PARTNER_ADMIN
- **Events**: 6
- **Open questions**: 4
