# ADR-007: AI-Assisted Development Kit

Status: Accepted  
Date: 2026-05-30

## Context

AeroCap uses AI-assisted development assets:

- `CLAUDE.md`
- `skills/`
- `subagents/`
- `hooks/`
- `plugins/`
- `compliance/`

These assets encode project rules, safety checks, specialist workflows, and compliance expectations.

## Decision

AeroCap treats the AI-assisted development kit as part of the engineering operating model.

It is not runtime product code, but it supports:

- Consistent feature design.
- Tenant isolation review.
- Compliance review.
- Security review.
- Test generation.
- Safer command execution.
- Onboarding through plugin metadata.

## Consequences

Benefits:

- New contributors get project rules quickly.
- Repeated decisions are documented and reusable.
- Safety hooks reduce accidental destructive commands.
- Specialist subagents keep regulated-domain work focused.

Trade-offs:

- The support layer must be maintained as architecture changes.
- Hooks are not a replacement for CI.
- Compliance guidance still requires human legal/compliance review.
- Generated code and tests still need engineering ownership.

Required controls:

- Keep docs, skills, and hooks aligned with actual implementation.
- Promote important project choices into ADRs.
- Add CI checks for rules currently only suggested by hooks.
