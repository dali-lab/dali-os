import pg from 'pg';
import { expect, test } from './lib/demo';
import { createForm } from '../e2e/forms.helpers';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const ADMIN = 'admin@dali.dartmouth.edu';

const QUESTIONS = [
  { key: 'role', type: 'select', required: false, data: { label: 'Role', options: ['Developer', 'Designer', 'Product manager'] } },
  { key: 'rating', type: 'scale', required: false, data: { label: 'How was the workshop?', scaleLow: 'Poor', scaleHigh: 'Great' } },
  { key: 'notes', type: 'textarea', required: false, data: { label: 'Anything else?' } },
];

const PEOPLE: [string, string, string, string][] = [
  ['Ada Park', 'Designer', '5', 'Loved the Figma session'],
  ['Ben Ortiz', 'Developer', '4', 'More time on Rust please'],
  ['Cleo Wu', 'Designer', '3', ''],
  ['Dev Shah', 'Product manager', '5', 'Great pacing'],
  ['Eli Moss', 'Developer', '2', 'Too fast for me'],
  ['Fay Lund', 'Designer', '4', 'Rust and design systems'],
];

async function seedResponses(formId: string) {
  const db = new pg.Client(DATABASE_URL);
  await db.connect();
  try {
    const { rows } = await db.query('SELECT id FROM "User" WHERE "daliEmail" = $1', [ADMIN]);
    const version = await db.query(
      `INSERT INTO "FormVersion" (id, "versionNumber", questions, "formId", "createdById")
       VALUES ('demo-answer-filters-v1', 1, $1::jsonb, $2, $3) RETURNING id`,
      [JSON.stringify(QUESTIONS), formId, rows[0].id],
    );
    for (const [i, [name, role, rating, notes]] of PEOPLE.entries()) {
      await db.query(
        `INSERT INTO "FormSubmission" (id, "formId", "formVersionId", "submitterName", answers, "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
        [`demo-answer-filters-s${i}`, formId, version.rows[0].id, name, JSON.stringify({ role, rating, notes })],
      );
    }
  } finally {
    await db.end();
  }
}

test('forms: filter responses by what people answered', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: ADMIN });
  const formId = await createForm(page, 'Workshop feedback');
  await seedResponses(formId);

  await page.goto(`/forms/edit/${formId}?view=results&version=1&show=responses`);
  await expect(page.getByText('6 responses')).toBeVisible();
  await stage.pause(800);

  await stage.click(page.getByRole('button', { name: 'Filter' }));
  await stage.click(page.getByRole('menuitem', { name: 'Role' }));
  await stage.click(page.getByRole('option', { name: 'Designer' }));
  await expect(page.getByText('3 of 6 responses')).toBeVisible();
  await stage.pause(800);

  await page.keyboard.press('Escape');
  await stage.zoomTo(page.getByRole('button', { name: /^Role: Designer/ }), 1.5);
  await stage.pause(1200);
  await stage.resetZoom();

  await stage.type(page.getByLabel('Search responses by name, email or answer'), 'rust');
  await expect(page.getByText('1 of 6 responses')).toBeVisible();
  await stage.pause(800);

  const exportLink = page.getByRole('link', { name: 'Export 1' });
  await stage.zoomTo(exportLink, 1.8);
  await stage.pause(1600);
  await stage.resetZoom();
});
