import type { Browser, BrowserContext, Page } from '@playwright/test';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

export const USERS = {
  admin: 'admin@dali.dartmouth.edu',
  // Core member (CoreAssignment, current term) with no admin role.
  core: 'jordan.taylor@dali.dartmouth.edu',
  // Staffed on project-dali-os, not Core, not admin.
  member: 'marcus.bell@dali.dartmouth.edu',
  // Active lab member (the announcement audience), not Core.
  recipient: 'eng.lead@dali.dartmouth.edu',
} as const;

const LAUNCH_WELCOME_SEEN_KEY = 'dalios-launch-welcome-seen-v1';

/** A second signed-in browser context, so one test can act as two people. */
export async function signedInPage(
  browser: Browser,
  baseURL: string,
  daliEmail: string,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, 'e2e');
    } catch {
      // localStorage unavailable (e.g. about:blank)
    }
  }, LAUNCH_WELCOME_SEEN_KEY);
  await context.addCookies([{ name: 'dali_pk_prompt', value: '1', url: baseURL }]);
  const page = await context.newPage();
  const res = await context.request.get(`/dev-login-as?${new URLSearchParams({ daliEmail })}`, {
    maxRedirects: 0,
  });
  if (res.status() !== 302) throw new Error(`dev login failed for ${daliEmail}: ${res.status()}`);
  return { page, context };
}

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function userIdByEmail(daliEmail: string): Promise<string> {
  return withDb(async (c) => {
    const r = await c.query(`SELECT id FROM "User" WHERE "daliEmail" = $1`, [daliEmail]);
    return r.rows[0].id as string;
  });
}

/** Notification rows for one user whose title or body contains `needle`. */
export async function notificationsFor(userId: string, needle: string) {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT id, "readAt", link, title, body FROM "Notification"
       WHERE "recipientUserId" = $1 AND (title ILIKE $2 OR body ILIKE $2)`,
      [userId, `%${needle}%`],
    );
    return r.rows as {
      id: string;
      readAt: Date | null;
      link: string | null;
      title: string;
      body: string | null;
    }[];
  });
}

export async function deleteNotificationsMatching(needle: string) {
  await withDb((c) =>
    c.query(`DELETE FROM "Notification" WHERE title ILIKE $1 OR body ILIKE $1`, [`%${needle}%`]),
  );
}

export async function deleteTasksTitled(prefix: string) {
  await withDb(async (c) => {
    const like = `${prefix}%`;
    await c.query(
      `DELETE FROM "TaskComment" WHERE "taskId" IN (SELECT id FROM "Task" WHERE title LIKE $1)`,
      [like],
    );
    await c.query(
      `DELETE FROM "TaskAssignee" WHERE "taskId" IN (SELECT id FROM "Task" WHERE title LIKE $1)`,
      [like],
    );
    await c.query(`DELETE FROM "Task" WHERE title LIKE $1`, [like]);
  });
}

type PreferenceRow = {
  inApp: boolean;
  desktop: boolean;
  slackDm: boolean;
  digestFrequency: string;
};

export async function getPreferenceRow(
  userId: string,
  eventType: string,
): Promise<PreferenceRow | null> {
  return withDb(async (c) => {
    const r = await c.query(
      `SELECT "inApp", desktop, "slackDm", "digestFrequency" FROM "NotificationPreference"
       WHERE "userId" = $1 AND "eventType" = $2`,
      [userId, eventType],
    );
    return (r.rows[0] as PreferenceRow | undefined) ?? null;
  });
}

/** Put a preference back to a getPreferenceRow snapshot (null = no row). */
export async function restorePreference(
  userId: string,
  eventType: string,
  before: PreferenceRow | null,
) {
  await withDb(async (c) => {
    if (!before) {
      await c.query(`DELETE FROM "NotificationPreference" WHERE "userId" = $1 AND "eventType" = $2`, [
        userId,
        eventType,
      ]);
      return;
    }
    await c.query(
      `UPDATE "NotificationPreference"
       SET "inApp" = $3, desktop = $4, "slackDm" = $5, "digestFrequency" = $6::"DigestFreq"
       WHERE "userId" = $1 AND "eventType" = $2`,
      [userId, eventType, before.inApp, before.desktop, before.slackDm, before.digestFrequency],
    );
  });
}

export async function getFlagRow(key: string) {
  return withDb(async (c) => {
    const r = await c.query(`SELECT * FROM "FeatureFlag" WHERE key = $1`, [key]);
    return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
  });
}

export async function deleteFlagRow(key: string) {
  await withDb((c) => c.query(`DELETE FROM "FeatureFlag" WHERE key = $1`, [key]));
}

export async function countPreferences(userId: string): Promise<number> {
  return withDb(async (c) => {
    const r = await c.query(`SELECT count(*)::int AS n FROM "NotificationPreference" WHERE "userId" = $1`, [userId]);
    return r.rows[0].n as number;
  });
}

/** Saving the settings form writes a row per event; drop them when the user had none before. */
export async function deleteAllPreferences(userId: string) {
  await withDb((c) => c.query(`DELETE FROM "NotificationPreference" WHERE "userId" = $1`, [userId]));
}
