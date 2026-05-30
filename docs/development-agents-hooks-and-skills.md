# Development Agents, Hooks, And Skills

**Status:** Project development workflow documentation  
**Last reviewed:** 2026-05-30  
**Audience:** Engineers, product owners, compliance reviewers, AI-assisted contributors

## 1. Purpose

AeroCap was developed with an AI-assisted development kit made of three layers:

- **Subagents**: specialist personas used for focused work such as architecture, backend, frontend, testing, security, compliance, and aviation training rules.
- **Skills**: always-available project knowledge that reminds contributors of AeroCap rules, such as tenant isolation, OpenAPI-first development, audit trails, and multi-jurisdiction data protection.
- **Hooks**: automation scripts that run around tool usage to provide safety checks, environment context, linting reminders, and test feedback.

Together, these tools helped keep the project aligned with its core constraints:

- Multi-tenant isolation
- Pilot data protection
- Aviation training compliance
- TypeScript microservice consistency
- OpenAPI and Zod contract discipline
- Safer local development

## 2. Why This Layer Exists

AeroCap is not a generic CRUD application. It handles pilot training, simulator bookings, licence data, competency assessments, instructor qualifications, and regulatory evidence across several countries.

That creates recurring risks:

- Forgetting a `tenant_id` filter
- Accepting `tenantId` from a request body
- Returning too much personal data
- Hard-deleting records that must be retained
- Creating endpoints without OpenAPI or Zod validation
- Mixing regulatory evidence between countries
- Missing audit trails for privileged operations
- Running destructive local commands by accident

The agents, skills, and hooks act as a development safety system. They do not replace engineering review, but they make the expected way of building AeroCap explicit and repeatable.

## 3. Subagents

Subagents are specialist collaborators. Each one has a narrow role and a checklist. They are useful when a task needs domain focus or independent review.

### spec-generator

Role: turns a feature idea into a contract before implementation.

Helped with:

- Entity models
- Database schemas
- OpenAPI 3.0 contracts
- TypeScript interfaces
- Zod schemas
- EventBridge event definitions

Why it matters:

The project has a contract-first rule. A feature such as simulator time management or functional training management should be specified before code is written, because later changes affect data retention, regulator evidence, and service boundaries.

Typical use:

```text
Use spec-generator to design the API and database schema for maintenance scheduling.
```

### training-management

Role: aviation training domain specialist.

Helped with:

- EASA / FAA / ICAO / SACAA training logic
- CBTA and EBT concepts
- Session types such as ITR, OPC, LPC, UPRT, EBT
- Recency and currency rules
- Inspector-facing evidence requirements

Why it matters:

AeroCap needs to answer aviation training questions, not only software questions. The training-management agent keeps features grounded in what instructors, examiners, and authorities need to see.

Typical use:

```text
Use training-management to validate the rules for LPC/OPC spacing and simulator credit.
```

### backend-developer

Role: senior TypeScript/Express microservice engineer.

Helped with:

- Service structure
- Express route patterns
- Zod validation
- SQLite development database setup
- Migration style
- Auth middleware
- Event publishing patterns
- Tenant-aware database access

Why it matters:

The services share a common shape: `src/index.ts`, `src/db.ts`, `src/middleware/auth.ts`, `src/schemas/index.ts`, and `migrations`. This agent keeps backend work consistent across services.

Typical use:

```text
Use backend-developer to implement the blocked-period API from the schedule spec.
```

### frontend-developer

Role: Next.js and product UI specialist.

Helped with:

- Dashboard pages
- Booking UI
- Schedule management UI
- Login/signup flows
- Role-aware navigation
- API proxy usage
- Client/server component choices

Why it matters:

The web app is operational software for pilots, instructors, and managers. The frontend agent helps keep screens focused on real workflows rather than marketing-style pages.

Typical use:

```text
Use frontend-developer to build the maintenance calendar page.
```

### test-runner

Role: QA engineer for Jest and integration tests.

Helped with:

- Tenant isolation tests
- Auth guard tests
- Validation tests
- Happy-path and error-path coverage
- Supertest-based Express API tests

