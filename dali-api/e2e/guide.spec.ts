import { test, expect } from './fixtures';
import { clearGuideSetup, satisfyGuideSetup } from './helpers';

// The interactive guide, in the suite's tabbed mode — which also exercises the
// cross-frame path, since /help renders in a workspace iframe while the guide
// card lives in the shell.
//
// Runs as design.lead rather than admin. These specs have to put the member in
// "owes required setup" state, and in that state the guide auto-opens on every
// page with a spotlight that blocks clicks — which would break any spec sharing
// the account while these run. Twelve specs use admin; none use this member.
// Same isolation-by-user reasoning as the drive-flag helpers.

const CARD = '.fixed.bottom-4.right-4';

/** Open the guide at step one. */
async function openGuide(page: import('@playwright/test').Page) {
  await page.goto('/help');
  // Every step is outstanding after clearGuideSetup, so the shell auto-opens
  // the guide on load and the intro modal is waiting. Retry the click: under
  // parallel load the button can be painted before React has hydrated, and a
  // click that lands first does nothing at all.
  const intro = page.getByRole('button', { name: /Show me around|Pick up where I left off/ });
  const card = page.locator(CARD);
  await expect(async () => {
    if (await intro.count()) await intro.click();
    await expect(card).toContainText('Step 1 of', { timeout: 2_000 });
  }).toPass({ timeout: 25_000 });
  return card;
}

test.describe('interactive guide', () => {
  const MEMBER = 'design.lead@dali.dartmouth.edu';

  test.beforeEach(async ({ loginAs }) => {
    await loginAs({ daliEmail: MEMBER });
    await clearGuideSetup(MEMBER);
  });

  // Leave the account settled so a later run (or a parallel worker that picks
  // this member up) isn't met by an auto-opening guide.
  test.afterEach(async () => {
    await satisfyGuideSetup(MEMBER);
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
    await expect(card).toContainText('Anything waiting on you');
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

  test('dismissing snoozes the guide but it returns at the step still owed', async ({ page }) => {
    const card = await openGuide(page);

    // Leaving is always allowed — the guide never traps anyone on a page.
    await card.getByRole('button', { name: 'Finish later' }).click();
    await expect(card).toHaveCount(0);

    // ...but a required step is still owed, so the next navigation brings it
    // back. Without this, one click on "Finish later" at a gated step escapes
    // the gate permanently and the required steps aren't required at all.
    await page.locator('aside').getByRole('button', { name: /^Projects/ }).first().click();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // It returns on what's missing rather than restarting the walkthrough, and
    // since that's a gated step the page stays usable.
    await expect(card).toContainText('Add a photo');
    await expect(page.locator('.cursor-not-allowed')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('the Help page can reopen the guide from inside the workspace iframe', async ({ page }) => {
    // A settled member: nothing outstanding, guide already dismissed, so the
    // shell won't auto-open it and no spotlight is covering the page.
    await satisfyGuideSetup(MEMBER);
    await page.goto('/help');
    await expect(page.locator(CARD)).toHaveCount(0);

    // /help renders in a workspace iframe while the guide card lives in the
    // shell, so this only works if the click crosses the frame boundary.
    await page
      .frameLocator('iframe[title="Help"]')
      .getByRole('button', { name: /Run the guide again|Continue the guide|Start the guide/ })
      .click();
    await expect(
      page.getByRole('button', { name: /Show me around|Pick up where I left off/ }),
    ).toBeVisible({ timeout: 10_000 });
  });

});
