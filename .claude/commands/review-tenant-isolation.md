# Review Tenant Isolation

Audit code for multi-tenant data isolation violations. This is a critical security review for any code that touches the database or handles user data.

## Usage
```
/review-tenant-isolation [file-or-directory]
```
Example: `/review-tenant-isolation services/booking-service/src/repositories`

If no path is given, review all files modified in the current git diff.

## What to check

### CRITICAL — Data Leakage (must fix before merge)

1. **Missing tenantId filter**: Any SQL query on a tenant-scoped table that does NOT include `WHERE tenant_id = $tenantId` (or equivalent ORM filter).
   - Flag: query against `reservations`, `assessments`, `users`, `pilots`, `profiles`, or any domain table without tenant filter.

2. **TenantId from request body**: Any code that reads `tenantId` from `req.body`, `req.params`, or `req.query` instead of from the verified JWT (`req.user.tenantId`).
   - Flag: `req.body.tenantId`, `req.params.tenantId`, `body.tenant_id`

3. **Cross-tenant joins**: Any SQL JOIN that could link records across different tenants.
   - Flag: JOINs without tenant_id equality condition on both sides.

4. **Missing tenant context in events**: EventBridge event payloads that don't include `tenantId`.
   - Flag: `eventBridge.putEvents(...)` calls where payload lacks `tenantId`.

5. **Unfiltered admin queries**: Any query that intentionally bypasses tenant filtering must be explicitly marked with `// GLOBAL_QUERY: reason` and only callable from admin-scoped handlers.

### HIGH — Security Issues

6. **Hardcoded tenant IDs**: Any tenant ID hardcoded in source code.

7. **Tenant ID exposure in errors**: Error messages or logs that leak other tenants' IDs.

8. **Missing auth middleware**: Route handlers not protected by JWT validation middleware.

9. **Privilege escalation**: Role checks missing or bypassable.

### MEDIUM — Quality Issues

10. **No audit log on mutations**: INSERT/UPDATE/DELETE without a corresponding `audit_log` entry.

11. **Missing soft delete**: Hard `DELETE` statements on tenant-scoped tables instead of setting `deleted_at`.

12. **No pagination on list queries**: `SELECT *` without `LIMIT`/`OFFSET` — potential data dump.

## Output Format

Produce a structured report:

```
## Tenant Isolation Review — {path}

### CRITICAL Issues (block merge)
- [FILE:LINE] Description of issue
  Code: `offending snippet`
  Fix: `corrected snippet`

### HIGH Issues (fix before next release)
- ...

### MEDIUM Issues (tech debt)
- ...

### Passed Checks
- List checks that passed with no issues

### Summary
- Files reviewed: N
- Critical: N | High: N | Medium: N
- Verdict: PASS / FAIL / PASS WITH WARNINGS
```

## Rules
- If ANY critical issue is found, output `VERDICT: FAIL` and stop — do not suggest merging.
- Be specific: always cite file path, line number, and the exact offending code.
- Provide the corrected code snippet for every issue found.
- Do not flag `// GLOBAL_QUERY:` annotated queries as violations — just verify the annotation exists and is justified.
