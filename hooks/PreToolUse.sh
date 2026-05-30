#!/bin/bash
# Runs before every Bash tool call. Blocks dangerous operations.
# Exit 2 = block the action and show message to Claude.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_name', ''))
except:
    print('')
" 2>/dev/null)

COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except:
    print('')
" 2>/dev/null)

if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# --- Block destructive filesystem ops ---
if echo "$COMMAND" | grep -qE "rm\s+-rf\s+/|rm\s+-rf\s+\.\s*$|rm\s+-rf\s+\*"; then
  echo "BLOCKED [PreToolUse]: Recursive delete from root or cwd is not allowed. Specify the exact path." >&2
  exit 2
fi

# --- Block DB destructive ops ---
if echo "$COMMAND" | grep -qiE "DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+TABLE"; then
  echo "BLOCKED [PreToolUse]: Destructive DB operation requires explicit user confirmation. Do not run this automatically." >&2
  exit 2
fi

# --- Block force push ---
if echo "$COMMAND" | grep -qE "git push.*(--force|-f)(\s|$)"; then
  echo "BLOCKED [PreToolUse]: Force push requires explicit user confirmation. Ask the user before proceeding." >&2
  exit 2
fi

# --- Block hard reset ---
if echo "$COMMAND" | grep -qE "git reset --hard"; then
  echo "BLOCKED [PreToolUse]: git reset --hard will discard uncommitted work. Ask the user to confirm first." >&2
  exit 2
fi

# --- Block production env operations ---
if echo "$COMMAND" | grep -qiE "AWS_PROFILE=prod|--profile prod|--env prod|NODE_ENV=production"; then
  echo "BLOCKED [PreToolUse]: Direct production environment operations are not allowed from this session. Use the CI/CD pipeline." >&2
  exit 2
fi

# --- Warn on .env file modification ---
if echo "$COMMAND" | grep -qE "(echo|cat|tee|write).*(\.env|secrets|credentials)"; then
  echo "BLOCKED [PreToolUse]: Do not write secrets to .env files or disk. Use AWS Secrets Manager. Ask the user how to proceed." >&2
  exit 2
fi

exit 0
