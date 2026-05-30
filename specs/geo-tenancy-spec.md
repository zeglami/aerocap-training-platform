# AeroCap — Geo-Tenancy Specification

**Date:** 2026-05-29  
**Status:** Binding — implementation must match this document  
**Scope:** Country model, signup flow, data isolation, manager scoping, per-country seeding

---

## 1. Model: Country = Region = Tenant

AeroCap operates four regional training facilities. Each facility is an independent tenant.

| Tenant ID    | Display Name          | Region | Flag | Capital city |
|--------------|-----------------------|--------|------|--------------|
| `tenant-fr`  | AeroCap France        | FR     | 🇫🇷  | Paris CDG    |
| `tenant-za`  | AeroCap South Africa  | ZA     | 🇿🇦  | Johannesburg |
| `tenant-cn`  | AeroCap China         | CN     | 🇨🇳  | Beijing      |
| `tenant-in`  | AeroCap India         | IN     | 🇮🇳  | Mumbai       |

> **Note (dev compatibility):** The DB currently stores `tenant-demo` for France and `tenant-za` for South Africa. These IDs are preserved; only the `name` column is updated. CN and IN are added as `tenant-cn` and `tenant-in`.

### 1.1 Isolation rules

- Every table in every service has `tenant_id TEXT NOT NULL`
- `tenant_id` is always sourced from the JWT — never from the request body
- A user belongs to exactly one tenant (their home country)
- Cross-tenant reads are only allowed for MANAGER (via JWT scope) and GLOBAL_ADMIN

---

## 2. Signup Flow

### 2.1 Country picker

The self-registration form (`/signup`) replaces the "Organisation" dropdown with a **Country selector**.

**Field label:** "Training country"  
**Help text:** "Select the AeroCap facility where you will train"  
**Options:**  
```
🇫🇷  France          → tenant_id: tenant-fr   (tenant-demo in DB)
🇿🇦  South Africa    → tenant_id: tenant-za
🇨🇳  China           → tenant_id: tenant-cn
🇮🇳  India           → tenant_id: tenant-in
```

### 2.2 Countries API endpoint

**GET /api/v1/countries** (new — replaces GET /api/v1/tenants/public)

Response:
```json
{
  "data": [
    { "tenantId": "tenant-demo", "name": "France",       "region": "FR" },
    { "tenantId": "tenant-za",   "name": "South Africa", "region": "ZA" },
    { "tenantId": "tenant-cn",   "name": "China",        "region": "CN" },
    { "tenantId": "tenant-in",   "name": "India",        "region": "IN" }
  ],
  "meta": { "requestId": "...", "timestamp": "..." },
  "error": null
}
```

> This endpoint is public (no auth). The name field is the simplified country name, not the full "AeroCap France" — for display in the picker.

### 2.3 Signup API proxy (Next.js)

`GET /api/auth/signup` — fetches and returns the countries list (proxies to user-service `/api/v1/countries`)  
`POST /api/auth/signup` — creates the pilot account (existing behaviour, unchanged)

### 2.4 Post-signup behaviour

- Pilot account is created with `role=PILOT`, `booking_authorized=0`
- JWT is issued immediately → pilot is logged in
- Redirect to `/dashboard` where the pending-approval banner is shown
- Pilot can see their profile, CBTA progress, licences
- Booking is unlocked when a MANAGER or ADMIN approves the account

---

## 3. Per-Country Data Requirements

Every country must have the following seeded data so the portal is functional regardless of which country a manager or pilot is in.

### 3.1 Simulators (booking-service)

Each country needs at least **2 FFS Level D simulators** representing common aircraft types for that region.

| Country | Simulators |
|---------|-----------|
| France (FR) | A320neo, B737 MAX, B777-300ER, A350-900 (existing) |
| South Africa (ZA) | A320-214 (existing), B737-800 (add) |
| China (CN) | B737 MAX 8, A320neo (add) |
| India (IN) | A320neo, B737-800 (add) |

Each simulator gets **21 days of slots** (4 blocks/day: 06-10, 10-14, 14-18, 18-22).

### 3.2 Users (user-service)

Each country must have at minimum:
- 1 country admin / manager
- 1 instructor
- 2 pilots (booking_authorized=1)

