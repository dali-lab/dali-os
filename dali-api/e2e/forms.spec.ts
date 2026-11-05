import { test, expect } from './fixtures';
import { addQuestion, createForm, fillTokenFor, FORM_CREATOR, openBuilder } from './forms.helpers';

// One form, three roles: the creator builds and publishes it, a second lab
// member fills it, the creator reads the response, and people without edit
// access are kept out of the builder and the responses.
test.describe.configure({ mode: 'serial' });
// The shared server is busy with other suites; the builder's first load is the slow step.
test.setTimeout(90_000);

const suffix = Math.random().toString(36).slice(2, 8);
const FORM_NAME = `E2E survey ${suffix}`;
const NAME_Q = `Your full name ${suffix}`;
const COLOR_Q = `Favorite color ${suffix}`;
const ANSWER = `Ada Lovelace ${suffix}`;

let formId = '';
let fillToken = '';

test.describe('Forms', () => {
  test('creator builds a form with two questions, publishes it, and the edits survive a reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: FORM_CREATOR });
    formId = await createForm(page, FORM_NAME);
    await openBuilder(page, formId);

    await addQuestion(page, 'Short answer', NAME_Q);
    await page.getByRole('button', { name: 'Done' }).click();

    await addQuestion(page, 'Multiple choice', COLOR_Q);
    await page.locator('textarea').last().fill('Red\nBlue');
    await page.getByText('Required field').click(); // questions default to required; make this one optional
    await page.getByRole('button', { name: 'Done' }).click();

    const saved = page.waitForResponse(
      (r) => r.url().includes(`/forms/edit/${formId}`) && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await saved;
    await expect(page.getByText('v1 · Published')).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByText(NAME_Q)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COLOR_Q)).toBeVisible();
    await expect(page.getByText('Required', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('v1 · Published')).toBeVisible();
    fillToken = await fillTokenFor(formId);
  });

  test('a member cannot submit with the required question empty, then submits and sees the confirmation', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
    await page.goto(`/forms/fill/${fillToken}`);
    await expect(page.getByText(FORM_NAME).first()).toBeVisible();

    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(`"${NAME_Q}" is required.`)).toBeVisible();
    await expect(page.getByText('has been recorded')).toHaveCount(0);

    await page.getByRole('textbox').first().fill(ANSWER);
    const submitted = page.waitForResponse(
      (r) => r.url().includes(`/api/forms/fill/${fillToken}`) && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Submit' }).click();
    expect((await submitted).ok()).toBe(true);
    await expect(page.getByText(`Your response to “${FORM_NAME}” has been recorded.`)).toBeVisible();

  });

  test('the creator sees the response after a reload', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: FORM_CREATOR });
    await page.goto(`/forms/edit/${formId}?view=results&show=responses`);
    await expect(page.getByText('Mira Chen').first()).toBeVisible();
    await expect(page.getByText(ANSWER).first()).toBeVisible();

    await page.goto(`/forms/edit/${formId}?view=results`);
    await expect(page.getByText('1 response', { exact: true })).toBeVisible();
    await expect(page.getByText('1 answered, 0 skipped')).toBeVisible();
    await expect(page.getByText('0 answered, 1 skipped')).toBeVisible();
  });

  test('members without edit access cannot open the builder or read responses', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: 'eng.lead@dali.dartmouth.edu' });
    for (const url of [`/forms/edit/${formId}`, `/forms/edit/${formId}?view=results&show=responses`, `/forms/responses/${formId}`]) {
      await page.goto(url, { waitUntil: 'commit' }); // the server redirects, which aborts a 'load' wait
      await expect(page).toHaveURL(new RegExp(`/forms/fill/${fillToken}`));
      await expect(page.getByText(FORM_NAME).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add a question' })).toHaveCount(0);
      await expect(page.getByText(ANSWER)).toHaveCount(0);
    }

    const denied = await page.request.post('/api/forms', {
      form: { intent: 'unpublish-form', id: formId },
    });
    expect(denied.status()).toBe(403);

    await loginAs({ daliEmail: FORM_CREATOR });
    await page.goto(`/forms/edit/${formId}`);
    await expect(page.getByText('v1 · Published')).toBeVisible();
  });
});
