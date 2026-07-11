import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { test, expect } from './fixtures';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali';

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function getPageId(title: string): Promise<string> {
  return withDb(async (c) => {
    const res = await c.query(
      `SELECT id FROM "Page" WHERE "workspaceId" = 'project-tuck-alumni' AND title = $1`,
      [title],
    );
    return res.rows[0]?.id as string;
  });
}

// Seed a consumable magic-link token directly (the email path is a no-op in
// dev), so the full self-signup flow is drivable end-to-end.
async function insertMagicToken(email: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('base64url');
  await withDb(async (c) => {
    const userId = `e2e-partner-${randomBytes(8).toString('hex')}`;
    await c.query(
      `INSERT INTO "User" (id, "personalEmail", "firstName", "lastName", "updatedAt")
       VALUES ($1, $2, '', '', now())
       ON CONFLICT ("personalEmail") DO NOTHING`,
      [userId, email],
    );
    const idRes = await c.query(
      `SELECT id FROM "User" WHERE "personalEmail" = $1`,
      [email],
    );
    await c.query(
      `INSERT INTO "OneTimeToken" (id, "userId", "tokenHash", purpose, "expiresAt")
       VALUES ($1, $2, $3, 'PartnerMagicLink', now() + interval '15 minutes')`,
      [`e2e-tok-${randomBytes(8).toString('hex')}`, idRes.rows[0].id, hash],
    );
  });
  return raw;
}

test.describe('internal Organizations pages (Core)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  // ?embed=1 renders member routes standalone instead of inside the
  // TabWorkspace iframe shell (see kanban-drag.spec.ts).
  test('lists partner orgs with counts', async ({ page }) => {
    await page.goto('/partners?embed=1');
    await expect(
      page.getByRole('heading', { name: 'Organizations' }),
    ).toBeVisible();
    await expect(page.getByText('Tuck School of Business')).toBeVisible();
  });

  test('org detail shows members, pending invites, and projects', async ({ page }) => {
    await page.goto('/partners/partner-tuck-school?embed=1');
    await expect(
      page.getByRole('heading', { name: 'Tuck School of Business' }),
    ).toBeVisible();
    await expect(page.getByText('Pat Tuck')).toBeVisible();
    await expect(page.getByText('invitee.tuck@example.com')).toBeVisible();
    await expect(page.getByText('Tuck Alumni Connect')).toBeVisible();
  });
});

test.describe('project hub share toggle (member)', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('overview shows the Partners section and share states', async ({ page }) => {
    await page.goto('/projects/project-tuck-alumni?embed=1');
    await expect(page.getByRole('heading', { name: 'Partners' })).toBeVisible();
    await expect(page.getByText('Pat Tuck (Program Sponsor)')).toBeVisible();
    // Seeded states: Weekly Partner Update shared, Internal Retro Notes not.
    await expect(
      page.getByRole('button', { name: 'Shared with partner' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Share with partner', exact: true }),
    ).toBeVisible();
  });

  test('toggling share flips the badge and back', async ({ page }) => {
    await page.goto('/projects/project-tuck-alumni?embed=1');
    const shareButton = page.getByRole('button', {
      name: 'Share with partner',
      exact: true,
    });
    await shareButton.click();
    await expect(
      page.getByRole('button', { name: 'Shared with partner' }),
    ).toHaveCount(2);
    // Revert so the test is idempotent against the seed baseline.
    await page
      .getByRole('button', { name: 'Shared with partner' })
      .last()
      .click();
    await expect(
      page.getByRole('button', { name: 'Shared with partner' }),
    ).toHaveCount(1);
  });
});

test.describe('partner portal', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ personalEmail: 'partner.tuck@example.com' });
  });

  test('home shows org welcome, project card, and bounces from member shell', async ({ page }) => {
    await page.goto('/partner');
    await expect(
      page.getByRole('heading', { name: 'Welcome, Pat' }),
    ).toBeVisible();
    await expect(page.getByText('Tuck Alumni Connect')).toBeVisible();

    // Partner accounts never see the member shell.
    await page.goto('/');
    await expect(page).toHaveURL(/\/partner$/);
  });

  test('project view shows sprint summary and only shared pages', async ({ page }) => {
    await page.goto('/partner/projects/project-tuck-alumni');
    await expect(
      page.getByRole('heading', { name: 'Tuck Alumni Connect' }),
    ).toBeVisible();
    await expect(page.getByText('Sprint 3 — Matching flow')).toBeVisible();
    await expect(page.getByText('2 of 5 tasks done')).toBeVisible();
    await expect(page.getByText('Weekly Partner Update')).toBeVisible();
    await expect(page.getByText('Internal Retro Notes')).not.toBeVisible();
  });

  test('shared page opens an editable collab editor', async ({ page }) => {
    const pageId = await getPageId('Weekly Partner Update');
    await page.goto(`/partner/projects/project-tuck-alumni/pages/${pageId}`);
    await expect(
      page.getByRole('heading', { name: 'Weekly Partner Update' }),
    ).toBeVisible();
    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  });

  test('unshared pages and other orgs’ projects 404', async ({ page }) => {
    const internalPageId = await getPageId('Internal Retro Notes');
    const unshared = await page.goto(
      `/partner/projects/project-tuck-alumni/pages/${internalPageId}`,
    );
    expect(unshared?.status()).toBe(404);

    // Hood's contact can't open Tuck's project.
    await page.goto('/dev-login-as?personalEmail=partner.hood%40example.com');
    const crossOrg = await page.goto('/partner/projects/project-tuck-alumni');
    expect(crossOrg?.status()).toBe(404);
  });
});

