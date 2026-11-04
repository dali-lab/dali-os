import { test, expect } from './fixtures';
import {
  createSigningFixture,
  countSignatures,
  removeSigningFixture,
  type SigningFixture,
} from './signing.helpers';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

// The agreement pages embed a collaborative editor whose load event can lag well
// behind the content, so wait for the DOM and assert on content instead.
const DOM = { waitUntil: 'domcontentloaded' as const };

test.describe('signing agreements', () => {
  let fx: SigningFixture;

  test.beforeAll(async () => {
    fx = await createSigningFixture({ mode: 'term-group' });
  });

  test.afterAll(async () => {
    if (fx) await removeSigningFixture(fx);
  });

  test('audience member fills the required field, signs, and Core sees the signature', async ({ page, loginAs }) => {
    // Core sees the signer as outstanding before they sign.
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await page.goto(`/documents/agreement/${fx.documentId}`, DOM);
    await expect(page.getByText('In force & signatories')).toBeVisible();
    await expect(page.getByText('Signed (0)')).toBeVisible();
    await expect(page.getByText(fx.signer.fullName)).toBeVisible();

    await loginAs({ daliEmail: fx.signer.daliEmail });
    await page.goto(`/sign/${fx.bindingId}`, DOM);
    await expect(page.getByRole('heading', { name: fx.documentName })).toBeVisible();

    // Required field empty: the click only hints, and nothing persists.
    await expect(page.getByText('Complete all required fields to sign.')).toBeVisible();
    await page.getByRole('button', { name: 'I agree and sign' }).click();
    await expect(page.getByText('Complete all required fields to sign.')).toBeVisible();
    expect(await countSignatures(fx.bindingId, fx.signer.id)).toBe(0);

    await page.getByPlaceholder('Type your full name to sign').fill(fx.signer.fullName);
    await expect(page.getByText('Complete all required fields to sign.')).toHaveCount(0);
    await page.getByRole('button', { name: 'I agree and sign' }).click();

    await expect(page.getByRole('heading', { name: `You have signed ${fx.documentName}` })).toBeVisible();
    expect(await countSignatures(fx.bindingId, fx.signer.id)).toBe(1);

    // The signed copy is still viewable after a reload, with the typed signature.
    await page.reload();
    await expect(page.getByRole('heading', { name: `You have signed ${fx.documentName}` })).toBeVisible();
    await expect(page.getByText(fx.signer.fullName).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /download pdf/i })).toBeVisible();

    // Core now sees the signature in the signatory list.
    await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
    await page.goto(`/documents/agreement/${fx.documentId}`, DOM);
    await expect(page.getByText('Signed (1)')).toBeVisible();
    await expect(page.getByRole('link', { name: fx.signer.fullName })).toBeVisible();
  });

  test('a member who already signed cannot sign again', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: fx.signer.daliEmail });
    await page.goto(`/sign/${fx.bindingId}`, DOM);
    await expect(page.getByRole('heading', { name: `You have signed ${fx.documentName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'I agree and sign' })).toHaveCount(0);

    const forged = page.waitForResponse((r) => r.url().includes(`/sign/${fx.bindingId}`) && r.request().method() === 'POST');
    await page.evaluate((bindingId) => {
      void fetch(`/sign/${bindingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ intent: 'sign', fieldValues: JSON.stringify({ 'forged': 'Someone Else' }) }),
      });
    }, fx.bindingId);
    await forged;
    expect(await countSignatures(fx.bindingId, fx.signer.id)).toBe(1);
  });

  test('a member outside the audience cannot open or sign it; non-Core cannot reach the console', async ({ page, loginAs }) => {
    await loginAs({ daliEmail: fx.outsider.daliEmail });

    await page.goto(`/sign/${fx.bindingId}`, DOM);
    await expect(page).not.toHaveURL(new RegExp(`/sign/${fx.bindingId}`));
    await expect(page.getByRole('button', { name: 'I agree and sign' })).toHaveCount(0);

    const forged = page.waitForResponse((r) => r.url().includes(`/sign/${fx.bindingId}`) && r.request().method() === 'POST');
    await page.evaluate((bindingId) => {
      void fetch(`/sign/${bindingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ intent: 'sign', fieldValues: JSON.stringify({ x: 'Grace' }) }),
      });
    }, fx.bindingId);
    await forged;
    expect(await countSignatures(fx.bindingId, fx.outsider.id)).toBe(0);

    await page.goto('/core/agreements', DOM);
    await expect(page).not.toHaveURL(/\/core\/agreements/);
    await page.goto(`/documents/agreement/${fx.documentId}`, DOM);
    await expect(page).not.toHaveURL(/\/documents\/agreement/);
  });
});

test.describe('signing agreements: enforced for a fixed group', () => {
  let fx: SigningFixture;

  test.beforeAll(async () => {
    fx = await createSigningFixture({ mode: 'fixed-group' });
  });

  test.afterAll(async () => {
    if (fx) await removeSigningFixture(fx);
  });

  test('only the group member sees it as outstanding', async ({ page }) => {
    // Log in straight onto /sign: "/" is where the app gate bounces a gated member.
    const loginTo = (email: string, to: string) =>
      page.goto(`/dev-login-as?daliEmail=${encodeURIComponent(email)}&redirect=${to}`, DOM);

    await loginTo(fx.outsider.daliEmail, '/sign');
    await expect(page.getByRole('heading', { name: 'Documents to sign' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(fx.documentName) })).toHaveCount(0);

    await loginTo(fx.signer.daliEmail, '/sign');
    await expect(page.getByRole('link', { name: new RegExp(fx.documentName) })).toBeVisible();
  });

  // App bug: resolveSigning() in app/signing/routes/sign.$bindingId.tsx calls
  // AUDIENCE_RESOLVERS[audience].includes(cohorts) without the AudienceContext
  // (audienceGroupId / userGroupIds) that listOutstandingBindings passes. For a
  // Group audience with a fixed group it falls back to "active this term", so a
  // group member who is not staffed this term is bounced from /sign/:id to "/",
  // which the app gate bounces back: an endless redirect.
  test.fixme('a fixed-group member can open and sign the agreement they are gated on', async ({ page }) => {
    await page.goto(`/dev-login-as?daliEmail=${encodeURIComponent(fx.signer.daliEmail)}&redirect=/sign/${fx.bindingId}`, DOM);
    await expect(page.getByRole('heading', { name: fx.documentName })).toBeVisible();
  });
});
