import { test, expect } from "./fixtures";

// Happy-path E2E for the Projects MVP. The Layout renders the active section
// inside an iframe titled with the sidebar label ("Projects" for /projects),
// so all assertions go through the iframe locator.

test("Projects directory loads for an admin and shows the New project button", async ({
  page,
  loginAs,
}) => {
  await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
  await page.goto("/projects");
  const frame = page.frameLocator('iframe[title="Projects"]');
  await expect(frame.getByRole("heading", { name: /^Projects/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(frame.getByRole("button", { name: /New project/i })).toBeVisible();
});

test("Project create → workspace → sprint → task happy path", async ({
  page,
  loginAs,
}) => {
  await loginAs({ daliEmail: "admin@dali.dartmouth.edu" });
  await page.goto("/projects");
  const frame = page.frameLocator('iframe[title="Projects"]');
  await expect(frame.getByRole("heading", { name: /^Projects/i })).toBeVisible({
    timeout: 15_000,
  });

  // Open create modal
  await frame.getByRole("button", { name: /New project/i }).click();

  const projectName = `E2E Smoke Project ${Date.now()}`;
  await frame.getByPlaceholder("e.g. Hood Museum AR Tour").fill(projectName);
  await frame.getByRole("button", { name: /Create project/i }).click();

  // Lands on the workspace
  await expect(frame.getByRole("heading", { name: projectName })).toBeVisible({
    timeout: 15_000,
  });
  await expect(frame.getByRole("link", { name: "Overview" })).toBeVisible();

  // Sprints tab → create a sprint
  await frame.getByRole("link", { name: "Sprints" }).click();
  await frame.getByRole("button", { name: /New sprint/i }).click();
  await frame
    .locator('input[type="text"]')
    .first()
    .fill("Sprint 1");
  await frame.getByRole("button", { name: "Create", exact: true }).click();
  await expect(frame.getByText("Sprint 1")).toBeVisible();

  // Tasks tab → create a task in backlog
  await frame.getByRole("link", { name: "Tasks" }).click();
  await frame.getByText("New task", { exact: true }).click();
  await frame.getByPlaceholder("Task title").fill("Smoke task");
  await frame.getByRole("button", { name: "Add", exact: true }).click();
  await expect(frame.getByText("Smoke task")).toBeVisible({ timeout: 5_000 });
});
