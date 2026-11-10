import { test, expect } from './fixtures';
import {
  deleteGroupsNamed,
  findGroup,
  randomSuffix,
  readProfile,
  restoreProfile,
  snapshotProfile,
  userIdByEmail,
  type ProfileSnapshot,
} from './people.helpers';

const OWNER = 'marcus.bell@dali.dartmouth.edu';
const PEER = 'casey.lindqvist@dali.dartmouth.edu';

test.describe('directory', () => {
  test('a member searches the directory and opens another member profile', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: PEER });
    await page.goto('/members');

    await page.getByPlaceholder('Search by name or email').fill('Abernathy');
    const row = page.getByRole('row', { name: /Theo Abernathy/ });
    await expect(row).toBeVisible();
    await expect(page.getByRole('row', { name: /Mira Chen/ })).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]q=Abernathy/);

    await row.click();
    await expect(page).toHaveURL(/\/members\/[^/?]+$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Theo Abernathy' })).toBeVisible();
  });
});

test.describe('profile edit and privacy', () => {
  let ownerId: string;
  let original: ProfileSnapshot;

  test.beforeAll(async () => {
    ownerId = await userIdByEmail(OWNER);
    original = await snapshotProfile(ownerId);
  });

  test.afterAll(async () => {
    await restoreProfile(ownerId, original);
  });

  test('a member edits their profile, it persists, and a peer sees it', async ({ page, loginAs }) => {
    const pronouns = `they/them ${randomSuffix()}`;
    const major = `Linguistics ${randomSuffix()}`;

    await loginAs({ daliEmail: OWNER });
    await page.goto('/profile');
    await expect(page).toHaveURL(new RegExp(`/members/${ownerId}$`));

    const about = page.locator('article').filter({ has: page.getByRole('heading', { name: 'About' }) });
    await about.getByRole('button', { name: 'Edit' }).click();
    await about.locator('input[name="pronouns"]').fill(pronouns);
    await about.locator('input[name="major"]').fill(major);

    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes(`/members/${ownerId}`),
    );
    await about.getByRole('button', { name: 'Save' }).click();
    expect((await saved).ok()).toBe(true);
    // Read-only rows render only once the post-save revalidation lands.
    await expect(about.getByText(pronouns)).toBeVisible();

    await page.reload();
    await expect(about.getByText(pronouns)).toBeVisible();
    await expect(about.getByText(major)).toBeVisible();
    expect(await readProfile(ownerId)).toMatchObject({ pronouns, major });

    // A different member's session sees the same values and no edit control.
    await loginAs({ daliEmail: PEER });
    await page.goto(`/members/${ownerId}`);
    await expect(about.getByText(pronouns)).toBeVisible();
    await expect(about.getByText(major)).toBeVisible();
    await expect(about.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('a member cannot edit someone else profile', async ({ page, loginAs }) => {
    const before = await readProfile(ownerId);
    await loginAs({ daliEmail: PEER });
    await page.goto(`/members/${ownerId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Marcus Bell' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);

    const res = await page.request.post(`/members/${ownerId}`, {
      form: { intent: 'profile', firstName: 'Marcus', lastName: 'Bell', pronouns: 'hijacked', major: 'hijacked' },
    });
    expect(await res.text()).toContain("You don&#x27;t have permission to edit this member.");
    expect(await readProfile(ownerId)).toEqual(before);
  });

  test('compliance standing is shown to the member but not to a peer', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: OWNER });
    await page.goto(`/members/${ownerId}`);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { name: 'Standing' })).toBeVisible();

    await loginAs({ daliEmail: PEER });
    await page.goto(`/members/${ownerId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Marcus Bell' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Standing' })).toHaveCount(0);
  });
});

test.describe('groups', () => {
  const groupName = `E2E Group ${randomSuffix()}`;

  test.afterAll(async () => {
    await deleteGroupsNamed(groupName);
  });

  test('an admin creates a group, adds a member, and the roster persists', async ({ page, loginAs }) => {
    const miraId = await userIdByEmail('eng.lead@dali.dartmouth.edu');
    const theoId = await userIdByEmail('pm.lead@dali.dartmouth.edu');

    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await page.goto('/members/groups');
    await page.getByRole('button', { name: 'New group' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(groupName);
    await dialog.getByRole('button', { name: 'Members', exact: true }).click();
    await page.getByPlaceholder('Search by name or email').fill('Mira');
    await page.getByRole('option', { name: /Mira Chen/ }).click();
    await dialog.getByLabel('Name').click();
    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/members/groups'),
    );
    await dialog.getByRole('button', { name: 'Create group' }).click();
    expect((await created).ok()).toBe(true);
    await expect(dialog).toHaveCount(0);

    const card = page.locator('div.rounded-os-card').filter({ hasText: groupName }).last();
    await expect(card.getByText('1 member')).toBeVisible();
    await card.getByRole('button', { name: 'Expand group' }).click();
    await card.getByRole('button', { name: 'Add member' }).click();
    await card.getByPlaceholder('Search…').fill('Theo');
    const added = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/members/groups'),
    );
    await card.getByRole('button', { name: /Theo Abernathy/ }).click();
    expect((await added).ok()).toBe(true);

    await page.reload();
    const reloaded = page.locator('div.rounded-os-card').filter({ hasText: groupName }).last();
    await expect(reloaded.getByText('2 members')).toBeVisible();
    await reloaded.getByRole('button', { name: 'Expand group' }).click();
    await expect(reloaded.getByText('Theo Abernathy')).toBeVisible();
    await expect(reloaded.getByText('Mira Chen')).toBeVisible();

    const row = await findGroup(groupName);
    expect(row?.staticMemberIds.sort()).toEqual([miraId, theoId].sort());
  });

  test('a plain member cannot reach the groups page', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: PEER });
    await page.goto('/members/groups');
    await expect(page).toHaveURL(/\/members$/);
  });
});