Why it matters:

The highest-risk bugs in AeroCap are not visual issues. They are data leaks, invalid bookings, missing auth, and regulatory rule failures. Tests need to target those cases directly.

Typical use:

```text
Use test-runner to add tests for manager company switching and tenant isolation.
```

### code-reviewer

Role: strict reviewer for correctness, tenant isolation, security, and architecture.

Helped with:

- Finding missing `tenant_id` filters
- Checking auth on routes
- Checking parameterized SQL
- Checking Zod validation
- Checking soft delete and audit requirements
- Flagging OpenAPI drift

Why it matters:

This agent is a pre-merge gate. It should block code that could leak tenant data or violate architecture rules.

Typical use:

```text
Use code-reviewer to review the booking-service reservation changes.
```

### security-auditor

Role: security reviewer for auth, OWASP, secrets, API boundaries, and tenant isolation.

Helped with:

- JWT validation review
- Role-based access control checks
- OWASP Top 10 review
- Secret handling checks
- Rate limit and request-size considerations
- Logging and error exposure review

Why it matters:

AeroCap handles personal data and regulatory training records. Security review is required before production deployment and before changes to auth, data, or API boundaries.

Typical use:

```text
Use security-auditor to review the auth and signup flow.
```

### compliance-auditor

Role: multi-jurisdiction data protection specialist.

Helped with:

- GDPR / RGPD requirements for France and EU data
- PIPL requirements for China data
- DPDP Act considerations for India data
- POPIA considerations for South Africa data
- PII inventory requirements
- Retention and erasure strategy
- Cross-border transfer controls

Why it matters:

Pilot data may be subject to several privacy regimes at once. The compliance-auditor maps legal obligations into engineering controls, such as pseudonymisation, audit logs, regional hosting, and transfer review.

Typical use:

```text
Use compliance-auditor before adding a new pilot profile field or cross-border report export.
```

### explorer

Role: codebase mapper.

Helped with:

- Finding related files
- Mapping unknown services
- Identifying query patterns
- Locating tenant-sensitive paths
- Preparing context for reviewers

Why it matters:

The codebase has many services. Explorer is useful before changing unfamiliar areas.

Typical use:

```text
Use explorer to map all places where reservations are read or written.
```

### agent-teams

Role: workflow guide for running several agents in parallel.

Helped with:

- New feature pipeline
- Full compliance sweep
- Codebase audit
- New microservice build

Why it matters:

Some work benefits from independent reviews. For example, security and compliance can audit the same release in parallel, then the main session can combine the findings.

## 4. Skills

Skills are project rules and domain knowledge. They are written in `skills/SKILL.md` and are intended to be applied whenever a matching task appears.

### Multi-Tenant Data Access

Rule:

- Always filter tenant tables by `tenant_id`.
- Never get `tenantId` from request input.
- Use soft delete with `deleted_at`.
- Write audit logs for mutations.

How it helped:

This skill shaped the service query style and the project documentation around tenant isolation.

### TypeScript Microservice Scaffold

Rule:

- Use TypeScript strict mode.
- Validate inputs with Zod.
- Return the standard `{ data, meta, error }` response envelope.
- Paginate list endpoints.
- Use UUIDs for IDs.

How it helped:

This skill gave services a repeatable structure and kept APIs predictable.

### EventBridge Event Design

Rule:

- Event names follow `{Domain}.{Entity}.{PastTense}`.
- Payloads include tenant and event metadata.
- Consumers must be idempotent.
- Events are not for synchronous request/response work.

How it helped:

It influenced the planned architecture for schedule propagation, deficit triggers, report generation, and training-session workflows.

### OpenAPI Contract First

Rule:

- Write OpenAPI before implementation.
- Include auth, schemas, error responses, and standard envelopes.
- Do not put `tenantId` in request body schemas.

How it helped:

It shaped the specs in `specs/`, especially simulator time management and training management.

### CBTA Regulatory Compliance

Rule:

- CBTA records are per competency.
- Finalised assessments are immutable.
- Regulatory records are retained even when PII must be pseudonymised.
- Low scores trigger training action.

