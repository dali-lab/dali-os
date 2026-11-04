import { test, expect } from './fixtures';
import { ORGANIZER, GUEST, OUTSIDER, ROOM, randomId, farDay, at, userId, createMeeting, cleanup } from './calendar.helpers';

test.use({ timezoneId: 'UTC' });

const run = randomId();
const suffix = `e2e-cal-${run}`;

test.afterAll(async () => {
  await cleanup(suffix);
});

test.describe('meeting with a guest and a room', () => {
  const day = farDay();
  const title = `Sprint sync ${suffix}`;
  let meetingId: string;

  test.beforeAll(async ({ playwright, baseURL }) => {
    test.setTimeout(120_000);
    const ctx = await playwright.request.newContext({ baseURL });
    await ctx.get(`/dev-login-as?daliEmail=${ORGANIZER.email}`);
    meetingId = await createMeeting(ctx, {
      title,
      guestId: await userId(GUEST.email),
      startIso: at(day, '15:00'),
      roomIds: [ROOM.id],
    });
    await ctx.dispose();
  });

  test('organizer sees it with its room', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ORGANIZER.email });
    await page.goto(`/calendar/meeting/${meetingId}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(ROOM.name).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit event' })).toBeVisible();
  });

  test('the guest can open it but not edit it, and an uninvited member cannot see it', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: GUEST.email });
    await page.goto(`/calendar/meeting/${meetingId}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(ORGANIZER.name).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit event' })).toHaveCount(0);

    await loginAs({ daliEmail: OUTSIDER.email });
    const res = await page.goto(`/calendar/meeting/${meetingId}`);
    expect(res?.status()).toBe(404);
  });

  test('the meeting holds the room on the Rooms timeline', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: GUEST.email });
    await page.goto(`/rooms?date=${day}`);
    await expect(page.getByRole('button', { name: new RegExp(`^${title}, .*${ORGANIZER.name}$`) })).toBeVisible();
  });

  test('a booking that overlaps the meeting is refused, a free time is booked', async ({ page, loginAs }) => {
    const bookTitle = `Pairing ${suffix}`;
    await loginAs({ daliEmail: GUEST.email });
    await page.goto(`/rooms?date=${day}`);

    const book = async (from: string, to: string) => {
      await page.getByRole('button', { name: 'Book', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const starts = dialog.getByRole('combobox', { name: 'Starts' });
      const ends = dialog.getByRole('combobox', { name: 'Ends' });
      // The slot the dialog opens on depends on the wall clock, so move the start out of the way first.
      await starts.fill('7:00 AM');
      await starts.press('Enter');
      await ends.fill(to);
      await ends.press('Enter');
      await expect(ends).toHaveValue(to);
      await starts.fill(from);
      await starts.press('Enter');
      await expect(starts).toHaveValue(from);
      await dialog.getByLabel('What for').fill(bookTitle);
      const saved = page.waitForResponse((r) => r.url().includes('/bookings') && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Book', exact: true }).click();
      return (await saved).status();
    };

    expect(await book('3:30 PM', '4:30 PM')).toBe(409);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    expect(await book('5:00 PM', '6:00 PM')).toBe(201);
    await expect(page.getByText(`Booked ${ROOM.name}.`)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: new RegExp(`^${bookTitle}, `) })).toBeVisible();
  });
});

test.describe('editing a meeting', () => {
  const day = farDay();
  const title = `Design review ${suffix}`;
  const newTitle = `Design critique ${suffix}`;
  let meetingId: string;

  test.beforeAll(async ({ playwright, baseURL }) => {
    test.setTimeout(120_000);
    const ctx = await playwright.request.newContext({ baseURL });
    await ctx.get(`/dev-login-as?daliEmail=${ORGANIZER.email}`);
    meetingId = await createMeeting(ctx, {
      title,
      guestId: await userId(GUEST.email),
      startIso: at(day, '19:00'),
    });
    await ctx.dispose();
  });

  // App bug: updateScheduledMeeting selects a nonexistent `startTime` field (app/lib/scheduled-meeting.ts:2059),
  // so every edit of a meeting 500s with PrismaClientValidationError.
  test.fixme('the organizer renames it and the guest sees the new name', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ORGANIZER.email });
    await page.goto(`/calendar/meeting/${meetingId}`);
    await page.getByRole('button', { name: 'Edit event' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit event' });
    await dialog.getByLabel('Title').fill(newTitle);
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/api/scheduled-meetings/${meetingId}/update`) && r.request().method() !== 'GET',
    );
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    const res = await saved;
    expect(res.ok(), await res.text()).toBe(true);
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: newTitle })).toBeVisible();

    await loginAs({ daliEmail: GUEST.email });
    await page.goto(`/calendar/meeting/${meetingId}`);
    await expect(page.getByRole('heading', { level: 1, name: newTitle })).toBeVisible();
  });
});

test.describe('timesheet', () => {
  const day = farDay();
  const note = `Wrote the onboarding guide ${suffix}`;

  test('logging hours shows them in the timesheet after a reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: ORGANIZER.email });
    await page.goto(`/calendar?anchor=${day}`);
    await page.getByRole('tab', { name: 'Timesheet' }).click();
    await page.getByRole('button', { name: 'Log hours' }).click();
    const dialog = page.getByRole('dialog', { name: 'New timesheet entry' });
    await dialog.getByPlaceholder('What did you work on?').fill(note);
    const saved = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/calendar'));
    await dialog.getByRole('button', { name: 'Add entry' }).click();
    const added = await saved;
    expect(added.ok(), added.url()).toBe(true);

    await page.reload();
    await page.getByRole('tab', { name: 'Timesheet' }).click();
    await page.getByLabel('Hours totalled over').getByRole('tab', { name: 'Week' }).click();
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText('Total').locator('..')).toContainText('1.0h');
  });
});