| Country | Accounts |
|---------|---------|
| FR | admin@demo.com (GLOBAL_ADMIN), instructor@demo.com, pilot1-5@demo.com (existing) |
| ZA | admin@afrasky.com (COUNTRY_ADMIN), pilot@afrasky.com (existing) + 1 instructor + 1 more pilot (add) |
| CN | admin@aerocap.cn (COUNTRY_ADMIN), instructor@aerocap.cn, pilot1@aerocap.cn (add) |
| IN | admin@aerocap.in (COUNTRY_ADMIN), instructor@aerocap.in, pilot1@aerocap.in (add) |

### 3.3 CBTA competency units (cbta-service)

All 8 EASA competency units (AP, COM, FPA, FPM, LT, PSD, SA, WM) must be seeded for every tenant.

### 3.4 HRIS — pilot profiles (hris-service)

Each seeded pilot must have a basic `pilot_profile` row (licence_number, total_hours).

---

## 4. Manager Scoping

### 4.1 Manager scope field

Stored on `users.scope` (TEXT):
- `NULL` — not a manager (irrelevant)
- `'GLOBAL'` — can access all 4 countries
- `'["FR"]'` — France only
- `'["FR","ZA"]'` — France and South Africa
- Any combination of `FR`, `ZA`, `CN`, `IN`

### 4.2 JWT claims for managers

```json
{
  "sub": "manager-fr",
  "tenantId": "tenant-demo",
  "role": "MANAGER",
  "managerRegions": ["FR"],
  "managerHomeTenant": "tenant-demo"
}
```

`tenantId` = currently active country (updated on switch).  
`managerRegions` = null (global) or string[] of accessible region codes.

### 4.3 Company switcher

- Only shown if manager has access to more than 1 country
- Selecting a country → POST `/api/auth/switch-company` → new JWT with updated `tenantId`
- Full page reload after switch → layout re-renders with new session
- All service queries use `req.user!.tenantId` → filtering is automatic

### 4.4 Admin creating a manager

```http
POST /api/v1/users
{
  "email": "manager@airline.fr",
  "password": "...",
  "firstName": "...",
  "lastName": "...",
  "role": "MANAGER",
  "managerScope": "GLOBAL"        // or ["FR","ZA"]
}
```

Only `GLOBAL_ADMIN` can set `managerScope: "GLOBAL"`. `COUNTRY_ADMIN` can only grant access to their own region.

---

## 5. API Changes Summary

| Change | Type | Endpoint |
|--------|------|----------|
| New countries list endpoint | Add | `GET /api/v1/countries` |
| Remove tenants/public | Deprecate | `GET /api/v1/tenants/public` |
| Signup GET proxy | Add | `GET /api/auth/signup` → returns countries |
| Switch company | Add | `POST /api/auth/switch-company` (already implemented) |
| Tenant name update | Data | Rename "Demo Airlines" → "AeroCap France", "AfraSky Training" → "AeroCap South Africa" |

---

## 6. Implementation Checklist

- [ ] `user-service/db.ts` — update tenant display names, add CN/IN users
- [ ] `user-service/index.ts` — add `GET /api/v1/countries` endpoint  
- [ ] `booking-service/db.ts` — add ZA (B737-800), CN (B737/A320), IN (A320/B737) simulators + slots
- [ ] `cbta-service/db.ts` — ensure all 8 CUs seeded for all 4 tenants
- [ ] `hris-service/db.ts` — ensure pilot profiles for all seeded pilots
- [ ] `apps/web/src/app/api/auth/signup/route.ts` — add GET handler → proxy to `/api/v1/countries`
- [ ] `apps/web/src/app/signup/page.tsx` — replace "Organisation" with "Training country" label; use region-to-name mapping; hide internal tenant IDs
- [ ] Login page demo credentials — add CN/IN accounts

---

## 7. Open Questions

- `[OPEN-1]` Should pilots be allowed to transfer between countries (change tenant)? Currently impossible — would require a data-migration workflow.
- `[OPEN-2]` Should a COUNTRY_ADMIN be able to see pilots who self-registered in their country but haven't been approved yet? Currently yes (booking_authorized=0 filter in pilots list).
- `[OPEN-3]` Email uniqueness: currently unique per tenant (`UNIQUE(tenant_id, email)`). If a pilot trains in both FR and IN, they need two separate accounts. Is this acceptable?
