import { test, expect } from './fixtures';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

const CAROL_APP_ID = 'app-carol';

// Carol's seeded baseline answers — what we restore to in cleanup so this test
// is idempotent across re-runs and doesn't bleed state into sibling specs.
const CAROL_SEED_GENERAL_ANSWERS = {
  'fq-00000000-0000-0000-0000-000000000001': 'Carol Patel',
  'fq-00000000-0000-0000-0000-000000000002': 'f007ca3',
  'fq-00000000-0000-0000-0000-000000000003': '2026',
  'fq-00000000-0000-0000-0000-000000000007': 'Computer Science',
};

// All the required-question answers carol needs to pass the client-side
// validation gate. Filling these in via SQL keeps the spec focused on the
// review-modal flow rather than typing 14 fields through the UI.
const CAROL_FULL_GENERAL_ANSWERS = {
  ...CAROL_SEED_GENERAL_ANSWERS,
  'fq-00000000-0000-0000-0000-000000000006': 'A friend in DALI',
  'fq-00000000-0000-0000-0000-000000000008': 'Fall, Winter, Spring',
  'fq-00000000-0000-0000-0000-000000000009': 'Fall',
  'fq-00000000-0000-0000-0000-000000000010': 'Robotics club: 4 hours\nCS tutoring: 2 hours',
  'fq-00000000-0000-0000-0000-000000000011': '10-12 hours per week — DALI would replace tutoring time.',
  'fq-00000000-0000-0000-0000-000000000012': 'CS 1, CS 10. Built a personal portfolio site and a robotics-team scoring app.',
  'fq-00000000-0000-0000-0000-000000000013': 'None',
  'fq-00000000-0000-0000-0000-000000000014': 'I want to ship things that real people use.',
  'fq-00000000-0000-0000-0000-000000000015': 'I built a chatbot for our robotics team. I loved making it useful day-1.',
  'fq-00000000-0000-0000-0000-000000000016': 'A semester project with four classmates — clear ownership helped.',
};

const CAROL_ENG_ANSWERS = {
  'eq-00000000-0000-0000-0000-000000000005':
    'Bash/Terminal: 3\nGit: 4\nC: 1\nC#: 0\nUnity: 0\nJavaScript: 4\nTypeScript: 3\nPython: 2\nRuby (on Rails): 0\nReact.js: 4\nReact Native: 1\nSwift: 0\nFlutter: 0\niOS: 0\nAndroid: 0\nMongoDB: 1\nExpress: 2\nNode.js: 3\nSQL: 1\nIoT: 0\nR: 0\nTidy-Verse: 0\nPandas: 1\nD3: 0\nFigma: 1\nSKlearn: 0\nDeep/Machine Learning: 0\nCloud Data Storage: 1',
};

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setCarolAnswers(general: object, eng: object) {
  await withClient(async client => {
    await client.query(
      `UPDATE "Application" SET answers = $1::jsonb WHERE id = $2`,
      [JSON.stringify(general), CAROL_APP_ID],
    );
    await client.query(
      `UPDATE "DomainApplication" SET answers = $1::jsonb WHERE "applicationId" = $2`,
      [JSON.stringify(eng), CAROL_APP_ID],
    );
  });
}

async function resetCarolToDraft() {
  await withClient(async client => {
    // Strip any Submitted (or later) status updates this test may have created.
    await client.query(
      `DELETE FROM "ApplicationStatusUpdate"
       WHERE "applicationId" = $1 AND "newStatus" <> 'Draft'`,
      [CAROL_APP_ID],
    );
  });
  await setCarolAnswers(CAROL_SEED_GENERAL_ANSWERS, {});
}

