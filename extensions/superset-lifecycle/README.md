# superset-lifecycle

Pi extension that notifies a local Superset hook endpoint when Pi work starts and stops.

## What it does

Verified from `extensions/superset-lifecycle/index.ts`:

- Detects whether Pi is running inside a Superset terminal by checking:
  - `SUPERSET_PANE_ID`
  - `SUPERSET_TAB_ID`
  - `SUPERSET_WORKSPACE_ID`
- Reads hook configuration from environment variables:
  - `SUPERSET_PORT`
  - `SUPERSET_ENV`
  - `SUPERSET_HOOK_VERSION`
  - `SUPERSET_DEBUG_HOOKS`
- Sends HTTP `GET` requests to `http://127.0.0.1:<SUPERSET_PORT>/hook/complete`
- Includes available Superset identifiers plus an `eventType` query parameter
- Emits:
  - `Start` when the first agent starts
  - `Stop` when the last active agent ends
  - `Stop` again on session shutdown if work was still active

## When it stays inactive

The extension returns early and does nothing when either condition is true:

- Pi was started with `--no-session`
- The process is a subagent run (`PI_SUBAGENT_DEPTH > 0`)

It also skips requests when it is not in a Superset terminal or `SUPERSET_PORT` is missing.

## Debug behavior

If `SUPERSET_DEBUG_HOOKS` is truthy, failed requests and non-OK responses are logged with `console.warn`.

Values `0` and `false` are treated as false; any other defined value enables debug logging.

## Practical use

Use this extension when Pi is embedded in a Superset-driven terminal environment and another local process wants simple start/stop lifecycle signals.

This repo verifies the hook shape and environment variables above. It does not include separate Superset-side setup instructions.
