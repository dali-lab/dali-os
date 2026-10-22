import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";

const executeRaw = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => vi.clearAllMocks());

describe("setSubCalendarEnabled", () => {
  it("enabling appends in one statement, guarded against duplicates", async () => {
    await setSubCalendarEnabled("link-1", "cal-1", true);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0];
    expect(sqlOf(call)).toContain("array_append");
    expect(sqlOf(call)).toContain("ANY");
    expect(call.slice(1)).toEqual(["cal-1", "link-1", "cal-1"]);
  });

  it("disabling removes in one statement", async () => {
    await setSubCalendarEnabled("link-1", "cal-1", false);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const call = executeRaw.mock.calls[0];
    expect(sqlOf(call)).toContain("array_remove");
    expect(call.slice(1)).toEqual(["cal-1", "link-1"]);
  });

  it("never reads then writes the array", async () => {
    await setSubCalendarEnabled("link-1", "cal-1", true);
    expect(prisma.userCalendarLink.findUnique).not.toHaveBeenCalled();
    expect(prisma.userCalendarLink.update).not.toHaveBeenCalled();
  });
});