test.describe('portal: pre-submit review modal', () => {
  test.beforeEach(async () => {
    await setCarolAnswers(CAROL_FULL_GENERAL_ANSWERS, CAROL_ENG_ANSWERS);
  });

  test.afterEach(async () => {
    await resetCarolToDraft();
  });

  test('opens a review modal before submitting; Go Back returns to the form, Confirm submits', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ netId: 'f007ca3' });

    await page.goto('/portal/apply');
    await expect(page).toHaveURL(/\/portal\/apply/);

    // Wait for the form to hydrate (button label uses "Application", not the
    // pre-draft "Start Application").
    const reviewButton = page.getByRole('button', { name: /^Review Application$/ });
    await expect(reviewButton).toBeVisible();

    // Click "Review Application" — this should open the review modal, NOT submit.
    await reviewButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/review your application/i)).toBeVisible();

    // Modal echoes the saved answers so the applicant can sanity-check.
    await expect(dialog.getByText('Carol Patel')).toBeVisible();
    await expect(dialog.getByText(/i want to ship things/i)).toBeVisible();

    // "Go Back and Edit" closes the modal without contacting the server.
    await dialog.getByRole('button', { name: /go back and edit/i }).click();
    await expect(dialog).toBeHidden();
    // Still on the apply page — no submission happened.
    await expect(page).toHaveURL(/\/portal\/apply/);

    // Re-open the review modal and confirm.
    await reviewButton.click();
    const dialog2 = page.getByRole('dialog');
    await expect(dialog2).toBeVisible();
    await dialog2.getByRole('button', { name: /confirm submission/i }).click();

    // After Confirm, the action redirects to the /portal/hiring tracker (with
    // a transient ?just-submitted=1 flag the client strips after confetti).
    await page.waitForURL(/\/portal\/hiring(?:\?|$)/);

    // Verify a Submitted status update was actually created.
    const result = await withClient(async client => {
      const r = await client.query(
        `SELECT 1 FROM "ApplicationStatusUpdate"
         WHERE "applicationId" = $1 AND "newStatus" = 'Submitted'`,
        [CAROL_APP_ID],
      );
      return r.rowCount;
    });
    expect(result).toBeGreaterThan(0);
  });

  test('flags inaccessible links before opening the review modal; Submit Anyway advances to preview', async ({
    page,
    loginAs,
  }) => {
    // Add a github_url answer so the pre-review check has something to flag.
    // eq-…01 is the FULLSTACK github_url challenge question on the engineering form.
    await setCarolAnswers(CAROL_FULL_GENERAL_ANSWERS, {
      ...CAROL_ENG_ANSWERS,
      'eq-00000000-0000-0000-0000-000000000001': 'https://github.com/example/private-repo',
    });

    await loginAs({ netId: 'f007ca3' });

    // Mock the URL-check endpoint so the test does not depend on real GitHub
    // network calls. Force a non-`valid` result so the pre-review gate fires.
    await page.route('**/api/check-url', async route => {
      const body = route.request().postDataJSON() as { url?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'private',
          url: body.url ?? '',
          message: 'Repository appears to be private or does not exist',
        }),
      });
    });

    await page.goto('/portal/apply');
    await expect(page).toHaveURL(/\/portal\/apply/);
    // Wait for hydration so the click handler is bound before we click — without
    // this the click can land before React has wired up `Review Application`,
    // and openReviewIfValid never runs.
    await page.waitForLoadState('networkidle');

    const reviewButton = page.getByRole('button', { name: /^Review Application$/ });
    await expect(reviewButton).toBeVisible();

    // Click and wait for the URL-check fetch to confirm openReviewIfValid
    // actually ran (the modal is opened only after this resolves). Without
    // this anchor we race the async URL check against the heading assertion.
    const checkUrlRequest = page.waitForRequest('**/api/check-url');
    await reviewButton.click();
    await checkUrlRequest;

    // Warning modal must appear *before* the review modal — this is the
    // regression we're guarding against (#320).
    const warningHeading = page.getByRole('heading', { name: /some links may be inaccessible/i });
    await expect(warningHeading).toBeVisible();
    // Review modal should NOT be visible yet.
    await expect(page.getByRole('heading', { name: /review your application/i })).toBeHidden();

    // Submit Anyway closes the warning modal and opens the review/preview modal.
    await page.getByRole('button', { name: /submit anyway/i }).click();
    await expect(warningHeading).toBeHidden();
    await expect(page.getByRole('heading', { name: /review your application/i })).toBeVisible();
  });
});
