#!/bin/bash
# Runs at the start of every Claude Code session.
# Prints project context and validates the dev environment.

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         AeroCap — Agent Development Kit              ║"
echo "║         Multi-tenant Pilot Training SaaS             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Stack: TypeScript · Next.js · AWS (Aurora, EventBridge, Cognito)"
echo "Regions: France · South Africa · China · India"
echo ""

# --- Environment checks ---
echo "── Environment ─────────────────────────────────────────"

NODE_VERSION=$(node --version 2>/dev/null || echo "NOT FOUND")
echo "  Node.js : $NODE_VERSION"

NPM_VERSION=$(npm --version 2>/dev/null || echo "NOT FOUND")
echo "  npm     : $NPM_VERSION"

GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "not a git repo")
echo "  Branch  : $GIT_BRANCH"

if [ -f ".env.local" ]; then
  echo "  .env    : .env.local found"
else
  echo "  .env    : not found (use AWS Secrets Manager for secrets)"
fi

echo ""

# --- Available skills ---
echo "── Skills ───────────────────────────────────────────────"
echo "  /generate-microservice   Scaffold a new domain microservice"
echo "  /cbta-schema             Generate CBTA evaluation schema"
echo "  /openapi-spec            Generate OpenAPI 3.0 spec"
echo "  /review-tenant-isolation Audit multi-tenant data isolation"
echo ""

# --- Active services ---
echo "── Services ─────────────────────────────────────────────"
for dir in services/*/; do
  if [ -d "$dir" ]; then
    echo "  ✓ $(basename $dir)"
  fi
done
if [ ! -d "services" ]; then
  echo "  (none yet — run /generate-microservice to scaffold your first service)"
fi
echo ""

# --- Guardrails reminder ---
echo "── Guardrails active ────────────────────────────────────"
echo "  PreToolUse  : blocks rm -rf, DROP TABLE, force push, prod ops"
echo "  PostToolUse : auto-lint TS, run co-located tests on write"
echo ""
echo "Ready. What are we building today?"
echo ""
