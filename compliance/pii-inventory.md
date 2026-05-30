# AeroCap — PII Inventory (Record of Processing Activities)

Maintained by: compliance-auditor agent + Data Protection Officer
Last updated: 2026-05-28
Review frequency: Quarterly or on any new data field addition

---

## How to use this document

When adding a new field to any database table that contains personal data:
1. Add it to the relevant section below
2. Tag the SQL column with a `COMMENT` (see template)
3. Spawn the `compliance-auditor` subagent to validate the addition

SQL column tag format:
```sql
COMMENT ON COLUMN table.column IS
  'PII:{LOW|MEDIUM|HIGH|SPECIAL} | Laws:{GDPR|PIPL|DPDP|CCPA|POPIA} | Retention:{period} | Erasure:{delete|pseudonymise|retain-regulatory}';
```

---

## Data Subject: Pilot

| Field | Table | Sensitivity | GDPR | PIPL | DPDP | CCPA | POPIA | Retention | Erasure Strategy |
|---|---|---|---|---|---|---|---|---|---|
| `full_name` | `pilot_profiles` | HIGH | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | Contract+2y | Pseudonymise |
| `date_of_birth` | `pilot_profiles` | HIGH | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | Contract+2y | Replace with 1900-01-01 |
| `nationality` | `pilot_profiles` | HIGH | Art.9 (racial/ethnic origin) | SensitivePI | PersonalData | SensitivePI | SpecialPI | Contract+2y | Pseudonymise |
| `passport_number` | `pilot_profiles` | HIGH | Art.4(1) | SensitivePI | PersonalData | SensitivePI | PersonalInfo | Contract+2y | Pseudonymise |
| `email` | `pilot_profiles` | MEDIUM | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | Contract+2y | Replace with erased@invalid |
| `phone` | `pilot_profiles` | MEDIUM | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | Contract+2y | NULL |
| `photo_url` | `pilot_profiles` | HIGH | Art.4(1)+biometric | Art.28 biometric | PersonalData | SensitivePI | SpecialPI | Contract+2y | Delete file + NULL URL |
| `licence_number` | `pilot_profiles` | HIGH | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | 5y EASA | RETAIN (regulatory) |
| `licence_type` | `pilot_profiles` | MEDIUM | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | 5y EASA | RETAIN |
| `medical_cert_class` | `pilot_profiles` | SPECIAL | Art.9 health | Art.28 health | PersonalData | SensitivePI | SpecialPI s.26 | Validity+2y | Pseudonymise |
| `medical_cert_expiry` | `pilot_profiles` | SPECIAL | Art.9 health | Art.28 health | PersonalData | SensitivePI | SpecialPI s.26 | Validity+2y | RETAIN (aviation safety) |
| `employer_airline_id` | `pilot_profiles` | LOW | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | Contract+2y | NULL |
| `ip_address` (login) | `audit_log` | MEDIUM | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | 6 months | Auto-expire |
| `competency_grades` | `assessment_results` | HIGH | Art.4(1)+Art.9 | Art.4 | PersonalData | PI | PersonalInfo | 5y EASA | Retain grades, erase examiner notes |
| `examiner_notes` | `assessment_results` | HIGH | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | 5y EASA | Replace with [ERASED] |
| `session_dates` | `training_sessions` | LOW | Art.4(1) | Art.4 | PersonalData | PI | PersonalInfo | 5y EASA | RETAIN |

---

## Data Subject: Instructor / Examiner

| Field | Table | Sensitivity | Notes |
|---|---|---|---|
| `full_name` | `instructor_profiles` | HIGH | Same erasure rules as pilot |
| `email` | `instructor_profiles` | MEDIUM | |
| `instructor_licence` | `instructor_profiles` | HIGH | Regulatory — retain |
| `examiner_authorisation` | `instructor_profiles` | HIGH | EASA regulatory — retain |

---

## Data Subject: Airline Contact (B2B)

| Field | Table | Sensitivity | Notes |
|---|---|---|---|
| `contact_name` | `organization_contacts` | MEDIUM | Only if natural person, not role title |
| `contact_email` | `organization_contacts` | MEDIUM | Business email — lower sensitivity |
| `contact_phone` | `organization_contacts` | LOW | |

---

## Processing Activities Register (RoPA — GDPR Art. 30)

| Activity | Purpose | Legal Basis | Data Used | Recipients | Retention |
|---|---|---|---|---|---|
| Pilot registration | Deliver training service | Contract (Art.6(1)(b)) | Identity, credentials | AeroCap internal | Contract+2y |
| CBTA assessment recording | Regulatory compliance | Legal obligation (Art.6(1)(c)) | Training records, grades | EASA (if audit) | 5y |
| Booking management | Training scheduling | Contract (Art.6(1)(b)) | Name, email, session data | Internal | 2y |
| Portal analytics | Platform improvement | Legitimate interests (Art.6(1)(f)) | IP, usage logs | None | 6mo |
| Marketing emails | Commercial promotion | Consent (Art.6(1)(a)) | Email, preferences | Email provider (DPA required) | Until withdrawn |
| HRIS sync | Staff/pilot data accuracy | Contract (Art.6(1)(b)) | Profile data | Airline HR systems | Contract duration |

---

## Sub-Processors (require DPA under GDPR Art. 28)

| Processor | Service | Data Shared | DPA Status | Location |
|---|---|---|---|---|
| AWS | Infrastructure, Aurora, S3, Cognito | All data | ✅ AWS DPA signed | Multi-region |
| N8N (if SaaS) | Workflow automation | Email, notification data | ⚠️ Required | Check hosting |
| Email provider (TBD) | Transactional + marketing emails | Email, name | ⚠️ Required | TBD |

---

## Transfer Mechanisms (Cross-Border)

| Transfer Route | Mechanism | Status |
|---|---|---|
| France → South Africa | GDPR Art.46 standard clauses | ⚠️ Draft required |
| France → China | GDPR SCC + PIPL CAC Standard Contract | ❌ Not in place |
| France → India | GDPR SCC | ⚠️ Draft required |
| China → France | PIPL CAC security assessment | ❌ Not in place |
| ZA → France | POPIA Section 72 contractual safeguards | ⚠️ Draft required |

**Action required**: All ❌ items must be resolved before processing personal data in production.
