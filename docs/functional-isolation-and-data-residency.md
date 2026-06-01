# Functional Isolation And Data Residency

**Status:** Functional product documentation  
**Last reviewed:** 2026-05-30  
**Last updated:** 2026-05-30 — added PARTNER_ADMIN role, B2B partner signup flow, partner data boundaries  
**Audience:** Product, engineering, compliance, operations

## 1. Purpose

AeroCap is a multi-country pilot training platform. Each training country operates as an isolated functional tenant so that pilots, instructors, managers, simulator bookings, training records, assessments, licences, and regulatory reports remain scoped to the correct AeroCap facility.

Isolation is not only a technical design choice. It is a product and compliance requirement:

- A French pilot training with AeroCap France should be managed under the France/EU tenant.
- A Chinese pilot training with AeroCap China should be managed under the China tenant.
- A South African pilot training with AeroCap South Africa should be managed under the South Africa tenant.
- An Indian pilot training with AeroCap India should be managed under the India tenant.

The platform should prevent accidental cross-country visibility, reduce cross-border personal data transfers, and make it clear which legal and operational rules apply to each training record.

## 2. Functional Tenant Model

In AeroCap, one tenant equals one training country/facility.

| Region | Tenant ID | Facility | Primary privacy framework | Data residency target |
|---|---|---|---|---|
| France / EU | `tenant-demo` | AeroCap France | RGPD / GDPR | France or EU-hosted database |
| South Africa | `tenant-za` | AeroCap South Africa | POPIA | South Africa-hosted or approved regional database |
| China | `tenant-cn` | AeroCap China | PIPL | China-hosted database for China personal information where required |
| India | `tenant-in` | AeroCap India | DPDP Act | India-hosted or approved regional database |

The tenant selected at signup becomes the pilot's home training country. The active tenant is then stored in the user's session/JWT and used by backend services to filter every tenant-owned record.

## 3. Why Isolation Matters

### 3.1 Privacy compliance

Pilot training records include personal information and potentially sensitive operational evidence:

- Identity details
- Licence numbers
- Date of birth and nationality
- Training history
- Competency assessments
- Instructor comments
- Simulator session records
- Deficits and remedial training actions
- Regulatory report evidence

These records must be processed under the correct local privacy framework. Hosting and isolating data by region helps demonstrate that AeroCap has designed the platform around data minimisation, purpose limitation, access control, and transfer control.

### 3.2 Regulatory evidence

Training data must answer inspector questions without reconstructing evidence from mutable sources:

- Who trained?
- Who assessed?
- Which simulator was used?
- Which authority approval applied?
- Which syllabus/version applied?
- What was signed?
- Which tenant/facility owned the record?

Tenant isolation preserves that context. A record from AeroCap France should not silently depend on China, India, or South Africa data to be understood.

### 3.3 Operational safety

Simulator availability, instructor qualifications, licences, and training programmes vary by facility and authority. Isolation ensures a manager in one country does not accidentally:

- Approve a pilot in another country
- Assign a simulator from the wrong facility
- Use an instructor qualification outside its applicable region
- Run a report that mixes incompatible regulatory evidence
- See personal data they are not authorised to access

### 3.4 Incident containment

If a configuration error, data correction, or security incident occurs in one tenant, isolation reduces the chance that other countries are affected. Each tenant has its own data boundary, audit scope, and recovery plan.

## 4. Data Residency Requirement

The production architecture should use a regional data plane. Each country tenant should store operational personal data in a database located in, or legally approved for, that region.

### France / EU

France and EU tenant data should be hosted in France or another approved EU location to support RGPD/GDPR obligations. The GDPR applies to EU personal data and places restrictions on transfers outside the EEA. If data leaves the EU, transfer tools such as adequacy decisions, SCCs, or other approved safeguards may be required.

Functional requirement:

- `tenant-demo` data is stored in the France/EU data plane.
- EU personal data is not replicated outside the EU data plane unless a documented transfer mechanism exists.
- EU reporting exports must be logged and access-controlled.

### China

China tenant data should be hosted in China where required to support PIPL compliance and to reduce cross-border transfer risk. PIPL includes rules for providing personal information outside China, so China personal information should not be casually replicated into a global database.

