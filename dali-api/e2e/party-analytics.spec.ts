import { test, expect } from './fixtures';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function getUserIdByNetId(netId: string): Promise<string> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE "netId" = $1`,
      [netId],
    );
    if (res.rows.length === 0) throw new Error(`No user with netId ${netId}`);
    return res.rows[0].id;
  });
}

async function clearPartyEventsForUser(userId: string) {
  await withClient(async (client) => {
    await client.query(`DELETE FROM "PartyEvent" WHERE "userId" = $1`, [userId]);
  });
}

async function getPartyEventsForUser(userId: string) {
  return withClient(async (client) => {
    const res = await client.query<{ eventType: string }>(
      `SELECT "eventType" FROM "PartyEvent" WHERE "userId" = $1 ORDER BY "createdAt" ASC`,
      [userId],
    );
    return res.rows.map((r) => r.eventType);
  });
}

test.describe('party analytics', () => {
  test('records visit, unlock-failure, and unlock-success events', async ({ page, loginAs }) => {
    // Carol is a seeded applicant (netId f007ca3). She'll get the external code D4L1.
    const userId = await getUserIdByNetId('f007ca3');
    await clearPartyEventsForUser(userId);

    await loginAs({ netId: 'f007ca3' });
    await page.goto('/party');
    await expect(page).toHaveURL(/\/party$/);

    // Wait for the visit event to be POSTed.
    await page.waitForResponse((r) =>
      r.url().endsWith('/api/party/events') && r.request().method() === 'POST',
    );

    // Submit a wrong code first.
    const inputs = page.locator('input[aria-label^="Party code code character"]');
    await expect(inputs).toHaveCount(4);
    await inputs.nth(0).fill('X');
    await inputs.nth(1).fill('X');
    await inputs.nth(2).fill('X');
    await inputs.nth(3).fill('X');
    const failureWait = page.waitForResponse((r) =>
      r.url().endsWith('/api/party/events') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Unlock$/ }).click();
    await failureWait;

    // Then submit the right code.
    await inputs.nth(0).fill('D');
    await inputs.nth(1).fill('4');
    await inputs.nth(2).fill('L');
    await inputs.nth(3).fill('1');
    const successWait = page.waitForResponse((r) =>
      r.url().endsWith('/api/party/events') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /^Unlock$/ }).click();
    await successWait;

    // Give the server a beat to commit before reading.
    await page.waitForTimeout(200);

    const events = await getPartyEventsForUser(userId);
    expect(events).toContain('PARTY_VISIT');
    expect(events).toContain('CODE_UNLOCK_FAILURE');
    expect(events).toContain('CODE_UNLOCK_SUCCESS');
  });
});