test.describe('partner self-signup', () => {
  test('magic link → onboarding → apply → status', async ({ page }) => {
    const email = `e2e-partner-${Date.now()}@example.com`;
    const raw = await insertMagicToken(email);

    // GET landing must not consume the token; POST does.
    await page.goto(`/partner/auth/verify?token=${raw}`);
    await page.getByRole('button', { name: 'Continue to DALI OS' }).click();
    await expect(page).toHaveURL(/\/partner\/onboarding/);

    await page.getByLabel('First name').fill('Emery');
    await page.getByLabel('Last name').fill('Example');
    await page.getByLabel('Organization name').fill('Example Robotics');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome, Emery' }),
    ).toBeVisible();

    // Submit a pitch and land on its status page.
    await page.goto('/partner/apply');
    await page.getByLabel('Project title').fill('Warehouse robot dashboard');
    await page.getByRole('button', { name: 'Submit pitch' }).click();
    await expect(
      page.getByRole('heading', { name: 'Warehouse robot dashboard' }),
    ).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible();
  });
});

test.describe('bound application form', () => {
  // The apply page appends the questions of the Core-bound Form (see
  // PartnerApplicationFormBinding) and stores answers as a linked
  // FormSubmission. Binding is a global singleton, so clean it up even on
  // failure — otherwise it leaks into other tests' apply flows.
  async function bindTestForm(): Promise<string> {
    const formId = `e2e-form-${randomBytes(6).toString('hex')}`;
    await withDb(async (c) => {
      const admin = await c.query(
        `SELECT id FROM "User" WHERE "daliEmail" = 'admin@dali.dartmouth.edu'`,
      );
      const adminId = admin.rows[0].id as string;
      await c.query(
        `INSERT INTO "Form" (id, name, "createdById", published, "publicToken", "updatedAt")
         VALUES ($1, 'E2E Partner Questions', $2, true, $3, now())`,
        [formId, adminId, randomBytes(24).toString('hex')],
      );
      await c.query(
        `INSERT INTO "FormVersion" (id, "versionNumber", questions, "formId", "createdById")
         VALUES ($1, 1, $2, $3, $4)`,
        [
          `${formId}-v1`,
          JSON.stringify([
            {
              key: 'q-budget',
              type: 'textarea',
              required: false,
              data: { label: 'What is your budget?' },
            },
          ]),
          formId,
          adminId,
        ],
      );
      // Replace the singleton (the seed binds a default form).
      await c.query(`DELETE FROM "PartnerApplicationFormBinding"`);
      await c.query(
        `INSERT INTO "PartnerApplicationFormBinding" (id, "formId", "updatedById", "updatedAt")
         VALUES ($1, $2, $3, now())`,
        [`e2e-binding-${randomBytes(6).toString('hex')}`, formId, adminId],
      );
    });
    return formId;
  }

  async function unbindTestForm(formId: string): Promise<void> {
    await withDb(async (c) => {
      await c.query(
        `DELETE FROM "PartnerApplicationFormBinding" WHERE "formId" = $1`,
        [formId],
      );
      // Cascades the version and the submission; the application keeps its
      // row (formSubmissionId is SetNull).
      await c.query(`DELETE FROM "Form" WHERE id = $1`, [formId]);
    });
  }

  test('apply shows bound questions and the answers land on the application', async ({
    page,
    loginAs,
  }) => {
    const formId = await bindTestForm();
    try {
      await loginAs({ personalEmail: 'partner.tuck@example.com' });
      await page.goto('/partner/apply');

      await page.getByLabel('Project title').fill('Alumni portal refresh');
      await expect(page.getByText('A few more questions')).toBeVisible();
      await expect(page.getByText('What is your budget?')).toBeVisible();
      await page
        .locator('section', { hasText: 'A few more questions' })
        .locator('textarea')
        .fill('Around $10k for the pilot term.');
      await page.getByRole('button', { name: 'Submit pitch' }).click();

      await expect(
        page.getByRole('heading', { name: 'Alumni portal refresh' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Application answers' }),
      ).toBeVisible();
      await expect(page.getByText('What is your budget?')).toBeVisible();
      await expect(
        page.getByText('Around $10k for the pilot term.'),
      ).toBeVisible();
    } finally {
      await unbindTestForm(formId);
    }
  });
});
