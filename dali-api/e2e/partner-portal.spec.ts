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
      page.getByRole('heading', { name: 'Partners' }),
    ).toBeVisible();
    await expect(page.getByText('Tuck School of Business')).toBeVisible();
  });

  test('org detail shows members, pending invites, and projects', async ({ page }) => {
    await page.goto('/partners/partner-tuck-school?embed=1');
    await expect(
      page.getByRole('heading', { name: 'Tuck School of Business' }),
    ).toBeVisible();
    // The seed marks Pat as primary contact, so the name appears in both the
    // member row and the primary-contact line — assert presence, not oneness.
    await expect(page.getByText('Pat Tuck').first()).toBeVisible();
    await expect(page.getByText('invitee.tuck@example.com')).toBeVisible();
    await expect(page.getByText('Tuck Alumni Connect')).toBeVisible();
  });

  test('Core can move a member, remove them, and delete an empty org', async ({ page }) => {
    // Throwaway member on Tuck + an empty org, created directly — this is
    // the fix-it tooling for exactly this kind of record surgery.
    const suffix = randomBytes(4).toString('hex');
    const userId = `e2e-move-user-${suffix}`;
    const emptyOrgId = `e2e-empty-org-${suffix}`;
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO "User" (id, "personalEmail", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, 'Movey', 'Tester', now())`,
        [userId, `movey-${suffix}@example.com`],
      );
      await c.query(
        `INSERT INTO "PartnerUser" (id, "userId", "partnerOrgId", "authProvider")
         VALUES ($1, $2, 'partner-tuck-school', 'MagicLink')`,
        [`e2e-move-pu-${suffix}`, userId],
      );
      await c.query(
        `INSERT INTO "PartnerOrg" (id, name) VALUES ($1, $2)`,
        [emptyOrgId, `Empty Husk ${suffix}`],
      );
    });

    try {
      // Confirmations are in-app dialogs (useConfirmSubmit) — accept each by
      // clicking the dialog's action button.

      // Move: Tuck → Hood.
      await page.goto('/partners/partner-tuck-school?embed=1');
      const row = page.locator('li', { hasText: 'Movey Tester' });
      await row.getByRole('button', { name: 'Move', exact: true }).click();
      await row.locator('select[name="targetOrgId"]').selectOption({ label: 'Hood Museum of Art' });
      await row.getByRole('button', { name: 'Move', exact: true }).last().click();
      await page.getByRole('dialog').getByRole('button', { name: 'Move', exact: true }).click();
      await expect(page.getByText('Movey Tester')).not.toBeVisible();
      await page.goto('/partners/partner-hood-museum?embed=1');
      await expect(page.getByText('Movey Tester')).toBeVisible();

      // Remove from Hood.
      await page
        .locator('li', { hasText: 'Movey Tester' })
        .getByRole('button', { name: 'Remove' })
        .click();
      await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(page.getByText('Movey Tester')).not.toBeVisible();

      // Delete the empty org — lands back on the org list without it.
      await page.goto(`/partners/${emptyOrgId}?embed=1`);
      await page.getByRole('button', { name: 'Delete organization' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Partners' }),
      ).toBeVisible();
      await expect(page.getByText(`Empty Husk ${suffix}`)).toHaveCount(0);
    } finally {
      await withDb(async (c) => {
        await c.query(`DELETE FROM "PartnerUser" WHERE "userId" = $1`, [userId]);
        await c.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
        await c.query(`DELETE FROM "PartnerOrg" WHERE id = $1`, [emptyOrgId]);
      });
    }
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

    // The hub is a tabbed workspace; the section tabs are driven by ?tab= and
    // server-rendered, so navigate straight to each tab (no click / hydration
    // race, and only the active tab's copy of the sprint name is present).
    await page.goto('/partner/projects/project-tuck-alumni?tab=roadmap');
    await expect(page.getByText('Sprint 3 — Matching flow')).toBeVisible();
    await expect(page.getByText('2 of 5 tasks done')).toBeVisible();

    // Shared docs live in the Documents tab; unshared ones never render.
    await page.goto('/partner/projects/project-tuck-alumni?tab=documents');
    await expect(page.getByText('Weekly Partner Update')).toBeVisible();
    await expect(page.getByText('Internal Retro Notes')).not.toBeVisible();
  });

  test('shared page is read-only for partners but allows comments', async ({ page }) => {
    const pageId = await getPageId('Weekly Partner Update');
    await page.goto(`/partner/projects/project-tuck-alumni/pages/${pageId}`);
    await expect(
      page.getByRole('heading', { name: 'Weekly Partner Update' }),
    ).toBeVisible();
    // The body renders but is view-only for partners — no editable surface.
    await expect(page.locator('[contenteditable="false"]')).toBeVisible();
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    // ...but the comments rail lets them leave feedback.
    await expect(
      page.getByRole('heading', { name: 'Comments' }),
    ).toBeVisible();
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
  test('login shows first-timer guidance without gating sign-in', async ({
    page,
  }) => {
    await page.goto('/partner/login');
    // Login is pure auth — the one org-adjacent line is the invite hint
    // (an invite IS a sign-in method); everything else lives after sign-in.
    await expect(page.getByText(/invite email\? It signs you in/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Email me a sign-in link' }),
    ).toBeVisible();
  });

  test('magic link → onboarding → apply → status', async ({ page }) => {
    const email = `e2e-partner-${Date.now()}@example.com`;
    const raw = await insertMagicToken(email);

    // GET landing must not consume the token; POST does.
    await page.goto(`/partner/auth/verify?token=${raw}`);
    await page.getByRole('button', { name: 'Continue to DALI OS' }).click();
    await expect(page).toHaveURL(/\/partner\/onboarding/);

    // The no-org landing owns the org concepts: invite guidance is shown,
    // and creating an organization is an explicit step.
    await expect(page.getByText(/Waiting on an invite/)).toBeVisible();
    await page.getByRole('button', { name: 'Create your organization' }).click();
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
    await page.getByRole('button', { name: 'Submit application' }).click();
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
      await page.getByRole('button', { name: 'Submit application' }).click();

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
