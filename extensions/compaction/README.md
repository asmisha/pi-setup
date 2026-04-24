# compaction

A small Pi extension that only triggers compaction earlier than Pi's default policy.

By default it watches context usage at `turn_end` and calls `ctx.compact()` once usage crosses **65%**, passing the repo's local advisory focus as `customInstructions`.

It does **not** own compaction content, routing, task tracking, UI widgets, or durable task state.

## Safety

This extension is always on when loaded.

## What it changes

- `turn_end` watches context usage and requests compaction after crossing 65%.
- `session_start` and `session_tree` reset the threshold detector.
- `session_compact` clears in-flight state and starts the cooldown timer.
- The extension does not register `session_before_compact`.
- The extension passes this custom focus to Pi's built-in compaction:
  `Generate a concise structured advisory for the discarded conversation span. Keep durable task-tracker state separate from the compaction summary.`
- The extension does not provide a local summary prompt or compaction result.

## Interaction with compactor packages

Actual compaction content is controlled by whichever Pi extension is loaded and handles `session_before_compact`, for example VCC or LCM. Those extensions will also see the `customInstructions` passed by this threshold trigger.

Recommended clean architecture for comparing compactors:

- run one Pi session/config with the VCC extension loaded;
- run another Pi session/config with the LCM extension loaded;
- keep this extension loaded in both if you want both sessions to compact at the same 65% threshold.

If no compactor extension handles `session_before_compact`, Pi falls back to its built-in compaction behavior.

If multiple compactor extensions are loaded in the same session and more than one returns a compaction result, Pi extension ordering determines the effective result. This extension intentionally does not try to route or arbitrate that.

## Structure

- `index.ts` — lifecycle wiring and threshold-triggered `ctx.compact()` call
- `src/config.ts` — threshold and timing configuration
- `src/turn-end-policy.ts` — pure threshold/cooldown policy
- `test/*.test.ts` — focused config and threshold policy tests

## Tests

Run from this directory:

```bash
npm test
```
