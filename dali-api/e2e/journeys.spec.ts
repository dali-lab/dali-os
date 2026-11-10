import { test, expect } from './fixtures';
import { setFeatureFlag } from './helpers';
import { resetJourneyProgress } from './education.helpers';

// Seeded demo journey (prisma/seeds/journeys-demo): "PM essentials" in the PM
// domain. pm-welcome -> partner-discovery -> writing-tickets (has a quiz).
const JOURNEY_ID = 'demo-journey-pm-essentials';
const BASE = `/journeys/pm/${JOURNEY_ID}`;
const LEARNER = 'priya.raman@dali.dartmouth.edu';

test.setTimeout(120_000);

const isProgressPost = (r: import('@playwright/test').Response) =>
  r.request().method() === 'POST' && (r.request().postData() ?? '').includes('complete') && r.url().includes(`/journeys/pm/${JOURNEY_ID}/`);

test.describe.serial('journey progress', () => {
  test.beforeAll(async () => {
    await resetJourneyProgress(JOURNEY_ID, LEARNER);
    await setFeatureFlag('onboarding-journeys', true);
  });

  test.afterAll(async () => {
    await resetJourneyProgress(JOURNEY_ID, LEARNER);
    await setFeatureFlag('onboarding-journeys', false);
  });

  test('a locked module opens only after its prerequisite is completed, and that persists', async ({
    page,
    loginAs,
  }) => {
    await loginAs({ daliEmail: LEARNER });
    // The flag is cached ~15s server-side.
    await expect(async () => {
      await page.goto(`${BASE}/partner-discovery`);
      await expect(page.getByRole('heading', { name: 'This module is locked' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await page.goto(`${BASE}/pm-welcome`);
    await expect(page.getByRole('heading', { name: 'Welcome to DALI Product' })).toBeVisible();
    const saved = page.waitForResponse(isProgressPost);
    await page.getByRole('button', { name: 'Mark module complete' }).click();
    expect((await saved).ok()).toBe(true);
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark module complete' })).toHaveCount(0);

    await page.goto(`${BASE}/partner-discovery`);
    await expect(page.getByRole('heading', { name: 'This module is locked' })).toHaveCount(0);
    await expect(page.getByText('Ready to start')).toBeVisible();
  });

  test('passing a quiz step is recorded and survives a reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: LEARNER });
    await page.goto(`${BASE}/partner-discovery`);
    const saved = page.waitForResponse(isProgressPost);
    await page.getByRole('button', { name: 'Mark module complete' }).click();
    expect((await saved).ok()).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();

    await page.goto(`${BASE}/writing-tickets?view=quiz`);
    await page.getByText('Split it into smaller tickets').click();
    const answers = page.getByRole('textbox');
    await answers.nth(0).fill('why');
    await answers.nth(1).fill('Warn when weekly hours exceed 20');
    await page.getByRole('button', { name: 'Check answers' }).click();
    await expect(page.getByText(/Passed · \d of 3 correct/)).toBeVisible();
    // This module also has a lab, so passing the quiz moves on to the lab
    // instead of completing the module; the quiz step itself is recorded.
    const done = page.waitForResponse(isProgressPost);
    await page.getByRole('button', { name: 'Continue to lab' }).first().click();
    expect((await done).ok()).toBe(true);

    await page.goto(`${BASE}/writing-tickets?view=quiz`);
    await expect(page.getByText("You've already passed this quiz.")).toBeVisible();
  });
});
