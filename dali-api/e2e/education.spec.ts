import { test, expect } from "./fixtures";

// Layout opens a TabWorkspace iframe whose title is the active sidebar
// section's label (see app/components/Layout.tsx → `activeSection.label`).
// Education has two sub-items: "Catalog" (matches /education and
// /education/offerings|enrolled) and "Manage" (matches /education/manage).

test.describe("education catalog", () => {
  test("Core member lands on the catalog and sees the Manage link", async ({ page, loginAs }) => {
    await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
    await page.goto("/education");
    await expect(page).toHaveURL(/\/education/);

    const frame = page.frameLocator('iframe[title="Catalog"]').first();
    await expect(frame.getByRole("heading", { name: "Education" })).toBeVisible();
    // Manage link is visible to Core; should be present in the catalog header.
    await expect(frame.getByRole("link", { name: /Manage offerings/ })).toBeVisible();
  });

  test("Core can open Manage and reach the New offering form", async ({ page, loginAs }) => {
    await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
    await page.goto("/education/manage");
    await expect(page).toHaveURL(/\/education\/manage/);

    const frame = page.frameLocator('iframe[title="Manage"]').first();
    await expect(frame.getByRole("heading", { name: "Manage offerings" })).toBeVisible();
    await frame.getByRole("link", { name: /\+ New offering/ }).click();
    await expect(frame.getByRole("heading", { name: "New offering" })).toBeVisible();
  });

  test("Catalog filters update the URL search params", async ({ page, loginAs }) => {
    await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
    await page.goto("/education");
    const frame = page.frameLocator('iframe[title="Catalog"]').first();

    // Wait for catalog hydration before interacting with the filter input.
    await expect(frame.getByRole("heading", { name: "Education" })).toBeVisible();
    const search = frame.getByPlaceholder(/Search/);
    await search.fill("zzznomatchzzz");
    await expect(page).toHaveURL(/q=zzznomatchzzz/);
    await expect(frame.getByText(/Nothing open right now|No matches/)).toBeVisible();
  });
});