Functional requirement:

- `tenant-cn` data is stored in the China data plane.
- Cross-border access to China tenant data requires explicit approval, logging, and a documented legal basis.
- China reporting exports should be generated inside the China data plane where possible.

Implementation reference links:

- Personal Information Protection Law of the People's Republic of China (official NPC English text): https://en.npc.gov.cn.cdurl.cn/2021-12/29/c_694559.htm
- PIPL Article 28 sensitive personal information reference (NPC English text, page 2): https://en.npc.gov.cn.cdurl.cn/2021-12/29/c_694559_2.htm
- CAC Measures for the Standard Contract for Outbound Transfer of Personal Information: https://www.cac.gov.cn/2023-02/24/c_1678884830036813.htm
- CAC standard contract attachment for outbound transfer of personal information: https://www.cac.gov.cn/rootimages/uploadimg/1678884832607075/1678884832607075.pdf
- CAC Provisions on Promoting and Regulating Cross-Border Data Flows: https://www.cac.gov.cn/2024-03/22/c_1712776612187994.htm
- CAC outbound data transfer security assessment measures attachment: https://www.cac.gov.cn/rootimages/uploadimg/1663568170075366/1663568170075366.pdf

### South Africa

South Africa tenant data should be hosted in South Africa or in an approved region that satisfies POPIA transfer and processing requirements. POPIA requires lawful and fair processing of personal information, with appropriate controls around access and sharing.

Functional requirement:

- `tenant-za` data is stored in the South Africa data plane or an approved regional equivalent.
- Transfers outside South Africa require compliance review and audit logging.
- Managers outside South Africa do not get access unless their role/scope explicitly allows it.

### India

India tenant data should be hosted in India or an approved regional data plane aligned with India's Digital Personal Data Protection Act and AeroCap's customer commitments. Even where a particular transfer is legally possible, local hosting reduces operational and contractual risk.

Functional requirement:

- `tenant-in` data is stored in the India data plane or an approved regional equivalent.
- Any transfer outside the India data plane must be logged and justified.
- India tenant reporting and operational workflows should avoid unnecessary replication into other regions.

## 5. Functional Access Rules

### Pilot

A pilot belongs to one tenant.

The pilot can:

- View their profile
- View their licences and type ratings
- View their CBTA progress
- View their own bookings
- Create bookings only when `booking_authorized = true`

The pilot cannot:

- See pilots from other tenants
- Switch tenant
- View another pilot's training record
- Access manager or instructor reports

### Instructor

An instructor belongs to one tenant unless explicitly configured otherwise.

The instructor can:

- View assigned pilots in their tenant
- Record assessments for their tenant
- View relevant training sessions and simulator bookings
- Use scenarios approved for their tenant

The instructor cannot:

- Assess a pilot from another tenant without explicit cross-tenant assignment
- Use another country's simulator or scenario evidence as if it belonged to their tenant
- Export regulatory reports unless granted a reporting role

### Country Admin

A country admin manages one tenant/country.

The country admin can:

- Approve pilot booking access in their tenant
- Manage users in their tenant
- View tenant reports
- Manage local operational records

The country admin cannot:

- Grant global manager access
- Access another country by default
- Move personal data to another region without an approved process

### Manager

A manager can be scoped to one or more regions.

Examples:

- France-only manager: `["FR"]`
- France and South Africa manager: `["FR","ZA"]`
- Global manager: `GLOBAL`

The manager can switch active country only if their scope allows it. When a manager switches country, the session receives a new active `tenantId`. All service queries continue to filter by that active tenant.

### Partner Admin

A partner admin (`PARTNER_ADMIN`) represents a B2B operator organisation (airline, military unit, training academy, corporate operator).

The partner admin can:

- View and manage pilots within their own partner organisation
- Add pilots to the partner's roster
- Authorise and revoke simulator booking access for their pilots
- View their organisation's compliance statistics (total members, authorised, pending, suspended)
- Access the `/partners/[id]` detail page

The partner admin cannot:

