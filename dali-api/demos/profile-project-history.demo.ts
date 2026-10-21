import pg from 'pg';
import { expect, test } from './lib/demo';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

// Seed staffs members only in the current term, so copy one member's current
// assignment into the previous term to give their profile some history.
async function addPastAssignment(): Promise<string> {
  const db = new pg.Client(DATABASE_URL);
  await db.connect();
  try {
    const { rows } = await db.query<{ userId: string; projectId: string; domainId: string; level: string; sortKey: number }>(
      `SELECT pa."userId", pa."projectId", pa."domainId", pa.level::text, t."sortKey"
         FROM "ProjectAssignment" pa
         JOIN "Term" t ON t.id = pa."termId"
        WHERE now() BETWEEN t."startDate" AND t."endDate"
        ORDER BY pa."userId"
        LIMIT 1`,
    );
    const current = rows[0];
    if (!current) throw new Error('seed has no current-term assignment');
    await db.query(
      `INSERT INTO "ProjectAssignment" (id, "userId", "projectId", "termId", "domainId", level)
       SELECT 'demo-past-assignment', $1, $2, t.id, $3, 'P1'
         FROM "Term" t
        WHERE t."sortKey" < $4
        ORDER BY t."sortKey" DESC
        LIMIT 1
       ON CONFLICT DO NOTHING`,
      [current.userId, current.projectId, current.domainId, current.sortKey],
    );
    return current.userId;
  } finally {
    await db.end();
  }
}

test('profile: activity lists every term a member was staffed', async ({ page, stage, loginAs }) => {
  const userId = await addPastAssignment();
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  await page.goto(`/members/${userId}?tab=activity`);
  const section = page.locator('#project-assignments');
  await expect(section.getByText('This term', { exact: false })).toBeVisible();
  await stage.pause(800);
  await stage.zoomTo(section, 1.4);
  await stage.pause(2400);
  await stage.resetZoom();
  await stage.pause(600);
});
