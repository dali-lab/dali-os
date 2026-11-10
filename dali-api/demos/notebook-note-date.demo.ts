import { expect, test } from './lib/demo';

test('put an independent notebook note in the right week', async ({ page, stage, loginAs }) => {
  await loginAs({ daliEmail: 'admin@dali.dartmouth.edu' });
  const notebookResponse = await page.request.post('/api/notebooks', {
    data: { title: 'Project journal', workspaceType: 'Lab' },
  });
  expect(notebookResponse.ok()).toBe(true);
  const notebook = await notebookResponse.json();
  const noteResponse = await page.request.post(`/api/notebooks/${notebook.id}`, {
    data: { intent: 'new-note' },
  });
  expect(noteResponse.ok()).toBe(true);
  const note = await noteResponse.json();
  expect((await page.request.post(`/api/documents/${note.id}`, {
    data: { title: 'Research notes' },
  })).ok()).toBe(true);
  expect((await page.request.post(`/api/pages/${note.id}/date`, {
    data: { date: null },
  })).ok()).toBe(true);
  const overviewResponse = await page.request.post(`/api/notebooks/${notebook.id}`, {
    data: { intent: 'new-note' },
  });
  expect(overviewResponse.ok()).toBe(true);
  const overview = await overviewResponse.json();
  expect((await page.request.post(`/api/documents/${overview.id}`, {
    data: { title: 'Overview' },
  })).ok()).toBe(true);
  expect((await page.request.post(`/api/pages/${overview.id}/date`, {
    data: { date: null },
  })).ok()).toBe(true);

  await page.goto(`/documents/${note.id}`);
  await stage.click(page.getByRole('button', { name: 'Options for Research notes' }));
  await stage.click(page.getByRole('menuitem', { name: 'Set date…', exact: true }));
  const modal = page.getByRole('dialog', { name: 'When did this note happen?' });
  await expect(modal.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await stage.click(modal.getByRole('button', { name: 'Note date' }));
  // Use the current month so the chosen date stays within the rolling seed term.
  const day = page.locator('[data-datefield-popover] [data-day]').nth(13);
  const date = await day.getAttribute('data-day');
  await stage.click(day);
  await stage.click(modal.getByRole('button', { name: 'Save', exact: true }));
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('notebook-rail-week')).toHaveCount(1);
  await stage.pause(900);

  // Reload verifies the route, database write, and loader date conversion together.
  await page.reload();
  await stage.click(page.getByRole('button', { name: 'Options for Research notes' }));
  await stage.click(page.getByRole('menuitem', { name: 'Change date…', exact: true }));
  await stage.click(modal.getByRole('button', { name: 'Note date' }));
  await expect(page.locator(`[data-datefield-popover] [data-day="${date}"]`)).toHaveClass(/bg-os-accent/);
  await stage.click(page.locator('[data-datefield-popover] [data-day]').nth(20));
  await stage.click(modal.getByRole('button', { name: 'Save', exact: true }));
  await expect(modal).toBeHidden();

  await stage.click(page.getByRole('button', { name: 'Options for Research notes' }));
  await stage.click(page.getByRole('menuitem', { name: 'Change date…', exact: true }));
  await stage.click(modal.getByRole('button', { name: 'Clear date', exact: true }));
  await expect(modal).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Options for Research notes' })).toBeVisible();
  await expect(page.getByTestId('notebook-rail-week')).toHaveCount(0);
  await stage.pause(600);
});
