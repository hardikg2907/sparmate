#!/bin/sh
set -e

# Read OAuth token from config volume when not set in environment
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  for token_path in /home/node/.claude/oauth_token /home/node/.claude/token /home/node/.config/sparmate/token; do
    if [ -f "$token_path" ] && [ -s "$token_path" ]; then
      export CLAUDE_CODE_OAUTH_TOKEN="$(cat "$token_path" | tr -d '\r\n')"
      break
    fi
  done
fi

# Pass through to specified command or default server startup
if [ "$#" -eq 0 ]; then
  exec npx tsx src/server/index.ts
else
  exec "$@"
fi
