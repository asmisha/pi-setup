---
name: ui-debug
description: Debug UI issues in a browser with Playwright-backed pi tools. Use when you need to open a page, inspect its current state, click/type/wait through flows, capture screenshots, or run small DOM probes while debugging a frontend issue.
---

# UI Debug

Use the Playwright-backed browser tools to reproduce UI issues and inspect the current page state from inside pi.

## One-time setup

Install the extension dependency and Chromium browser:

```bash
cd ../../extensions/playwright-browser
npm install --package-lock=false
npx playwright install chromium
```

After setup, run `/reload` so pi discovers the new extension.

## When to use this skill

Use this skill when the task involves:
- reproducing a frontend bug in a browser
- validating a UI fix with screenshots
- inspecting forms, buttons, links, and visible page text
- stepping through a small interaction flow
- running a targeted DOM probe for debugging

## Browser workflow

1. Make sure the target app or page is reachable.
2. Start with `browser_open` on the target URL.
3. Use `browser_snapshot` immediately to inspect the current page state.
4. Use `browser_screenshot` when visual evidence matters.
5. Use `browser_click`, `browser_type`, and `browser_wait` to reproduce the flow.
6. Use `browser_eval` only for small targeted checks that are hard to read from the snapshot.
7. Re-run `browser_snapshot` or `browser_screenshot` after each meaningful interaction.
8. When done, call `browser_close` so the next task starts from a clean browser state.

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
- If the browser tools are unavailable, check setup, then run `/reload`.
