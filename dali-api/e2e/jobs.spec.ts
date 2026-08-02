import { test, expect } from "./fixtures";

// Background jobs: admin panel controls + the tick trigger. The tick route
// accepts an authenticated Admin session (no JOBS_TICK_SECRET needed in CI).

const ADMIN = { daliEmail: "admin@dali.dartmouth.edu" };

// /admin/jobs renders inside the workspace iframe (same convention
// as the other admin specs).
const adminFrame = (page: import("@playwright/test").Page) =>
  page.frameLocator('iframe[title="Admin"]');

test.describe("admin jobs panel", () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs(ADMIN);
  });

  test("lists registered jobs with controls", async ({ page }) => {
    await page.goto("/admin/jobs");
    const frame = adminFrame(page);

    for (const name of [
      "task-due-reminders",
      "meeting-reminders",
      "scheduled-announcements",
      "session-feedback-sweep",
      "notification-digest-daily",
      "notification-digest-weekly",
      "interview-reminders",
      "form-windows",
      "sprint-lifecycle",
      "standup-prompts",
      "retention-janitor",
    ]) {
      await expect(frame.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("toggle persists across reload", async ({ page }) => {
    await page.goto("/admin/jobs");
    const frame = adminFrame(page);

    const row = frame.locator("tr", { hasText: "session-feedback-sweep" });
    await row.getByRole("button", { name: /Enabled|Disabled/ }).click();
    await expect(row.getByRole("button", { name: "Disabled" })).toBeVisible();

    await page.reload();
    const rowAfter = adminFrame(page).locator("tr", {
      hasText: "session-feedback-sweep",
    });
    await expect(rowAfter.getByRole("button", { name: "Disabled" })).toBeVisible();

    // Restore for other tests.
    await rowAfter.getByRole("button", { name: "Disabled" }).click();
    await expect(rowAfter.getByRole("button", { name: "Enabled" })).toBeVisible();
  });

  test("Run now executes a job and records the run", async ({ page }) => {
    await page.goto("/admin/jobs");
    const frame = adminFrame(page);

    const row = frame.locator("tr", { hasText: "scheduled-announcements" });
    await row.getByRole("button", { name: "Run now" }).click();
    await expect(row.getByText(/Success|Error/)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("tick route", () => {
  test("rejects unauthenticated calls and accepts an admin session", async ({
    page,
    loginAs,
  }) => {
    const anon = await page.request.post("/internal/jobs/tick", { data: {} });
    expect(anon.status()).toBe(403);

    await loginAs(ADMIN);
    const res = await page.request.post("/internal/jobs/tick", {
      data: { job: "session-feedback-sweep" },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok: boolean; ran: string[] };
    expect(body.ok).toBe(true);
    expect(body.ran).toEqual(["session-feedback-sweep"]);
  });
});
