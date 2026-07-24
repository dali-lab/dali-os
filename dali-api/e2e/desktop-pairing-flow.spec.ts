import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';

// End-to-end desktop device pairing: start → approve in browser → poll →
// keychain token + handoff → plant webview cookie. Mirrors the structure of
// mcp-auth-flow.spec.ts. The poll endpoint throttles a single device to one
// request / 3s (the `slow_down` signal the real app honors), so polling helpers
// wait past that window between attempts.

const DEVICE_LABEL = 'MacBook Pro · macOS';
const SLOW_DOWN_WAIT_MS = 3200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollOnce(request: APIRequestContext, deviceCode: string) {
  const res = await request.post('/auth/pair/poll', { data: { deviceCode } });
  expect(res.ok()).toBe(true);
  return res.json();
}

// Poll until `wanted` status (skipping pending/slow_down), respecting the
// per-device throttle.
async function pollUntil(
  request: APIRequestContext,
  deviceCode: string,
  wanted: string,
  timeoutMs = 30_000,
) {
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeoutMs) {
    const body = await pollOnce(request, deviceCode);
    last = body;
    if (body.status === wanted) return body;
    await sleep(SLOW_DOWN_WAIT_MS);
  }
  throw new Error(`poll never reached "${wanted}"; last=${JSON.stringify(last)}`);
}

test('desktop pairing: full happy path + handoff single-use', async ({
  page,
  loginAs,
  request,
}) => {
  // 1) App starts pairing (unauthenticated).
  const startRes = await request.post('/auth/pair/start', {
    data: { deviceLabel: DEVICE_LABEL },
  });
  expect(startRes.ok()).toBe(true);
  const start = await startRes.json();
  expect(start.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(start.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  expect(start.verificationUrl).toContain(`/link?code=`);

  // 2) First poll → pending (no approval yet).
  const pending = await pollOnce(request, start.deviceCode);
  expect(pending.status).toBe('pending');

  // 3) User signs in normally and lands on the /link approval page.
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  await page.goto(`/link?code=${encodeURIComponent(start.userCode)}`);
  await expect(
    page.getByRole('heading', { name: /Approve this device\?/ }),
  ).toBeVisible();
  await expect(page.getByText(DEVICE_LABEL)).toBeVisible();
  await expect(page.getByText(start.userCode)).toBeVisible();

  // 4) Approve (posted in the authenticated web session; page.request shares
  //    the logged-in cookie jar).
  const approveRes = await page.request.post('/auth/pair/approve', {
    form: { intent: 'approve', userCode: start.userCode },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(approveRes.status()).toBeGreaterThanOrEqual(300);
  expect(approveRes.status()).toBeLessThan(400);
  expect(approveRes.headers()['location']).toContain('result=approved');

  // 5) Poll again → approved, with the keychain desktop token + handoff code.
  const approved = await pollUntil(request, start.deviceCode, 'approved');
  expect(approved.desktopToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(approved.handoffCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(approved.handoffUrl).toContain('/auth/handoff?code=');
  expect(typeof approved.absoluteExpiresAt).toBe('string');

  // 6) The desktop token is a real Bearer-capable session (a plain session, not
  //    a grant) — it authenticates against a requireAuth-gated resource route.
  const notifRes = await request.get('/api/notifications', {
    headers: { Authorization: `Bearer ${approved.desktopToken}` },
  });
  expect(notifRes.ok()).toBe(true);
  const notif = await notifRes.json();
  expect(typeof notif.unreadCount).toBe('number');

  // 7) Redeem the handoff in the "webview" → 302 to / with a fresh __dali_sid.
  const handoffRes = await request.get(
    `/auth/handoff?code=${encodeURIComponent(approved.handoffCode)}`,
    { maxRedirects: 0, failOnStatusCode: false },
  );
  expect(handoffRes.status()).toBe(302);
  expect(handoffRes.headers()['location']).toBe('/');
  expect(handoffRes.headers()['set-cookie']).toContain('__dali_sid');

  // 8) Handoff is single-use → second redeem fails to /login.
  const reuseRes = await request.get(
    `/auth/handoff?code=${encodeURIComponent(approved.handoffCode)}`,
    { maxRedirects: 0, failOnStatusCode: false },
  );
  expect(reuseRes.status()).toBe(302);
  expect(reuseRes.headers()['location']).toContain('handoff_invalid');

  // 9) Re-poll after consume → already_used (no second token minted).
  await sleep(SLOW_DOWN_WAIT_MS);
  const after = await pollOnce(request, start.deviceCode);
  expect(after.status).toBe('already_used');
});

test('desktop pairing: cancel → denied, unknown code → expired, version feed', async ({
  page,
  loginAs,
  request,
}) => {
  // Cancel path.
  const startRes = await request.post('/auth/pair/start', {
    data: { deviceLabel: DEVICE_LABEL },
  });
  const start = await startRes.json();

  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  const cancelRes = await page.request.post('/auth/pair/approve', {
    form: { intent: 'cancel', userCode: start.userCode },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(cancelRes.headers()['location']).toContain('result=cancelled');

  const denied = await pollOnce(request, start.deviceCode);
  expect(denied.status).toBe('denied');

  // Unknown deviceCode → expired (no enumeration signal).
  const unknown = await pollOnce(request, 'definitely-not-a-real-device-code');
  expect(unknown.status).toBe('expired');

  // Min/latest shell version feed.
  const verRes = await request.get('/api/desktop/version');
  expect(verRes.ok()).toBe(true);
  expect(verRes.headers()['cache-control']).toContain('max-age=300');
  const ver = await verRes.json();
  expect(typeof ver.minVersion).toBe('string');
  expect(typeof ver.latestVersion).toBe('string');
});

test('desktop pairing: /link unauthenticated banner + manual-entry fallback', async ({
  page,
  request,
}) => {
  // A pending pairing exists, but this browser context is not signed in.
  const start = await (
    await request.post('/auth/pair/start', { data: { deviceLabel: DEVICE_LABEL } })
  ).json();

  await page.goto(`/link?code=${encodeURIComponent(start.userCode)}`);
  await expect(page.getByText(/Sign in to approve a device/i)).toBeVisible();

  // No code → manual-entry form.
  await page.goto('/link');
  await expect(
    page.getByRole('heading', { name: /Link a device or app/i }),
  ).toBeVisible();
});
