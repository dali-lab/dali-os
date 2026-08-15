import { test, expect } from './fixtures';

// The guide's spotlight is an interaction lock: while a step points at
// something, the only live surfaces are that element and the guide card. These
// run in the suite's tabbed mode, so they also cover the cross-frame path —
// /help renders in a workspace iframe while the guide card lives in the shell.

async function openGuide(page: import('@playwright/test').Page) {
  await page.goto('/help');
  // The guide is resumable and its progress is per-user server state, so a
  // previous run would otherwise leave this member part-way through and the
  // intro modal would be skipped. Reset so every test starts at step one.
  await page.request.post('/api/tour/progress', { form: { intent: 'reset' } });
  await page.reload();
  const help = page.frameLocator('iframe[title="Help"]');
  await help.getByRole('button', { name: /Continue the guide|Start the guide/ }).click();
  const intro = page.getByRole('button', { name: /Show me around|Pick up where I left off/ });
  await intro.waitFor({ state: 'visible' });
  await intro.click();
  const card = page.locator('.fixed.bottom-4.right-4');
  await expect(card).toContainText('Step 1 of');
  return card;
}

test.describe('interactive guide', () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  });

  test('spotlight blocks everything except its target and the card', async ({ page }) => {
    const card = await openGuide(page);

    // An unrelated sidebar item is behind the blocker: a real click at its
    // coordinates must not navigate and must not advance the step.
    const projects = page.locator('aside').getByRole('button', { name: /^Projects/ }).first();
    const box = await projects.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/help/);
    await expect(card).toContainText('Step 1 of');

    // The card stays live so the member can always leave.
    await expect(card.getByRole('button', { name: 'Finish later' })).toBeEnabled();

    // The spotlit target itself still takes the click.
    const tasks = page.locator('aside').getByRole('button', { name: /^My Tasks/ }).first();
    const target = await tasks.boundingBox();
    await page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2);
    await expect(card).toContainText("Anything waiting on you");
  });

  test('a gated step leaves the page interactive and blocks Next', async ({ page }) => {
    const card = await openGuide(page);

    // Walk to the first gate. Every step before it is click-driven or info-only.
    for (let i = 0; i < 12; i++) {
      if (await card.getByText('Add a photo', { exact: true }).count()) break;
      const imThere = card.getByRole('button', { name: "I'm there" });
      if (await imThere.count()) await imThere.click();
      const next = card.getByRole('button', { name: 'Next' });
      await expect(next).toBeEnabled();
      await next.click();
    }

    await expect(card).toContainText('Add a photo');
    // No spotlight on a gated step: the member has to reach their profile to
    // satisfy it, so the page must stay usable.
    await expect(page.locator('.cursor-not-allowed')).toHaveCount(0);
    // ...but the gate itself holds.
    await expect(card.getByRole('button', { name: 'Next' })).toBeDisabled();
    await expect(card.getByRole('button', { name: "I'm there" })).toHaveCount(0);
  });
});
