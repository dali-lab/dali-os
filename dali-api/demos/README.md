# Demos

Scripted Playwright recordings of a UI change. A PR that changes what members see can add `demos/<name>.demo.ts`; CI records it, encodes an mp4, uploads it to `release-notes/pr-<N>/<name>.mp4`, and the release-notes draft job attaches it to the drafted entry. Spec: `specs/release-notes.md`.

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

`./lib/demo` extends the e2e fixtures (`loginAs`, seeded users, launch-welcome dismissed) and sets `dali_tabless=1`, so pages render directly like they do for real users (no workspace iframe). Viewport is fixed at 1280x720. Never `waitForLoadState('networkidle')` after the first login: SSE and websockets never settle. Keep it to 15-20 seconds; the target is under 3 MB.

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

## In CI

`.github/workflows/demo-capture.yml` runs on PRs that touch `dali-api/demos/`. It records only the `.demo.ts` files the PR changed (all of them if only `lib/` changed), uploads `demo-out/` as the `demo-videos` artifact, and upserts one PR comment. S3 upload happens when the `RELEASE_NOTES_AWS_ACCESS_KEY_ID` and `RELEASE_NOTES_AWS_SECRET_ACCESS_KEY` secrets and a bucket (`RELEASE_NOTES_S3_BUCKET` variable or secret; region from the `AWS_REGION` variable, default `us-east-1`) exist. Otherwise it is skipped and the artifact is the only copy.
