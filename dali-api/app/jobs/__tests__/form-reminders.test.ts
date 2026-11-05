import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/form-tracker.server", () => ({ sendCloseReminder: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { sendCloseReminder } from "~/forms/lib/form-tracker.server";
import { runFormReminders } from "~/jobs/form-reminders.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const H = 3600_000;
const NOW = new Date("2026-11-07T17:30:00Z");
const LAST = new Date(NOW.getTime() - H);
const ctx = (lastSuccessAt: Date | null = LAST) => ({ now: NOW, lastSuccessAt, settings: {} });
const where = () => db.form.findMany.mock.calls[0][0].where;

beforeEach(() => {
  vi.clearAllMocks();
  db.form.findMany.mockResolvedValue([]);
  vi.mocked(sendCloseReminder).mockResolvedValue(4);
});

describe("form-reminders", () => {
  it("looks at published forms with the setting on", async () => {
    await runFormReminders(ctx());
    expect(where()).toMatchObject({ published: true, remindBeforeClose: true });
  });

  it("acts when closesAt minus 24 hours falls in (lastSuccessAt, now]", async () => {
    await runFormReminders(ctx());
    expect(where().closesAt).toEqual({
      gt: new Date(LAST.getTime() + 24 * H),
      lte: new Date(NOW.getTime() + 24 * H),
    });
  });

  it("never reaches a form that has already closed", async () => {
    await runFormReminders(ctx(new Date(NOW.getTime() - 48 * H)));
    expect(where().closesAt.gt).toEqual(NOW);
  });

  it("looks back a day on the first run", async () => {
    await runFormReminders(ctx(null));
    expect(where().closesAt.gt).toEqual(NOW);
    expect(where().closesAt.lte).toEqual(new Date(NOW.getTime() + 24 * H));
  });

  it("reminds each due form and reports the people reached", async () => {
    db.form.findMany.mockResolvedValue([{ id: "f1" }, { id: "f2" }]);
    const result = await runFormReminders(ctx());
    expect(vi.mocked(sendCloseReminder).mock.calls.map((c) => c[0].formId)).toEqual(["f1", "f2"]);
    expect(result).toEqual({ items: 8, note: "forms=2 reminded=8" });
  });

  it("words the message with the form name and close date in lab time", async () => {
    db.form.findMany.mockResolvedValue([{ id: "f1" }]);
    await runFormReminders(ctx());
    const { message } = vi.mocked(sendCloseReminder).mock.calls[0][0];
    expect(message({ name: "Intake", closesAt: new Date("2026-11-08T03:00:00Z") } as never)).toBe(
      "You haven't filled out Intake yet. It closes Nov 7.",
    );
  });

  it("does nothing when no form is due", async () => {
    expect(await runFormReminders(ctx())).toEqual({ items: 0, note: "forms=0 reminded=0" });
    expect(sendCloseReminder).not.toHaveBeenCalled();
  });
});
