import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  USERS,
  deleteFlagRow,
  deleteNotificationsMatching,
  getFlagRow,
  notificationsFor,
  signedInPage,
  userIdByEmail,
} from './notify.helpers';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const STAMP = `E2E-comms-${Date.now()}`;
const FLAG = 'banners';

test.describe.serial('Core announcements', () => {
  test.setTimeout(90_000);
  let member: { page: Page; context: BrowserContext };
  let memberId: string;
  let core: { page: Page; context: BrowserContext };

  test.beforeAll(async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
    memberId = await userIdByEmail(USERS.recipient);
    member = await signedInPage(browser, baseURL!, USERS.recipient);
    core = await signedInPage(browser, baseURL!, USERS.core);
  });

  test.afterAll(async () => {
    await member?.context.close();
    await core?.context.close();
    await deleteNotificationsMatching(STAMP);
    const c = new pg.Client(DATABASE_URL);
    await c.connect();
    try {
      await c.query(`DELETE FROM "ScheduledAnnouncement" WHERE title LIKE $1`, [`${STAMP}%`]);
    } finally {
      await c.end();
    }
  });

  test('a Core member announces to one person, who sees it and confirms it', async () => {
    const title = `${STAMP} announcement`;
    await core.page.goto('/core/communications/announcements');
    await core.page.getByRole('button', { name: 'New announcement' }).click();
    const drawer = core.page.getByRole('dialog');
    await drawer.getByLabel('Title').fill(title);
    const who = drawer.getByRole('combobox', { name: 'Add a person' });
    await who.click();
    await who.fill('Mira');
    await core.page.getByRole('option', { name: /Mira Chen/ }).click();
    await drawer.getByRole('button', { name: 'Send now' }).click();
    const sent = core.page.waitForResponse(
      (r) => r.url().includes('/api/notifications/send') && r.request().method() === 'POST',
    );
    await core.page.getByRole('dialog').filter({ hasText: 'Send to 1 person?' }).getByRole('button', { name: 'Send now' }).click();
    expect((await sent).ok()).toBe(true);
    await expect(core.page.getByText('Sent to 1 people')).toBeVisible();

    await core.page.goto('/core/communications/announcements?view=sent');
    await expect(core.page.getByText(title)).toBeVisible();

    const rows = await notificationsFor(memberId, STAMP);
    expect(rows).toHaveLength(1);
    expect(rows[0].readAt).toBeNull();

    await member.page.goto('/');
    await member.page.getByRole('button', { name: /^Notifications,/ }).click();
    const bell = member.page.getByRole('dialog');
    // With project work the panel splits into tabs; announcements sit under the second.
    const adminTab = bell.getByText('Meetings & events');
    if (await adminTab.count()) await adminTab.click();
    const card = bell
      .locator('div')
      .filter({ hasText: title })
      .filter({ has: member.page.getByRole('button', { name: 'Confirm' }) })
      .last();
    await expect(card).toBeVisible();
    const read = member.page.waitForResponse(
      (r) => r.url().includes(`/api/notifications/${rows[0].id}/read`) && r.request().method() === 'POST',
    );
    await card.getByRole('button', { name: 'Confirm' }).click();
    expect((await read).ok()).toBe(true);

    await member.page.reload();
    await member.page.getByRole('button', { name: /^Notifications,/ }).click();
    await expect(member.page.getByRole('dialog').getByText(title)).toHaveCount(0);
    expect((await notificationsFor(memberId, STAMP))[0].readAt).not.toBeNull();
  });

  test('a non-Core member cannot reach the composer or send', async () => {
    await member.page.goto('/core/communications/announcements');
    await expect(member.page).not.toHaveURL(/\/core\//);
    await expect(member.page.getByRole('button', { name: 'New announcement' })).toHaveCount(0);

    const res = await member.page.request.post('/api/notifications/send', {
      data: { title: `${STAMP} forged`, kind: 'SystemAnnouncement', allMembers: false, groupIds: [], userIds: [memberId] },
    });
    expect(res.status()).toBe(403);
    expect(await notificationsFor(memberId, `${STAMP} forged`)).toHaveLength(0);
  });
});

