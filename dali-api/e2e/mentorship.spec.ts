import { test, expect } from './fixtures';
import { deleteMentorNote, readMentorNote, userIdByEmail } from './people.helpers';

// Seeded pair: admin mentors Mira Chen in the current term.
const MENTOR = 'admin@dali.dartmouth.edu';
const OUTSIDER = 'marcus.bell@dali.dartmouth.edu';

test.describe('mentor notes', () => {
  let noteId: string | undefined;

  test.afterAll(async () => {
    if (noteId) await deleteMentorNote(noteId);
  });

  test('a mentor opens a note for a mentee, rates the week, and an outsider cannot read it', async ({
    page,
    loginAs,
  }) => {
    const mentorId = await userIdByEmail(MENTOR);

    await loginAs({ daliEmail: MENTOR });
    await page.goto('/mentorship');
    await expect(page.getByRole('heading', { name: 'My mentees' })).toBeVisible();
    await expect(page.getByText('Mira Chen')).toBeVisible();

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/mentorship/notes'),
    );
    await page.getByRole('button', { name: /Open note for week/ }).first().click();
    const createdRes = await created;
    expect(createdRes.ok()).toBe(true);
    noteId = ((await createdRes.json()) as { id: string }).id;

    await expect(page).toHaveURL(new RegExp(`/mentorship/notes/${noteId}$`));
    await expect(page.getByRole('heading', { name: 'Notes on Mira Chen' })).toBeVisible();
    await expect(page.getByText('Author: Admin User')).toBeVisible();

    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(`/api/mentorship/notes/${noteId}`),
    );
    await page.getByRole('button', { name: 'Excellent' }).click();
    expect((await saved).ok()).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Excellent' })).toHaveAttribute('aria-pressed', 'true');
    expect(await readMentorNote(noteId)).toEqual({ vibe: 'Good', mentorId });

    // A member who is not a mentor or Core is turned away from the hub and the note.
    await loginAs({ daliEmail: OUTSIDER });
    await page.goto('/mentorship');
    await expect(page.getByRole('heading', { name: 'Error 403' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My mentees' })).toHaveCount(0);
    await page.goto(`/mentorship/notes/${noteId}`);
    await expect(page.getByRole('heading', { name: 'Error 403' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notes on Mira Chen' })).toHaveCount(0);
    const api = await page.request.get('/api/mentorship/notes');
    expect(api.status()).toBe(403);
  });
});