How it helped:

It informed the CBTA service, deficit tracking, and training management specifications.

### GDPR And Audit Trail

Rule:

- Identify PII fields.
- Use soft delete and pseudonymisation.
- Audit every insert, update, and delete.
- Return only necessary data.

How it helped:

It guided the compliance documents and reinforced why audit logs are part of the architecture.

### React / Next.js Component Patterns

Rule:

- Prefer Server Components.
- Use client components only when hooks/browser APIs are needed.
- Handle loading, error, empty, and data states.
- Use typed API access.

How it helped:

It shaped the web app pages and API proxy approach.

### Multi-Jurisdiction Data Compliance

Rule:

- Determine applicable law by tenant and jurisdiction.
- Tag PII fields with laws, retention, and erasure strategy.
- Never hard-delete pilot regulatory records.
- Use compliance review for pilot data and cross-border transfers.

How it helped:

It directly supports the data residency and functional isolation requirements in `docs/functional-isolation-and-data-residency.md`.

### AWS Infrastructure Naming

Rule:

- Use `aerocap-{env}-{service}-{resource}` naming.
- Store secrets in AWS Secrets Manager.
- Use least-privilege IAM.
- Tag resources consistently.

How it helped:

It defines the expected production infrastructure style, even while the current implementation remains local.

## 5. Hooks

Hooks are shell scripts that run automatically around AI-assisted tool usage.

### SessionStart hook

File: `hooks/SessionStart.sh`

Purpose:

- Prints project context at the start of a session.
- Shows the stack and operating regions.
- Displays Node.js and npm versions.
- Shows the Git branch if available.
- Lists active services.
- Reminds contributors of available commands and guardrails.

How it helped:

It gives every development session the same starting context. That is useful in a large project where contributors need to remember the regions, stack, and safety rules.

### PreToolUse hook

File: `hooks/PreToolUse.sh`

Purpose:

- Blocks dangerous shell commands before they run.
- Prevents broad `rm -rf` commands.
- Blocks destructive database operations such as `DROP TABLE`, `DROP DATABASE`, and `TRUNCATE TABLE`.
- Blocks force pushes.
- Blocks `git reset --hard`.
- Blocks direct production environment operations.
- Blocks attempts to write secrets to `.env`, credentials, or similar files.

How it helped:

It reduces accidental damage during AI-assisted development. This is especially important because the project contains local databases, generated files, service folders, and compliance-sensitive data patterns.

### PostToolUse hook

File: `hooks/PostToolUse.sh`

Purpose:

- Runs after write/edit operations.
- Auto-lints TypeScript and TSX files where ESLint is available.
- Runs co-located Jest tests when a matching test file exists.
- Reminds contributors to create or update `openapi.yaml` when handlers change.

How it helped:

It keeps feedback close to the edit. The hook is not a replacement for CI, but it catches common issues earlier and reinforces the OpenAPI contract-first workflow.

## 6. Plugin Layer

The `plugins/` folder is the distribution and onboarding layer for the AeroCap Agent Development Kit. It describes how the project packages memory, skills, hooks, subagents, and commands so the same workflow can be installed or explained to another contributor.

Important files:

- `plugins/manifest.json`
- `plugins/marketplace.url`
- `plugins/team.install`

### plugins/manifest.json

The manifest is the index of the development kit. It describes the project as a five-layer Claude Code infrastructure:

- **Memory**: `CLAUDE.md`, loaded as project context and architecture rules.
- **Skills**: `skills/SKILL.md`, templates, context files, and slash-command definitions.
- **Hooks**: safety and feedback scripts such as `PreToolUse`, `PostToolUse`, and `SessionStart`.
- **Subagents**: specialist agents such as `spec-generator`, `code-reviewer`, `test-runner`, `security-auditor`, `frontend-developer`, and `compliance-auditor`.
- **Plugins**: the packaging layer that makes the setup reusable.

The manifest also documents the expected feature delivery workflow:

1. Describe the feature.
2. Generate the OpenAPI contract.
3. Scaffold or implement the service.
4. Let hooks lint and test edited files.
5. Add missing tests.
6. Review tenant isolation.
7. Run security/compliance audits.
8. Run final code review.

