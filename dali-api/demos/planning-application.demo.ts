import pg from 'pg';
import { expect, test } from './lib/demo';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const APPLICATION_ID = 'papp-hood-kiosk';

// The seed has no partners@ mail and gives the kiosk no PI to start from, so
// add a short thread with its contact and clear the PI.
async function prepareKiosk() {
  const db = new pg.Client(DATABASE_URL);
  await db.connect();
  try {
    await db.query(
      `INSERT INTO "MailAccount" (id, kind, address, "displayName", "scopeKey", "updatedAt")
       VALUES ('demo-partners-inbox', 'Shared', 'partners@dali.dartmouth.edu', 'DALI Partners', 'shared', now())
       ON CONFLICT DO NOTHING`,
    );
    const messages = [
      ['demo-kiosk-1', 'thread-kiosk-intro', 'Inbound', 'Touchscreen kiosk for the permanent collection', 12],
      ['demo-kiosk-2', 'thread-kiosk-intro', 'Outbound', 'Re: Touchscreen kiosk for the permanent collection', 11],
      ['demo-kiosk-3', 'thread-kiosk-intro', 'Inbound', 'Re: Touchscreen kiosk for the permanent collection', 10],
      ['demo-kiosk-4', 'thread-kiosk-visit', 'Outbound', 'Visiting the gallery before interviews', 3],
      ['demo-kiosk-5', 'thread-kiosk-visit', 'Inbound', 'Re: Visiting the gallery before interviews', 2],
    ] as const;
    for (const [id, threadId, direction, subject, daysAgo] of messages) {
      await db.query(
        `INSERT INTO "MailMessageIndex"
           (id, "accountId", "gmailMessageId", "threadId", direction, subject, "sentAt", "fromAddress", "toAddresses",
            "linkedPartnerContactId", "linkSource", "updatedAt")
         SELECT $1, a.id, $1, $2, $3::"MailDirection", $4, now() - ($5 || ' days')::interval,
                CASE WHEN $3 = 'Inbound' THEN c.email ELSE 'partners@dali.dartmouth.edu' END,
                ARRAY[CASE WHEN $3 = 'Inbound' THEN 'partners@dali.dartmouth.edu' ELSE c.email END],
                c.id, 'Auto', now()
           FROM "MailAccount" a, "PartnerApplication" pa
           JOIN "PartnerContact" c ON c.id = pa."applicantContactId"
          WHERE a.address = 'partners@dali.dartmouth.edu' AND a.kind = 'Shared' AND pa.id = $6
         ON CONFLICT (id) DO NOTHING`,
        [id, threadId, direction, subject, String(daysAgo), APPLICATION_ID],
      );
    }
    await db.query(`UPDATE "PartnerApplication" SET "piUserId" = NULL WHERE id = $1`, [APPLICATION_ID]);
  } finally {
    await db.end();
  }
}

test('planning: open a project, read its application, and become its PI', async ({ page, stage, loginAs }) => {
  await prepareKiosk();
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  await page.goto('/core/partners/planning', { waitUntil: 'load' });
  const row = page.getByRole('button', { name: /Interactive gallery kiosk/ }).first();
  await expect(row).toBeVisible();
  await stage.pause(1500);
  await stage.click(row);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const tabs = dialog.getByRole('tablist', { name: 'Application sections' });
  await expect(dialog.getByText('Planning notes')).toBeVisible();
  await stage.pause(1200);

  await stage.click(tabs.getByRole('tab', { name: 'Details' }));
  const summary = dialog.getByText(/Touchscreen kiosks that let visitors/);
  await expect(summary).toBeVisible();
  await stage.zoomTo(summary, 1.3);
  await stage.pause(1600);
  await stage.resetZoom();

  await stage.click(tabs.getByRole('tab', { name: 'Email' }));
  const thread = dialog.getByText('Visiting the gallery before interviews');
  await expect(thread).toBeVisible();
  await stage.zoomTo(thread, 1.3);
  await stage.pause(1600);
  await stage.resetZoom();

  const piPicker = dialog.getByRole('combobox', { name: 'PI' });
  await stage.click(piPicker);
  await stage.click(page.getByRole('option', { name: 'Jordan Taylor' }));
  await expect(piPicker).toContainText('Jordan Taylor');
  await stage.zoomTo(piPicker, 1.4);
  await stage.pause(1400);
  await stage.resetZoom();

  await stage.click(tabs.getByRole('tab', { name: 'Planning' }));
  await expect(dialog.getByText('Jordan Taylor').first()).toBeVisible();
  await stage.pause(1800);
});
