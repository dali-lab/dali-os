import { test, expect } from "./fixtures";

// Background jobs: admin panel controls + the tick trigger. The tick route
// accepts an authenticated Admin session (no JOBS_TICK_SECRET needed in CI).

const ADMIN = { daliEmail: "admin@dali.dartmouth.edu" };

test.describe("admin jobs panel", () => {
  test.beforeEach(async ({ loginAs }) => {
    await loginAs(ADMIN);
  });

  test("lists registered jobs with controls", async ({ page }) => {
    await page.goto("/admin/platform/jobs");

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
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("toggle persists across reload", async ({ page }) => {
    await page.goto("/admin/platform/jobs");

    // The switch's <input> is visually hidden (sr-only), so a forced click at its
    // centre can land beside the drawn track and toggle nothing. Click the track
    // (the input's parent), the way a person does.
    const track = (sw: import("@playwright/test").Locator) => sw.locator("..");
    const row = page.locator("li", { hasText: "session-feedback-sweep" });
    const saved = () =>
      page.waitForResponse(
        (r) => r.request().method() === "PATCH" && r.url().includes("/api/jobs/session-feedback-sweep"),
      );
    // Reloading before the PATCH lands drops the change.
    const paused = saved();
    await track(row.getByRole("switch", { name: "Pause session-feedback-sweep" })).click();
    await paused;
    await expect(row.getByText("Paused", { exact: true }).first()).toBeVisible();

    await page.reload();
    const rowAfter = page.locator("li", { hasText: "session-feedback-sweep" });
    const resume = rowAfter.getByRole("switch", { name: "Resume session-feedback-sweep" });
    await expect(resume).not.toBeChecked();

    // Restore for other tests.
    const resumed = saved();
    await track(resume).click();
    await resumed;
    await expect(
      rowAfter.getByRole("switch", { name: "Pause session-feedback-sweep" }),
    ).toBeChecked();
  });

  test("Run now executes a job and records the run", async ({ page }) => {
    await page.goto("/admin/platform/jobs");

    const row = page.locator("li", { hasText: "scheduled-announcements" });
    await row.getByRole("button", { name: "Run now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Run now" }).click();
    await expect(row.getByText(/Healthy|Failing/)).toBeVisible({ timeout: 15_000 });
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
