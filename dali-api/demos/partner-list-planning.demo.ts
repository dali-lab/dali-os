import pg from 'pg';
import { expect, setFeatureFlag, test } from './lib/demo';

const connectionString = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const prefix = 'demo-term-planning';

test('partner list view: plan status, notes, headcount, and search', async ({ page, stage, loginAs }) => {
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    const { rows: terms } = await db.query('SELECT id FROM "Term" ORDER BY "sortKey" DESC LIMIT 1');
    const { rows: domains } = await db.query('SELECT id, "displayName" FROM "Domain" WHERE active = true ORDER BY "displayName" LIMIT 1');
    const termId = terms[0].id;
    const domain = domains[0];
    await db.query(`INSERT INTO "PartnerContact" (id, name, email)
      VALUES ($1, 'Demo Partner', 'term-planning@example.invalid') ON CONFLICT (id) DO NOTHING`, [prefix]);
    for (const [suffix, title, status, fee] of [
      ['active', 'Demo Campus Explorer', 'New', 1200000],
      ['later', 'Demo Archive Search', 'Later', 800000],
    ]) {
      const id = `${prefix}-${suffix}`;
      await db.query(`INSERT INTO "PartnerApplication" (id, "applicantContactId", title, "feeCents", "updatedAt")
        VALUES ($1, $2, $3, $4, now()) ON CONFLICT (id) DO UPDATE SET "feeCents" = EXCLUDED."feeCents"`, [id, prefix, title, fee]);
      await db.query(`INSERT INTO "PartnerApplicationTargetTerm" (id, "applicationId", "termId", "planningStatus")
        VALUES ($1, $2, $3, $4::"PartnerPlanningStatus") ON CONFLICT (id) DO UPDATE SET
        "planningStatus" = EXCLUDED."planningStatus", "plannerNotes" = NULL, "plannerTodo" = NULL`, [id, id, termId, status]);
    }
    await db.query('DELETE FROM "PartnerApplicationDomain" WHERE "applicationId" = $1', [`${prefix}-active`]);
    await setFeatureFlag('partner-planning', true);
    await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });
    await page.addInitScript((term) => {
      window.localStorage.setItem('dali:partnerboard:filters', JSON.stringify({
        term, domain: null, source: null, staleOnly: false, showPaused: true, showRejectedPastTerms: false,
      }));
    }, termId);
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Demo Campus Explorer', exact: true }) });
    // Flag rows are cached for 15s server-side.
    await expect(async () => {
      await page.goto('/core/partners');
      await page.getByRole('button', { name: 'List view' }).click();
      await expect(row.getByRole('combobox', { name: /Plan status/ })).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await stage.click(row.getByRole('combobox', { name: /Plan status/ }));
    await stage.click(page.getByRole('option', { name: 'Continuing' }));
    await expect(row.getByRole('combobox', { name: /Plan status/ })).toContainText('Continuing');
    await stage.type(row.getByLabel('Notes', { exact: true }), 'Confirm winter scope');
    await stage.type(row.getByLabel('To-do', { exact: true }), 'Schedule partner check-in');
    await stage.type(row.getByLabel(`${domain.displayName} headcount for Demo Campus Explorer`), '3');
    await stage.click(page.getByPlaceholder('Search applications…'));
    await expect.poll(async () => {
      const { rows } = await db.query(`SELECT t."plannerNotes", t."plannerTodo", d."expectedMembers"
        FROM "PartnerApplicationTargetTerm" t JOIN "PartnerApplicationDomain" d ON d."applicationId" = t."applicationId"
        WHERE t.id = $1 AND d."domainId" = $2`, [`${prefix}-active`, domain.id]);
      return rows[0];
    }).toEqual({ plannerNotes: 'Confirm winter scope', plannerTodo: 'Schedule partner check-in', expectedMembers: 3 });
    await page.reload();
    await expect(row.getByLabel('Notes', { exact: true })).toHaveValue('Confirm winter scope');
    await expect(row.getByLabel(`${domain.displayName} headcount for Demo Campus Explorer`)).toHaveValue('3');
    await stage.type(page.getByPlaceholder('Search applications…'), 'Demo Campus');
    await expect(page.getByRole('button', { name: 'Demo Archive Search', exact: true })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: 'Total' })).toContainText('$12,000');
    await stage.pause(1000);
  } finally {
    await db.query('DELETE FROM "PartnerApplication" WHERE "applicantContactId" = $1', [prefix]);
    await db.query('DELETE FROM "PartnerContact" WHERE id = $1', [prefix]);
    await db.end();
  }
});
