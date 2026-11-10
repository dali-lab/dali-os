import pg from 'pg';
import { expect, type Page } from '@playwright/test';

export const FORM_CREATOR = 'admin@dali.dartmouth.edu';

/** Creates an unplaced, lab-visible form through the same endpoint the Drive "New form" flow posts to. */
export async function createForm(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/forms', { form: { intent: 'create-form', name } });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { formId?: string; id?: string };
  const id = body.formId ?? body.id;
  expect(id).toBeTruthy();
  return id!;
}

/** Adds a question from the "Add question" menu and fills its label. */
export async function addQuestion(page: Page, menuLabel: string, label: string) {
  await page.getByRole('button', { name: 'Add a question' }).click();
  await page.getByRole('menuitem', { name: menuLabel }).click();
  await page.getByPlaceholder('e.g. What is your major?').fill(label);
}

/** The published form's public fill token, read straight from the DB (the UI only exposes it via a copy button). */
export async function fillTokenFor(formId: string): Promise<string> {
  const client = new pg.Client(process.env.DATABASE_URL || 'postgresql://dali:dali@localhost:5432/dali');
  await client.connect();
  try {
    const { rows } = await client.query('SELECT "publicToken" FROM "Form" WHERE id = $1', [formId]);
    expect(rows[0]?.publicToken).toBeTruthy();
    return rows[0].publicToken as string;
  } finally {
    await client.end();
  }
}

/** Opens the builder and waits for the collaborative editor to finish loading before anything is typed. */
export async function openBuilder(page: Page, formId: string) {
  await page.goto(`/forms/edit/${formId}`);
  await expect(page.getByText('Loading editor…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Add a question' })).toBeEnabled();
}
