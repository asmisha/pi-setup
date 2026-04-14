# bash-output-guard

Pi extension that caps `bash` tool result text before it lands in session context.

## What it does

Verified from `extensions/bash-output-guard/index.ts`:

- intercepts `tool_result` events for the built-in `bash` tool
- truncates large text output to at most 160 lines and 12 KB
- appends a short note telling the agent to rerun with explicit filters or redirect to a temp file plus `read` when more output is needed
- leaves non-`bash` tools and already-small `bash` results unchanged

## Placement

The implementation lives at:

- `extensions/bash-output-guard/index.ts`

This repo's Pi settings already load the repo-level `extensions/` directory, so the guard is discovered with the other project extensions.

## Practical use

Use this extension when long shell-heavy sessions are compacting too often because `bash` tool results are consuming too much context. It is a hard backstop for prompt guidance, not a replacement for bounded commands.