- See pilots or partner records from other partner organisations
- Access another tenant's data
- Create or modify the partner entity itself (AeroCap managers control partner creation)
- Access schedule management, instructor records, or regulatory reports
- Bypass the PARTNER_ADMIN → own-partner membership check at the API level

Data boundary: `partner-service` enforces that a `PARTNER_ADMIN` caller must have an active row in `partner_members` for the target `partner_id` and `tenant_id` before any route handler executes. This check runs inside `resolvePartner()` before any read or write.

### Global Admin

A global admin can administer the platform across countries, but global access must still be audited.

The global admin can:

- Create tenants
- Assign manager scopes
- Support cross-country operations
- Access global operational dashboards

The global admin should not:

- Bypass data residency controls silently
- Export personal data across regions without an audit event
- Use global access for routine local operations when a country role is sufficient

## 6. Functional Data Boundaries

Each service must treat `tenant_id` as a hard boundary.

Tenant-scoped data includes:

- Users
- Pilot profiles
- Instructor records
- Simulators
- Slots
- Reservations
- Operating schedules
- Blocked periods
- Maintenance records
- Competency units
- Assessments
- Training programmes
- Training session records
- Deficits
- Scenarios
- Regulatory reports
- Audit logs
- Partner organisations (`partners` table — `tenant_id` scoped)
- Partner memberships (`partner_members` table — `tenant_id` scoped, additionally `partner_id` scoped for PARTNER_ADMIN)

Reference data can be global only when it contains no personal data and no facility-specific operational data. Examples:

- Country code lists
- Generic competency unit definitions
- Public regulatory labels
- Static aircraft type labels

Even when reference data is global, tenant-specific copies may be needed if an authority approval, syllabus, or simulator qualification differs by country.

## 7. Data Flow Requirements

### Signup — Individual pilot (B2C)

1. `/signup` displays a type selector: Individual Pilot or Partner Organisation.
2. Pilot selects Individual Pilot and chooses a training facility (FR / ZA / CN / IN).
3. The system maps the country to a `tenantId`.
4. `user-service` creates a `PILOT` user with `booking_authorized = 0` in that tenant.
5. Pilot receives a JWT containing the `tenantId` and is redirected to the dashboard.
6. Booking remains locked (`bookingAuthorized = false`) until an AeroCap manager or `PARTNER_ADMIN` explicitly authorises it.

The selected tenant must not be changed casually after signup because it determines data residency and regulatory scope.

### Signup — Partner organisation (B2B)

1. Operator selects Partner Organisation on the `/signup` type selector.
2. The enquiry form collects: organisation name, type (AIRLINE/MILITARY/TRAINING_ACADEMY/CORPORATE/CHARTER), ICAO code, training regions needed, estimated pilot count, and contact details.
3. The enquiry is received by AeroCap (production: CRM/notification; demo: success screen).
4. AeroCap creates the partner record in `partner-service` and assigns a `PARTNER_ADMIN` user via `user-service`.
5. `PARTNER_ADMIN` logs in, navigates to `/partners/[id]`, and adds their pilots to the partner's roster.
6. For each pilot, `PARTNER_ADMIN` grants booking authorisation, which calls `user-service` to set `booking_authorized = 1` on that user.
7. Partner data (partners table, partner_members table) is stored in the same regional data plane as the `tenantId` it belongs to.

### Booking

1. User views simulators for their active tenant.
2. User views slots for their active tenant.
3. Schedule rules remove unavailable periods.
4. Reservation is created only inside the active tenant.
5. The booking record stores simulator, slot, pilot, and session type evidence.

No booking workflow should read or reserve a simulator from another tenant.

### Training assessment

1. Instructor records assessment in the same tenant as the pilot/session.
2. CBTA data is stored with `tenant_id`.
3. Low scores can trigger a deficit in the same tenant.
4. Remedial actions stay attached to the same pilot and tenant.

Cross-tenant assessments require a formal assignment and audit trail.

### Reporting

1. Reports are generated for one tenant by default.
2. Cross-tenant reports are available only to approved global roles.
3. Report exports include tenant, region, generation time, actor, and purpose.
4. Inspector access tokens are tenant-scoped unless a formal multi-region inspection exists.

