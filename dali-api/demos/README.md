# Demos

Scripted Playwright recordings of a UI change. Record them locally (below) to get an mp4 of a change.

## Writing a demo

```ts
import { expect, setFeatureFlag, test } from './lib/demo';

test('what this shows', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('my-flag', true); // flag rows are cached 15s: wrap the first goto in expect(...).toPass()
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
  await page.goto('/somewhere');
  await stage.click(page.getByRole('button', { name: 'New' }));
  await stage.type(page.getByLabel('Title'), 'Hello');
  await stage.zoomTo(page.getByRole('dialog'));
  await stage.resetZoom();
});
```

`./lib/demo` extends the e2e fixtures (`loginAs`, seeded users, launch-welcome dismissed). Viewport is fixed at 1280x720. Never `waitForLoadState('networkidle')` after the first login: SSE and websockets never settle. Keep it to 15-20 seconds; the target is under 3 MB.

`stage` helpers:

| Helper | What it does |
|---|---|
| `moveTo(locator, ms?)` | Eases the real mouse to the element; the injected cursor follows |
| `click(locator)` | `moveTo`, a short beat, then a real click with a ripple |
| `type(locator, text, delayMs?)` | Click the field, then type one character at a time |
| `zoomTo(locator, scale?, ms?)` | Smoothly zooms the page (CSS transform on `<html>`) around the element |
| `resetZoom(ms?)` | Zooms back out |
| `pause(ms)` | Holds the frame |

## Running locally

Needs the e2e setup (seeded Postgres, `DATABASE_URL`, `JWT_SECRET`) and `ffmpeg` on the PATH.

```sh
npx playwright test -c playwright.demos.config.ts demos/<name>.demo.ts
npx tsx demos/lib/encode.ts   # demo-results/*.webm -> demo-out/<name>.mp4 + <name>.jpg
```

`demo-results/` and `demo-out/` are gitignored.