### plugins/marketplace.url

This file points to the marketplace or distribution source for the plugin package. Functionally, it tells a contributor where the AeroCap kit is expected to be obtained or updated from.

### plugins/team.install

The install script is an onboarding helper. Its role is to make the agent kit repeatable for a team member rather than tribal knowledge stored in one person's local environment.

It helps answer:

- Which commands exist?
- Which hooks are active?
- Which skills should be available?
- Which subagents belong to the project?
- What does a new contributor need to install before using the AI-assisted workflow?

Functional purpose:

- Make project workflows discoverable.
- Package commands and skills for repeated use.
- Help new contributors understand how AeroCap expects AI-assisted development to work.
- Reduce setup drift between team members.
- Make the AI development process auditable and explainable.

In short, `plugins/` is not product runtime code. It is development infrastructure: the packaging layer for the project's AI-assisted engineering workflow.

## 7. Compliance Layer

The `compliance/` folder is the living control library for privacy, retention, and regulatory data handling. It gives the compliance-auditor, security-auditor, backend developers, and reviewers a shared source of truth for how personal data must be classified and retained.

Important files:

- `compliance/pii-inventory.md`
- `compliance/retention-policy.md`

### compliance/pii-inventory.md

The PII inventory is AeroCap's record of sensitive and personal data fields. It acts like a practical Record of Processing Activities for engineering work.

It documents:

- Data subjects, including pilots, instructors/examiners, and airline contacts.
- Personal data fields, such as name, email, date of birth, nationality, passport number, licence number, medical certificate data, competency grades, examiner notes, and IP addresses.
- Sensitivity level for each field.
- Applicable legal frameworks: GDPR, PIPL, DPDP, CCPA, and POPIA.
- Retention period.
- Erasure strategy, such as pseudonymise, hard delete, retain regulatory data, replace with `[ERASED]`, or null the field.
- Processing activities and legal bases.
- Sub-processors such as AWS, N8N, or email providers.
- Cross-border transfer mechanisms and unresolved transfer gaps.

The document also defines the expected SQL comment format for new PII fields:

```sql
COMMENT ON COLUMN table.column IS
  'PII:{LOW|MEDIUM|HIGH|SPECIAL} | Laws:{GDPR|PIPL|DPDP|CCPA|POPIA} | Retention:{period} | Erasure:{delete|pseudonymise|retain-regulatory}';
```

Functional role:

- Before adding a new personal data field, check this inventory.
- If the field is new, add it to the inventory.
- Tag the field with compliance metadata.
- Ask the `compliance-auditor` to review the change.

### compliance/retention-policy.md

The retention policy defines how long AeroCap keeps each data category and what happens at the end of that period.

It documents:

- Pilot identity PII retention.
- CBTA grades and examiner-note retention.
- Medical certificate and licence retention.
- Training session retention.
- Login/session log retention.
- Audit log retention.
- Marketing consent and email-log retention.
- Booking and reservation retention.
- Financial/invoice retention.
- Jurisdiction-specific notes for PIPL, DPDP, CCPA, and POPIA.

It also explains how to resolve the conflict between erasure rights and aviation regulatory retention. For example, a pilot may request erasure, but CBTA and training session records may still need to be retained for regulatory reasons. The expected answer is usually pseudonymisation: remove or replace personal identifiers while preserving the structural record needed for inspection.

Functional role:

- Product owners use it to understand whether a feature creates long-lived records.
- Backend developers use it to design deletion and pseudonymisation workflows.
- Reviewers use it to check whether hard deletes are allowed.
- Compliance auditors use it as the baseline for privacy review.
- Reporting features use it to decide what evidence may be retained or exported.

### How compliance/ supports development

The compliance folder turns legal and regulatory requirements into engineering checks:

- Does this schema add PII?
- Which laws apply to this tenant and field?
- Can this field be deleted, or must it be retained?
- Does erasure mean deletion or pseudonymisation?
- Does the API response return more data than needed?
- Does a cross-border transfer require review?
- Are audit logs retained long enough?

