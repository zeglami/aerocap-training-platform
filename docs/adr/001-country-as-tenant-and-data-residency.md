# ADR-001: Country As Tenant And Regional Data Residency

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap operates training facilities in France, South Africa, China, and India. Pilot records, instructor records, simulator bookings, CBTA assessments, licences, and regulatory reports contain personal data and aviation evidence.

The platform must support multiple privacy frameworks:

- France / EU: RGPD / GDPR
- China: PIPL
- South Africa: POPIA
- India: DPDP Act

The product also needs clear operational scoping. A pilot training in China should not accidentally be managed through the France tenant, and a country manager should not see another country's personal data unless explicitly scoped.

## Decision

AeroCap treats each training country/facility as a tenant.

Current tenant mapping:

| Region | Tenant ID | Facility | Data residency target |
|---|---|---|---|
| FR | `tenant-demo` | AeroCap France | France or EU data plane |
| ZA | `tenant-za` | AeroCap South Africa | South Africa or approved regional data plane |
| CN | `tenant-cn` | AeroCap China | China data plane where required |
| IN | `tenant-in` | AeroCap India | India or approved regional data plane |

The active tenant is carried in the authenticated session/JWT as `tenantId`. Backend services must use this claim for tenant filtering. Request bodies must not be trusted as tenant authority.

Production architecture should deploy regional data planes so tenant data can remain in the correct jurisdiction.

## Consequences

Benefits:

- Strong functional isolation between facilities.
- Clear compliance mapping by country.
- Reduced cross-border transfer risk.
- Simpler manager scoping and company switching.
- Clear audit and incident containment boundaries.

Trade-offs:

- Cross-country reporting becomes more complex.
- Global support access requires additional audit and approval controls.
- Regional deployments increase operational overhead.
- Data replication must be carefully reviewed.

Required controls:

- Every tenant-owned table includes `tenant_id`.
- Every tenant-owned query filters by `tenant_id`.
- Cross-border exports are logged and reviewed.
- Regional backups and logs follow the same residency rules as operational data.