## 8. Cross-Border Access Rules

Cross-border access means a user, system, export, replica, support process, or analytics job accesses personal data from outside the tenant's approved data plane.

Allowed only when:

- The actor has an approved role and scope.
- The access purpose is documented.
- The access is logged.
- The transfer basis is documented where required.
- The minimum necessary data is exposed.

Examples requiring review:

- EU pilot data copied to a non-EU analytics warehouse
- China pilot records exported to a global support tool
- South Africa licence data included in a global report
- India pilot assessments replicated into another region

## 9. Audit Requirements

Every privacy-relevant and regulatory-relevant mutation should write an audit event.

Audit event minimum fields:

- `tenantId`
- `region`
- `actorUserId`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `occurredAt`
- `sourceIp` where available
- `reason` for privileged or cross-border access
- `before` and `after` values where safe and appropriate

Audit logs should be stored in the same regional data plane as the tenant data unless a compliant central audit strategy is approved.

## 10. Functional Acceptance Criteria

Tenant isolation is accepted when:

- A pilot can only see their own tenant data.
- A country admin can only manage their country.
- A scoped manager can only switch to assigned regions.
- A global admin access event is auditable.
- Every tenant table includes `tenant_id`.
- Every tenant-owned query filters by `tenant_id`.
- Request bodies cannot override tenant ownership.
- Reports are tenant-scoped by default.
- Cross-region data export requires explicit authorization and audit logging.
- Regional database placement matches the tenant data residency policy.
- A `PARTNER_ADMIN` can only read and write records for the partner they are a member of (enforced at DB level in `partner-service`).
- Partner data (`partners`, `partner_members`) is stored in the tenant's regional data plane.
- A pilot cannot belong to more than one active partner per tenant (enforced by `UNIQUE(tenant_id, user_id)` on `partner_members`).

Data residency is accepted when:

- France/EU data is stored in the France/EU data plane.
- China data is stored in the China data plane where required.
- South Africa data is stored in South Africa or an approved region.
- India data is stored in India or an approved region.
- Backups, replicas, logs, analytics, and support tools follow the same residency rules.
- Any exception has a documented approval, purpose, retention period, and transfer basis.

## 11. Implementation Notes

Current development implementation uses local SQLite databases. Production should replace this with regional database deployments.

Recommended production layout:

```text
EU data plane
  tenant-demo
  services databases
  EU audit logs
  EU report storage

China data plane
  tenant-cn
  services databases
  China audit logs
  China report storage

South Africa data plane
  tenant-za
  services databases
  South Africa audit logs
  South Africa report storage

India data plane
  tenant-in
  services databases
  India audit logs
  India report storage
```

Application services may share source code, but runtime data must remain regionally isolated. A deployment can be global in code and regional in data.

## 12. Source Notes

This document is functional guidance, not legal advice. Final production controls should be reviewed by AeroCap legal/compliance teams.

Reference sources:

- European Commission guidance on GDPR international data transfers: https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en
- Council of the European Union GDPR overview: https://www.consilium.europa.eu/en/policies/data-protection/data-protection-regulation/
- Personal Information Protection Law of the People's Republic of China: https://en.spp.gov.cn/2021-12/29/c_948419.htm
- Personal Information Protection Law of the People's Republic of China (NPC English text): https://en.npc.gov.cn.cdurl.cn/2021-12/29/c_694559.htm
- CAC Measures for the Standard Contract for Outbound Transfer of Personal Information: https://www.cac.gov.cn/2023-02/24/c_1678884830036813.htm
- CAC Provisions on Promoting and Regulating Cross-Border Data Flows: https://www.cac.gov.cn/2024-03/22/c_1712776612187994.htm
- CAC outbound data transfer security assessment measures attachment: https://www.cac.gov.cn/rootimages/uploadimg/1663568170075366/1663568170075366.pdf
- South Africa POPIA overview from National Treasury: https://www.treasury.gov.za/POPIA/
- South Africa Information Regulator POPIA page: https://inforegulator.org.za/popia/
- India Digital Personal Data Protection Act, 2023 from MeitY: https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf
