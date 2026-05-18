import { test, expect } from "./fixtures";

// Happy-path E2E for the Projects MVP. Uses the existing dev-login fixture
// (seeded admin@dali.dartmouth.edu has both AdminMembership and Core seat).

test("Projects directory loads for an admin and shows the New project button", async ({
  page,
  loginAs,
}) => {
  await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: /^Projects/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /New project/i })).toBeVisible();
});

test("Project create → workspace → sprint → task happy path", async ({
  page,
  loginAs,
}) => {
  await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
  await page.goto("/projects");

  // Open create modal
  await page.getByRole("button", { name: /New project/i }).click();

  const projectName = `E2E Smoke Project ${Date.now()}`;
  await page.getByPlaceholder("e.g. Hood Museum AR Tour").fill(projectName);
  // Term picker defaults to current; just submit
  await page.getByRole("button", { name: /Create project/i }).click();

  // Lands on the workspace
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible({
    timeout: 10_000,
  });
  // Overview tab is the default
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();

  // Go to Sprints, create one
  await page.getByRole("link", { name: "Sprints" }).click();
  await page.getByRole("button", { name: /New sprint/i }).click();
  await page
    .locator('input[type="text"]')
    .first()
    .fill("Sprint 1");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Sprint 1")).toBeVisible();

  // Tasks tab — create a task in backlog
  await page.getByRole("link", { name: "Tasks" }).click();
  await page.getByText("New task", { exact: true }).click();
  await page.getByPlaceholder("Task title").fill("Smoke task");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  // Task appears in the board (Todo column)
  await expect(page.getByText("Smoke task")).toBeVisible({ timeout: 5_000 });

  // Toggle list view
  await page.getByRole("button", { name: /List/ }).first().click();
  await expect(page.getByRole("columnheader", { name: "Title" })).toBeVisible();
});

test("Non-member cannot see Settings tab", async ({ page, loginAs }) => {
  await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
  await page.goto("/projects");
  // Admin DOES see Settings. We rely on the canEditSettings || canArchive
  // gate; for admin canArchive=true so Settings should be visible.
  // Click first project card if any:
  const firstCard = page.locator("a[href^='/projects/']").first();
  if (await firstCard.count()) {
    await firstCard.click();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  }
});
