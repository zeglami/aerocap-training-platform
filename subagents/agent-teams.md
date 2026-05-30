# AeroCap — Agent Teams
# Parallel execution patterns for multi-agent workflows
# Reference this file when orchestrating multiple subagents simultaneously

## What are Agent Teams?

Agent Teams run multiple subagents in parallel, each in its own isolated context window.
Results are collected and synthesised in the main session.
Use when tasks are independent and would benefit from concurrent execution.

---

## Team Patterns for AeroCap

### Team: New Feature Pipeline
Run all 4 agents in parallel once the OpenAPI spec is approved.

```
Feature description
       │
       ▼
  spec-generator         ← write spec first, alone
       │
  ┌────┴────────────────────────────────┐
  │             PARALLEL                │
  ▼             ▼            ▼          ▼
code-gen    test-runner  frontend   compliance
(backend)   (jest tests) (UI layer)  auditor
  │             │            │          │
  └────┬────────────────────────────────┘
       │
       ▼
  code-reviewer          ← gate: reviews all outputs
       │
       ▼
    MERGE
```

How to invoke in Claude Code:
> Spawn spec-generator for the booking feature, then in parallel spawn code-reviewer, test-runner, and frontend-developer once the spec is approved.

---

### Team: Full Compliance Sweep (pre-release gate)
Run security and compliance audits simultaneously before any production deploy.

```
┌─────────────────────┬──────────────────────┐
│   security-auditor  │  compliance-auditor   │
│   (OWASP + auth)    │  (GDPR/PIPL/DPDP/    │
│                     │   CCPA/POPIA)         │
└──────────┬──────────┴──────────┬────────────┘
           │      PARALLEL       │
           └─────────┬───────────┘
                     ▼
             Combined report
             PASS / FAIL / FIX
```

Use before: any production deployment, any change touching pilot PII, any new API endpoint.

---

### Team: Codebase Audit
Explorer maps the unknown territory, reviewer assesses what it finds.

```
┌──────────────────────────────────────┐
│            PARALLEL                  │
│  explorer          code-reviewer     │
│  "find all places  "review the       │
│  we query pilots   tenant isolation  │
│  without tenant    in these files"   │
│  filter"                             │
└──────────┬───────────────────────────┘
           │
           ▼
     Consolidated findings
```

---

### Team: New Microservice Build
Full parallel generation once domain is scoped.

```
spec-generator
     │
     ▼ (spec approved)
┌────┴──────────────────────────────┐
│              PARALLEL             │
▼              ▼           ▼        ▼
backend      migrations  tests  openapi
handler+     SQL files   jest   sync
service+
repository
└────┬──────────────────────────────┘
     ▼
code-reviewer + security-auditor (parallel)
     ▼
DONE
```

---

## Message Passing Between Agents

Agents do not share state automatically. Pass output explicitly in the next agent's prompt.

Pattern:
```
1. Run spec-generator → copy the OpenAPI spec output
2. Pass the spec as context to code-reviewer:
   "Review this OpenAPI spec for AeroCap compliance: [PASTE SPEC]"
3. Pass the spec to frontend-developer:
   "Build the React form for this endpoint: [PASTE SPEC ENDPOINT]"
```

---

## Shared State via Files

For longer pipelines, write intermediate outputs to files so agents can read them:

```
compliance/current-audit.md     ← compliance-auditor writes findings here
compliance/dpia/feature-X.md    ← DPIA document for new feature
.claude/review-notes.md         ← code-reviewer writes notes here
```

Each subsequent agent reads the file rather than receiving a long context paste.

---

## When NOT to Use Agent Teams

- Simple single-file edits → do inline, no subagent needed
- Sequential dependencies (A must finish before B starts) → run sequentially, not parallel
- Short questions ("what does this function do?") → answer directly
- When the main context already has all the information → no need to isolate

Rule of thumb: spawn a subagent when the task would consume >20 tool calls or >500 lines of output.
