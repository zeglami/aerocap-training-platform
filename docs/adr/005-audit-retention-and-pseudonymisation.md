# ADR-005: Audit, Retention, And Pseudonymisation

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap records include personal data and aviation regulatory evidence. Data subjects may have privacy rights such as erasure, but aviation records may need to be retained for inspection.

Examples:

- CBTA grades
- Training session records
- Licence evidence
- Instructor/examiner sign-off
- Simulator qualification evidence

## Decision

AeroCap uses audit logging, retention policies, and pseudonymisation to balance privacy rights and regulatory evidence.

For records that must be retained:

- Keep regulatory structure.
- Remove or replace direct personal identifiers where erasure applies.
- Preserve enough evidence to answer inspector questions.

For records that do not require long retention:

- Delete or expire according to the retention policy.

The compliance baseline is documented in:

- `compliance/pii-inventory.md`
- `compliance/retention-policy.md`
- `docs/functional-isolation-and-data-residency.md`

## Consequences

Benefits:

- Supports GDPR/PIPL/DPDP/POPIA privacy expectations.
- Keeps aviation records inspectable.
- Creates a defensible audit trail.
- Reduces personal-data exposure after retention windows.

Trade-offs:

- Erasure workflows are more complex than hard delete.
- Reports must understand pseudonymised records.
- Audit logs themselves require retention and access controls.

Required controls:

- All privacy-relevant mutations write audit events.
- PII fields are inventoried.
- Retention jobs are implemented and monitored.
- Export and inspector-access events are logged.