test.describe.serial('Feature flags', () => {
  test.setTimeout(120_000);
  let flagBefore: Awaited<ReturnType<typeof getFlagRow>>;
  let core: { page: Page; context: BrowserContext };
  let member: { page: Page; context: BrowserContext };
  let admin: { page: Page; context: BrowserContext };

  test.beforeAll(async ({ browser, baseURL }: { browser: Browser; baseURL?: string }) => {
    admin = await signedInPage(browser, baseURL!, USERS.admin);
    flagBefore = await getFlagRow(FLAG);
    core = await signedInPage(browser, baseURL!, USERS.core);
    member = await signedInPage(browser, baseURL!, USERS.member);
  });

  test.afterAll(async () => {
    await core?.context.close();
    await member?.context.close();
    await admin?.context.close();
    if (flagBefore) {
      const c = new pg.Client(DATABASE_URL);
      await c.connect();
      try {
        await c.query(
          `UPDATE "FeatureFlag" SET enabled = $2, everyone = $3, roles = $4, "userIds" = $5, "updatedAt" = now() WHERE key = $1`,
          [FLAG, flagBefore.enabled, flagBefore.everyone, flagBefore.roles, flagBefore.userIds],
        );
      } finally {
        await c.end();
      }
    } else {
      await deleteFlagRow(FLAG);
    }
  });

  test('an admin turns Banners on for one person and the tab appears only for them', async () => {
    const page = admin.page;
    await page.goto('/admin/platform/flags');
    await page.getByRole('searchbox', { name: 'Search flags' }).fill(FLAG);
    const row = page.locator('li').filter({ has: page.locator('code', { hasText: new RegExp(`^${FLAG}$`) }) });
    await row.getByRole('button', { name: new RegExp(FLAG) }).first().click();
    const who = row.getByRole('combobox', { name: `Add a person to ${FLAG}` });
    await who.click();
    await who.fill('Jordan');
    await page.getByRole('option', { name: /Jordan Taylor/ }).click();
    const save = page.waitForResponse(
      (r) => r.url().includes(`/api/feature-flags/${FLAG}`) && r.request().method() === 'PATCH',
    );
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await save).ok()).toBe(true);
    const on = page.waitForResponse(
      (r) => r.url().includes(`/api/feature-flags/${FLAG}`) && r.request().method() === 'PATCH',
    );
    await expect(row.getByRole('switch', { name: `Turn ${FLAG} on` })).toBeAttached();
    await row.locator('.dali-switch').click();
    expect((await on).ok()).toBe(true);

    const saved = await getFlagRow(FLAG);
    expect(saved?.enabled).toBe(true);
    expect(saved?.everyone).toBe(false);
    expect(saved?.userIds).toEqual([await userIdByEmail(USERS.core)]);

    // Flag rows are cached for ~15s server side.
    await expect(async () => {
      await core.page.goto('/core/communications');
      await expect(core.page.getByRole('link', { name: 'Banners' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });

    // Targeted at one person: another Core member (the admin) still has no tab.
    await page.goto('/core/communications');
    await expect(page.getByRole('heading', { name: 'Communications' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Banners' })).toHaveCount(0);
  });

  test('turning the flag off removes the tab again', async () => {
    const page = admin.page;
    await page.goto('/admin/platform/flags');
    await page.getByRole('searchbox', { name: 'Search flags' }).fill(FLAG);
    const row = page.locator('li').filter({ has: page.locator('code', { hasText: new RegExp(`^${FLAG}$`) }) });
    const off = page.waitForResponse(
      (r) => r.url().includes(`/api/feature-flags/${FLAG}`) && r.request().method() === 'PATCH',
    );
    await expect(row.getByRole('switch', { name: `Turn ${FLAG} off` })).toBeAttached();
    await row.locator('.dali-switch').click();
    expect((await off).ok()).toBe(true);
    expect((await getFlagRow(FLAG))?.enabled).toBe(false);

    await expect(async () => {
      await core.page.goto('/core/communications');
      await expect(core.page.getByRole('heading', { name: 'Communications' })).toBeVisible({ timeout: 2000 });
      await expect(core.page.getByRole('link', { name: 'Banners' })).toHaveCount(0, { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
  });

  test('a non-Core member cannot open or change flags', async () => {
    await member.page.goto('/admin/platform/flags');
    await expect(member.page).not.toHaveURL(/admin/);
    const res = await member.page.request.patch(`/api/feature-flags/${FLAG}`, {
      data: { enabled: true, everyone: true, roles: [], userIds: [], note: null, variant: null },
    });
    expect(res.status()).toBe(403);
    expect((await getFlagRow(FLAG))?.everyone ?? false).toBe(false);
  });
});