For AeroCap, this is especially important because training records are both personal data and regulatory evidence. The platform must respect privacy rights while still keeping inspectable aviation records.

## 8. How They Worked Together

### Example: simulator time management

1. `spec-generator` defines entities, database schema, and OpenAPI.
2. `training-management` validates aviation and simulator-operation rules.
3. `backend-developer` implements schedule-service endpoints.
4. `test-runner` adds availability, blocked-period, and role tests.
5. `code-reviewer` checks tenant isolation and route correctness.
6. `security-auditor` reviews auth and privileged schedule operations.
7. `compliance-auditor` checks personal data and audit implications.
8. Hooks provide guardrails while files are edited and commands are run.
9. Skills keep the work aligned with tenant, audit, and API rules.
10. `compliance/` confirms whether generated records need retention, pseudonymisation, or audit treatment.

### Example: geo-tenancy and data residency

1. `compliance-auditor` identifies GDPR, PIPL, DPDP, and POPIA concerns.
2. `spec-generator` converts country isolation into API/data requirements.
3. `backend-developer` maps regions to tenants.
4. `frontend-developer` builds country signup and company switching.
5. `code-reviewer` checks that queries use active tenant from JWT.
6. Skills reinforce that `tenantId` never comes from the body.
7. `compliance/` records why data must remain regionally scoped and what happens when personal data is retained or erased.
8. `plugins/` packages the same rules and workflow so other team members can reproduce them.

## 9. Recommended Usage By Task

| Task | Recommended support |
|---|---|
| New API or service | `spec-generator`, then `backend-developer`, then `test-runner` |
| New UI page | `frontend-developer`, then `code-reviewer` |
| Pilot PII change | Check `compliance/`, then `compliance-auditor`, `security-auditor`, `code-reviewer` |
| Booking or simulator rule | `training-management`, `backend-developer`, `test-runner` |
| Unknown code area | `explorer`, then the relevant specialist |
| Pre-release review | `security-auditor` and `compliance-auditor` in parallel |
| Merge readiness | `code-reviewer` |
| New team setup | Check `plugins/manifest.json` and `plugins/team.install` |
| Data retention or erasure | Check `compliance/retention-policy.md`, then `compliance-auditor` |

## 10. Known Limitations

The support layer improves consistency, but it does not guarantee correctness by itself.

Current limitations:

- Hooks are local guardrails, not a full CI/CD pipeline.
- Some project rules are stricter than the current implementation.
- OpenAPI files are expected but not yet present per service.
- Auth and role definitions still need consolidation into shared code.
- Compliance advice must be validated by legal/compliance owners before production.
- Generated tests must be run against clean, isolated databases.
- `plugins/` explains and packages the workflow, but does not enforce runtime product behavior.
- `compliance/` documents required controls, but implementation still needs tests, CI checks, and legal sign-off.

## 11. Future Improvements

Recommended next steps:

- Add CI jobs that enforce the same checks as the hooks.
- Create shared packages for auth, roles, API envelopes, and tenant helpers.
- Add `services/<service>/openapi.yaml` for every service.
- Add a tenant-isolation scanner that searches for unscoped SQL queries.
- Add compliance metadata to PII schema fields.
- Add release checklists that require security and compliance sign-off.
- Move hook behavior into versioned scripts that can run locally and in CI.
- Add an automated check that new PII fields are present in `compliance/pii-inventory.md`.
- Add a release gate that checks retention workflows against `compliance/retention-policy.md`.
- Make `plugins/team.install` install or verify all required hooks and command files.

## 12. Summary

The agents, hooks, and skills form AeroCap's development operating system.

Subagents provide specialist judgment. Skills provide standing project rules. Hooks provide immediate safety feedback. Plugins package the workflow for reuse. Compliance docs turn privacy and retention obligations into engineering controls.

Together, they helped the project grow as a regulated, multi-tenant training platform instead of a loose collection of services.

The most important rule they reinforce is simple:

Every feature must preserve tenant isolation, protect pilot data, and produce evidence that an aviation inspector can trust.
