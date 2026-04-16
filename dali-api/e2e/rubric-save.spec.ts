import { test, expect } from '@playwright/test';

test('domain lead can save rubric selection', async ({ page }) => {
  // Log in as the engineering domain lead
  await page.goto('/dev-login-as?netId=f007el1&redirect=http://localhost:3001/domain-lead');
  await page.waitForURL('**/domain-lead**');

  // Take a screenshot so we can see the page
  await page.screenshot({ path: 'e2e/screenshots/domain-lead-loaded.png', fullPage: true });

  // Find the rubric picker
  const rubricSection = page.locator('text=Domain Rubric').first();
  const isVisible = await rubricSection.isVisible().catch(() => false);
  console.log('Rubric section visible:', isVisible);

  if (!isVisible) {
    // Maybe the page looks different, screenshot everything
    console.log('Page URL:', page.url());
    console.log('Page title:', await page.title());
    const bodyText = await page.locator('body').innerText();
    console.log('Body text (first 2000 chars):', bodyText.slice(0, 2000));
    return;
  }

  // Find the select and the save button within the rubric section's parent
  const rubricCard = page.locator('.bg-white.border', { has: page.locator('text=Domain Rubric') }).first();
  await rubricCard.screenshot({ path: 'e2e/screenshots/rubric-card.png' });

  const select = rubricCard.locator('select[name="rubricVersionId"]');
  const options = await select.locator('option').allTextContents();
  console.log('Rubric options:', options);

  // Select the first non-empty option
  const nonEmptyOptions = options.filter(o => o !== 'No rubric assigned');
  if (nonEmptyOptions.length === 0) {
    console.log('No rubric options available');
    return;
  }

  await select.selectOption({ index: 1 });
  console.log('Selected option index 1');

  // Click save
  const saveButton = rubricCard.locator('button[type="submit"]');
  console.log('Save button visible:', await saveButton.isVisible());
  console.log('Save button text:', await saveButton.innerText());

  // Listen for navigation/response
  const responsePromise = page.waitForResponse(resp => resp.url().includes('/domain-lead'), { timeout: 10000 }).catch(e => {
    console.log('No response caught:', e.message);
    return null;
  });

  await saveButton.click();
  console.log('Clicked save');

  const response = await responsePromise;
  if (response) {
    console.log('Response status:', response.status());
    console.log('Response URL:', response.url());
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e/screenshots/after-rubric-save.png', fullPage: true });

  console.log('Final URL:', page.url());
});
