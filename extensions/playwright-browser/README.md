# playwright-browser

Playwright-backed browser tools for pi.

## One-time setup

Install the extension dependency and Chromium browser:

```bash
cd /Users/asmisha/Projects/pi-setup/extensions/playwright-browser
npm install --package-lock=false
npx playwright install chromium
```

After setup, restart pi or run `/reload` so the extension is discovered.

## What this extension provides

This extension exposes browser tools for:
- opening a page in a fresh browser session
- capturing page snapshots
- clicking, typing, and waiting through flows
- running small page-context evaluations
- taking screenshots
- closing the browser session

## Notes

- The `playwright` package must be installed in this extension directory.
- Chromium must be installed via `npx playwright install chromium`.
- If the tools fail to load, rerun the setup commands above and then restart pi or run `/reload`.
