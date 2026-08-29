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
    const contactId = `e2e-move-contact-${suffix}`;
    const emptyOrgId = `e2e-empty-org-${suffix}`;
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO "User" (id, "personalEmail", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, 'Movey', 'Tester', now())`,
        [userId, `movey-${suffix}@example.com`],
      );
      // Account-first: the person is a PartnerContact, org membership a
      // PartnerMembership.
      await c.query(
        `INSERT INTO "PartnerContact" (id, name, email, "userId")
         VALUES ($1, 'Movey Tester', $2, $3)`,
        [contactId, `movey-${suffix}@example.com`, userId],
      );
      await c.query(
        `INSERT INTO "PartnerMembership" (id, "contactId", "orgId")
         VALUES ($1, $2, 'partner-tuck-school')`,
        [`e2e-move-m-${suffix}`, contactId],
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
        await c.query(`DELETE FROM "PartnerMembership" WHERE "contactId" = $1`, [contactId]);
        await c.query(`DELETE FROM "PartnerContact" WHERE id = $1`, [contactId]);
        await c.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
        await c.query(`DELETE FROM "PartnerOrg" WHERE id = $1`, [emptyOrgId]);
      });
    }
  });
});

test.describe('project hub share toggle (member)', () => {
  test.beforeEach(async ({ loginAs, page }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    // The project Drive tab now renders the shared DriveBrowser. Pin the
    // deterministic list view (its default is Miller columns) so rows have a
    // stable title-then-menu layout for the locators below.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('dali_drive_view', 'list');
      } catch {
        /* storage unavailable — list view is best-effort */
      }
    });
  });

  // Each row's actions live behind its own "⋯" menu trigger, marked with a
  // data-testid="drive-item-actions-<id>". The title renders as a span, so
  // anchor on its text and take the next actions trigger in document order —
  // that's this row's menu. (The shared Menu puts its aria-label on the popup
  // panel, not the trigger, so we key off the trigger's data-testid.)
  const docMenu = (page: import('@playwright/test').Page, title: string) =>
    page
      .getByText(title, { exact: true })
      .locator('xpath=following::button[starts-with(@data-testid, "drive-item-actions-")][1]');

  test('project details shows the Partners section; drive shows share states', async ({ page }) => {
    // Partners live on Project details; the project's files (and their
    // partner-share toggles) live on the Drive tab.
    await page.goto('/projects/project-tuck-alumni?tab=details&embed=1');
    await expect(page.getByRole('heading', { name: 'Partners' })).toBeVisible();
    // The os Partners view leads with the contacts — name and role on their
    // own lines rather than the old "Name (Role)" org summary.
    await expect(page.getByText('Pat Tuck', { exact: true })).toBeVisible();
    await expect(page.getByText('Program Sponsor', { exact: true })).toBeVisible();

    await page.goto('/projects/project-tuck-alumni?tab=drive&embed=1');
    // Seeded states: Weekly Partner Update shared, Internal Retro Notes not —
    // read off each row's menu, which names the action that would flip it.
    await docMenu(page, 'Weekly Partner Update').click();
    await expect(
      page.getByRole('menuitem', { name: 'Stop sharing with partner' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await docMenu(page, 'Internal Retro Notes').click();
    await expect(
      page.getByRole('menuitem', { name: 'Share with partner' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('toggling share flips the badge and back', async ({ page }) => {
    await page.goto('/projects/project-tuck-alumni?tab=drive&embed=1');
    await docMenu(page, 'Internal Retro Notes').click();
    await page.getByRole('menuitem', { name: 'Share with partner' }).click();
    await expect(
      page.getByText('Internal Retro Notes', { exact: true }),
    ).toBeVisible();
    await docMenu(page, 'Internal Retro Notes').click();
    await expect(
      page.getByRole('menuitem', { name: 'Stop sharing with partner' }),
    ).toBeVisible();
    // Revert so the test is idempotent against the seed baseline.
    await page.getByRole('menuitem', { name: 'Stop sharing with partner' }).click();
    await docMenu(page, 'Internal Retro Notes').click();
    await expect(
      page.getByRole('menuitem', { name: 'Share with partner' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
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

  test('project view shows the roadmap timeline and only shared pages', async ({
    page,
  }) => {
    await page.goto('/partner/projects/project-tuck-alumni');
    await expect(
      page.getByRole('heading', { name: 'Tuck Alumni Connect' }),
    ).toBeVisible();
    // The roadmap is the project hub's own timeline with the task level
    // hidden, so the legend offers epics and stories and nothing finer.
    const roadmap = page.locator('#roadmap');
    await expect(roadmap.getByRole('button', { name: 'Epics' })).toBeVisible();
    await expect(
      roadmap.getByRole('button', { name: 'User stories' }),
    ).toBeVisible();
    await expect(roadmap.getByRole('button', { name: 'Tasks' })).toHaveCount(0);
    // A bar names its epic — the roadmap is drawn from the project's real
    // planning data, not an empty grid. (The sprint hero is gone; the timeline
    // is the one surface now.)
    await expect(
      roadmap.getByText('Mentor matching', { exact: true }),
    ).toBeVisible();
    // Documents and files share one Drive shelf now.
    await expect(
      page.getByRole('heading', { name: 'Drive' }),
    ).toBeVisible();
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

  test('magic link → account-first apply (no org) → status', async ({ page }) => {
    const email = `e2e-partner-${Date.now()}@example.com`;
    const raw = await insertMagicToken(email);

    // GET landing must not consume the token; POST does.
    await page.goto(`/partner/auth/verify?token=${raw}`);
    await page.getByRole('button', { name: 'Continue to DALI OS' }).click();
    // Account-first: no org gate — the account is provisioned and lands
    // straight on the portal home (org is created later, at promotion).
    await expect(page).toHaveURL(/\/partner$/);
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

    // Apply with NO organization — the person/account is the primitive.
    // The form is now the full multi-page bound form; fill resiliently.
    await page.goto('/partner/apply');
    // Fill the first text input on page 1 with a recognizable value so the
    // derived application title is predictable for the assertion below.
    const firstText = page.locator('input[type="text"]').first();
    await firstText.fill('Warehouse robot dashboard');
    // Loop: fill remaining visible inputs, then advance or submit.
    for (let i = 0; i < 20; i++) {
      // Fill all other visible text inputs and textareas that are still empty.
      for (const ta of await page.locator('textarea:visible').all()) {
        if (!(await ta.inputValue())) await ta.fill('Test answer');
      }
      for (const inp of await page.locator('input[type="text"]:visible').all()) {
        if (!(await inp.inputValue())) await inp.fill('Test answer');
      }
      // Check the first unchecked checkbox in any group. The custom Checkbox
      // renders a visually-hidden (sr-only) real <input> inside a clickable
      // <label>, so Playwright can't click the input directly — toggle the
      // option by clicking the wrapping label instead.
      const cbLabel = page
        .locator('label:has(input[type="checkbox"]:not(:checked))')
        .first();
      if (await cbLabel.isVisible()) await cbLabel.click();

      const nextBtn = page.getByRole('button', { name: 'Next' });
      const submitBtn = page.getByRole('button', { name: 'Submit application' });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        break;
      } else if (await nextBtn.isVisible()) {
        await nextBtn.click();
      } else {
        break;
      }
    }
    await expect(
      page.getByRole('heading', { name: 'Warehouse robot dashboard' }),
    ).toBeVisible();
    await expect(page.getByText('Application submitted').first()).toBeVisible();
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
              key: 'project-title',
              type: 'text',
              required: true,
              data: { label: 'Project title' },
            },
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

      // First question is Project title — fill it so deriveApplicationTitle
      // returns a predictable value. FormField renders the <label> as a sibling
      // (no htmlFor), so target the field by position rather than getByLabel.
      await page
        .locator('input[type="text"]')
        .first()
        .fill('Alumni portal refresh');
      await expect(page.getByText('What is your budget?')).toBeVisible();
      await page.locator('textarea').fill('Around $10k for the pilot term.');
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
