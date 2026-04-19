---
name: ui-debug
description: Debug UI issues in a browser with Playwright-backed pi tools. Use when you need to open a page, inspect its current state, click/type/wait through flows, capture screenshots, or run small DOM probes while debugging a frontend issue.
---

# UI Debug

Use the Playwright-backed browser tools to reproduce UI issues and inspect the current page state from inside pi.

## Context preservation rule

Preserve the main agent thread's context window at all costs.

When using this skill, the main thread should act as the coordinator and should **delegate all browser-heavy work to subagents**. That includes anything involving:
- opening or controlling the browser
- page snapshots or HTML/DOM inspection
- screenshot capture or screenshot analysis
- repeated click/type/wait flows
- reading large chunks of rendered page state
- any iterative probing that could produce lots of output

Do **not** perform Playwright browser actions directly in the main thread unless there is no subagent capability available. The default pattern is:
1. main thread defines the debugging question
2. subagent performs the browser manipulation / inspection work
3. subagent returns a concise summary with only the evidence needed by the main thread
4. if the subagent needs to preserve large raw artifacts, it should write them to unique files in the system temp dir and return only the file paths
5. main thread decides the next step or launches another focused subagent

Prefer multiple small, focused subagent runs over one long browser session in the main thread. If you need to inspect several hypotheses, spawn separate subagents so each one can explore a narrow question and return compressed findings.

## Setup

For Playwright browser installation and one-time setup, see:
- `extensions/playwright-browser/README.md`

After setup, run `/reload` so pi discovers the new extension.

## When to use this skill

Use this skill when the task involves:
- reproducing a frontend bug in a browser
- validating a UI fix with screenshots
- inspecting forms, buttons, links, and visible page text
- stepping through a small interaction flow
- running a targeted DOM probe for debugging

## Browser workflow

Run this workflow inside a subagent whenever possible.

1. Make sure the target app or page is reachable.
2. Start with `browser_open` on the target URL.
3. Use `browser_snapshot` immediately to inspect the current page state.
4. Use `browser_screenshot` when visual evidence matters.
5. Use `browser_click`, `browser_type`, and `browser_wait` to reproduce the flow.
6. Use `browser_eval` only for small targeted checks that are hard to read from the snapshot.
7. Re-run `browser_snapshot` or `browser_screenshot` after each meaningful interaction.
8. Compress findings before returning: summarize the relevant DOM state, errors, visual regressions, and reproduction result instead of pasting large raw outputs back into the parent thread.
9. If large raw artifacts must be preserved without summarization, write them to unique files in the system temp dir and return the file paths instead of inlining them in the parent thread. This includes screenshots, screenshot analyses, long HTML/DOM extracts, and other bulky evidence.
10. When done, call `browser_close` so the next task starts from a clean browser state.

## Tool guide

- `browser_open`: open a fresh browser session and navigate to a URL
- `browser_snapshot`: return a readable summary of the current page state
- `browser_click`: click an element by selector
- `browser_type`: type or fill text into an element by selector
- `browser_wait`: wait for time to pass or for an element state change
- `browser_eval`: run a small JavaScript expression in the page context
- `browser_screenshot`: capture the current page as an image
- `browser_close`: close the current browser session

## Working style

- Prefer stable selectors (`#id`, `[data-testid=...]`, `[name=...]`) over brittle text-only selectors.
- Start with the smallest interaction needed to prove the bug.
- If a page changes after an action, wait explicitly before concluding it is broken.
- Treat screenshots and snapshots as evidence; report observed behavior, not guesses.
- Keep raw browser output out of the parent thread whenever possible. Subagents should return concise findings, relevant selectors, short excerpts, and file/artifact references rather than dumping long HTML or repeated snapshots.
- If a subagent must preserve large unsummarized outputs, store them in unique files in the system temp dir and return only the filenames / file paths. Use this for screenshots, image analyses, long HTML/DOM dumps, accessibility extracts, or any other bulky evidence.
- If HTML/DOM inspection is needed, extract only the specific nodes, attributes, or text relevant to the hypothesis being tested.
- If screenshot review is needed, have the subagent describe only the important visual differences or failures.
- If the browser tools are unavailable, check setup, then run `/reload`.
