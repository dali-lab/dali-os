import pg from 'pg';
import { expect, test } from './lib/demo';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

// Seed has no late submission, so record one three hours past Alice's
// Engineering deadline and start her application with no note.
async function makeAliceLate() {
  const db = new pg.Client(DATABASE_URL);
  await db.connect();
  try {
    await db.query(
      `INSERT INTO "ApplicationStatusUpdate" (id, "createdAt", "newStatus", "applicationId", "userId")
       SELECT 'demo-late-alice', COALESCE(dac."closeDate", c."closeDate") + interval '3 hours', 'Submitted', a.id, a."userId"
         FROM "DomainApplication" da
         JOIN "Application" a ON a.id = da."applicationId"
         JOIN "ApplicationCycle" c ON c.id = a."applicationCycleId"
         JOIN "DomainApplicationCycle" dac ON dac."domainId" = da."domainId" AND dac."applicationCycleId" = c.id
        WHERE da.id = 'da-alice-eng'
       ON CONFLICT (id) DO NOTHING`,
    );
    await db.query(
      `UPDATE "Application" SET "hiringNote" = NULL
        WHERE id = (SELECT "applicationId" FROM "DomainApplication" WHERE id = 'da-alice-eng')`,
    );
  } finally {
    await db.end();
  }
}

test('applications: late badge and a note above the application', async ({ page, stage, loginAs }) => {
  await makeAliceLate();
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  await page.goto('/hiring/applications/da-alice-eng');
  const badge = page.getByText(/^Late by \d+h$/);
  await expect(badge).toBeVisible();
  await stage.pause(800);
  await stage.zoomTo(badge, 1.6);
  await stage.pause(1400);
  await stage.resetZoom();

  await stage.click(page.getByRole('button', { name: 'Add note' }));
  await stage.type(page.getByLabel('Note'), 'Emailed us before the deadline. Accepted late by Core.');
  await stage.click(page.getByRole('button', { name: 'Save' }));

  const note = page.getByRole('region', { name: 'Note' });
  await expect(note).toBeVisible();
  await stage.zoomTo(note, 1.4);
  await stage.pause(1800);
  await stage.resetZoom();
});
