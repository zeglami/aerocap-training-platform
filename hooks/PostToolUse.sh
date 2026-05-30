#!/bin/bash
# Runs after every Write or Edit tool call.
# Auto-lints TypeScript files and runs affected tests.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null)

FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {})
    print(ti.get('file_path', ''))
except:
    print('')
" 2>/dev/null)

if [ "$TOOL_NAME" != "Write" ] && [ "$TOOL_NAME" != "Edit" ]; then
  exit 0
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# --- Auto-lint TypeScript/TSX files ---
if echo "$FILE_PATH" | grep -qE "\.(ts|tsx)$"; then
  if command -v npx &>/dev/null && [ -f "$(dirname "$FILE_PATH")/../../node_modules/.bin/eslint" -o -f "node_modules/.bin/eslint" ]; then
    echo "[PostToolUse] Linting $FILE_PATH..."
    npx eslint --fix "$FILE_PATH" 2>/dev/null && echo "[PostToolUse] Lint passed." || echo "[PostToolUse] Lint warnings — review before committing."
  fi
fi

# --- Run co-located tests if a test file exists ---
TEST_FILE="${FILE_PATH%.ts}.test.ts"
if [ -f "$TEST_FILE" ]; then
  if command -v npx &>/dev/null; then
    echo "[PostToolUse] Running tests for $(basename "$TEST_FILE")..."
    npx jest "$TEST_FILE" --passWithNoTests 2>/dev/null \
      && echo "[PostToolUse] Tests passed." \
      || echo "[PostToolUse] Tests failed — fix before committing."
  fi
fi

# --- Remind about OpenAPI sync on handler changes ---
if echo "$FILE_PATH" | grep -q "/handlers/"; then
  SERVICE_DIR=$(echo "$FILE_PATH" | sed 's|/src/handlers/.*||')
  if [ ! -f "$SERVICE_DIR/openapi.yaml" ]; then
    echo "[PostToolUse] No openapi.yaml found for this service. Run /openapi-spec to generate it."
  fi
fi

exit 0
