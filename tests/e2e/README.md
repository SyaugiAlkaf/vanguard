# Vanguard end-to-end tests

Browser-driven tests of the Hearth app. Gated behind a separate npm script (`npm run test:e2e`) so reviewers don't need a ~200 MB Chromium download just to run the unit suite.

## What's in here

- `hearth_browser.mjs` — drives a real Chromium against a freshly-spawned Hearth instance in dev mode. Asserts that:
  - the brand and status render
  - typing an INJECTION attack produces a red `[block]` verdict badge
  - a JAILBREAK attack also blocks, counters tick
  - a benign Long COVID question produces a green `[allow]` and increments the allowed counter
  - the recent-blocks panel populates
  - the "try an attack" button fills the input
  - the "export" button triggers a download with a date-stamped JSON filename
  - the `/api/status` endpoint reflects the right `meshActive`, `blockedCount`, `allowedCount`
- Saves three screenshots into `artifacts/screenshots/`:
  - `hearth-01-initial.png` — empty UI right after boot
  - `hearth-02-blocked.png` — two attacks blocked
  - `hearth-03-final.png` — full session with allow + block history visible

## Run it

```
npm install --no-save playwright
npx playwright install chromium
npm run test:e2e
```

First run downloads Chromium (~200 MB once, cached in `~/Library/Caches/ms-playwright`). Subsequent runs are fast.

## What it does NOT cover

- The full real-mode pipeline (Qwen3-1.7B + MedGemma 4B). Dev mode runs heuristic + mesh only. To verify the LoRA path in a browser, boot Hearth manually with `npm run hearth` and exercise it visually.
- Mobile / Pear runtime. That's the next track if we build the mobile app.

## Where the unit tests live

The 254-case unit + integration suite is in `tests/*.mjs` (15 files). Those run in `npm test` and don't need Chromium. The Hearth server is also covered by `tests/test_hearth_server.mjs` at the HTTP layer (no real browser); this e2e file is the layer above.
