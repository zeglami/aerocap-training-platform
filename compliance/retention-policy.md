# AeroCap — Data Retention Policy

Maintained by: compliance-auditor agent + Legal/DPO
Last updated: 2026-05-28

---

## Retention Periods by Data Type

| Data Category | Retention Period | Legal Driver | Action at Expiry |
|---|---|---|---|
| Pilot identity PII | Contract duration + 2 years | GDPR, POPIA | Pseudonymise |
| CBTA assessment results (grades) | 5 years from session date | EASA FCL.735 | Retain structure, pseudonymise PII |
| CBTA examiner notes | 5 years from session date | EASA FCL.735 | Replace with [ERASED] at erasure request |
| Medical certificate data | Certificate validity + 2 years | Aviation regulatory | Retain expiry date, pseudonymise class |
| Pilot licence data | 5 years after last activity | EASA | Retain number (regulatory), pseudonymise name |
| Training session records | 5 years | EASA FCL.735 | Retain, pseudonymise pilot PII |
| Portal session/login logs | 6 months | CNIL guidance, proportionality | Hard delete |
| IP address logs | 6 months | CNIL guidance | Hard delete |
| Audit logs | 10 years | Regulatory / GDPR accountability | Retain |
| Marketing consent records | Until withdrawn + 3 years | GDPR accountability | Hard delete |
| Marketing email logs | 3 years | Commercial disputes | Hard delete |
| HRIS sync records | Contract duration + 1 year | Contract | Hard delete |
| Booking / reservation records | 2 years | Contractual | Pseudonymise pilot reference |
| Financial / invoice data | 10 years | French commercial law (L.123-22) | Hard delete PII, retain amounts |
| Consent records (all types) | Until withdrawn + 3 years | GDPR Art.7(1) accountability | Archive then delete |

---

## Automated Retention Enforcement

The following DB jobs must be scheduled (via AWS EventBridge Scheduler or N8N):

```sql
-- Daily: hard-delete expired session logs (6 months)
DELETE FROM audit_log
WHERE action IN ('LOGIN', 'LOGOUT', 'PAGE_VIEW')
  AND created_at < NOW() - INTERVAL '6 months';

-- Monthly: pseudonymise pilot records past retention window
-- (trigger erasure workflow for pilots where contract ended > 2 years ago)
SELECT id FROM pilot_profiles
WHERE erased_at IS NULL
  AND contract_end_date < NOW() - INTERVAL '2 years';
```

---

## Conflict Resolution: Erasure Rights vs. Regulatory Retention

When a data subject exercises their right to erasure (GDPR Art.17 / PIPL Art.47 / DPDP S.12):

1. **Check if data is within EASA regulatory retention window** (5 years)
2. **If yes**: Apply pseudonymisation — replace PII, retain structural/regulatory data
3. **If no**: Proceed with deletion
4. **Always**: Record the erasure request and action taken in `audit_log`
5. **Always**: Respond to data subject within 30 days (GDPR) / 15 working days (PIPL) / 48h acknowledgement (DPDP)

**Legal basis for refusing full erasure**: GDPR Art.17(3)(b) — "compliance with a legal obligation"
**EASA reference**: Commission Regulation (EU) No 1178/2011, FCL.735

---

## Jurisdiction-Specific Retention Notes

### PIPL (China)
- Data must be deleted "immediately" when purpose is fulfilled or consent withdrawn
- Exception: regulatory retention applies — document the basis
- Cross-border: transfer logs must be retained for regulatory review

### DPDP (India)
- Erase when purpose is fulfilled unless law requires retention
- Storage limitation is a core obligation — no indefinite retention

### CCPA (California)
- No specific retention periods — must be "reasonably necessary" for stated purpose
- Disclose retention periods in privacy notice

### POPIA (South Africa)
- "Not retained for longer than necessary" — purpose-based
- Destruction must be "secure" — certificate of destruction recommended for media
