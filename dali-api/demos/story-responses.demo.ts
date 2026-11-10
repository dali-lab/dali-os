import pg from 'pg';
import { expect, setFeatureFlag, test } from './lib/demo';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';
const POST_ID = 'demo-story-responses';

async function seedStory() {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id FROM "User" WHERE "daliEmail" = 'jordan.taylor@dali.dartmouth.edu' LIMIT 1`,
    );
    await client.query(`DELETE FROM "BlogPost" WHERE id = $1`, [POST_ID]);
    await client.query(
      `INSERT INTO "BlogPost" (id, title, "contentJson", excerpt, summary, "publishedAt", "authorId", "updatedAt")
       VALUES ($1, 'Demo day recap', $2, 'Twelve teams shipped this term.', 'Twelve teams shipped this term.', now(), $3, now())`,
      [
        POST_ID,
        JSON.stringify([{ type: 'paragraph', content: 'Twelve teams shipped this term. Here is what they built.' }]),
        rows[0].id,
      ],
    );
  } finally {
    await client.end();
  }
}

test('stories: react and comment on a post', async ({ page, stage, loginAs }) => {
  await setFeatureFlag('community', true);
  await seedStory();
  await loginAs({ daliEmail: 'jordan.taylor@dali.dartmouth.edu' });

  // Flag rows are cached for 15s server-side.
  await expect(async () => {
    await page.goto(`/resources/blog/${POST_ID}`);
    await expect(page.getByRole('heading', { name: 'Demo day recap' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Everything DALI' })).toBeVisible();
  await stage.pause(1000);

  await stage.click(page.getByRole('button', { name: 'Add reaction' }));
  await stage.click(page.getByRole('button', { name: '🎉', exact: true }));
  await expect(page.getByRole('button', { name: '🎉 1' })).toBeVisible();
  await stage.pause(800);

  await stage.type(page.getByLabel('Add a comment'), 'Congrats to every team!');
  await stage.click(page.getByRole('button', { name: 'Send' }));
  await expect(page.getByText('Congrats to every team!')).toBeVisible();
  await stage.pause(1500);
});
