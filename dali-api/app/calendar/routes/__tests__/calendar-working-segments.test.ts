import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { submitCalendarAction } from "~/calendar/routes/calendar.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const whd = () => mockPrisma.workingHoursDay!;

function request(fields: Record<string, string>) {
  const body = new FormData();
  body.set("intent", "set-working-segments");
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/calendar", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "member-1", type: "member" } } as never);
  (mockPrisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: unknown) => unknown) => cb(prisma),
  );
});

describe("set-working-segments", () => {
  it("replaces only the submitted day and leaves other days alone", async () => {
    const res = await submitCalendarAction(
      request({
        dayOfWeek: "3",
        segments: JSON.stringify([{ startMinute: 540, endMinute: 720, location: "Remote" }]),
      }),
    );

    expect(res).toBeNull();
    expect(whd().deleteMany).toHaveBeenCalledTimes(1);
    expect(whd().deleteMany).toHaveBeenCalledWith({ where: { userId: "member-1", dayOfWeek: 3 } });
    expect(whd().createMany).toHaveBeenCalledWith({
      data: [
        { userId: "member-1", dayOfWeek: 3, enabled: true, startMinute: 540, endMinute: 720, location: "Remote" },
      ],
    });
  });

  it("writes a disabled sentinel row when the day has zero segments", async () => {
    await submitCalendarAction(request({ dayOfWeek: "0", segments: "[]" }));

    expect(whd().createMany).not.toHaveBeenCalled();
    expect(whd().create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "member-1", dayOfWeek: 0, enabled: false }),
    });
  });

  it("works for a day with no existing row", async () => {
    const res = await submitCalendarAction(
      request({
        dayOfWeek: "6",
        segments: JSON.stringify([{ startMinute: 600, endMinute: 660, location: "InPerson" }]),
      }),
    );

    expect(res).toBeNull();
    expect(whd().createMany).toHaveBeenCalled();
  });

  it("rejects a segment that ends before it starts without touching the DB", async () => {
    const res = (await submitCalendarAction(
      request({
        dayOfWeek: "2",
        segments: JSON.stringify([{ startMinute: 700, endMinute: 600, location: "InPerson" }]),
      }),
    )) as Response;

    expect(res.status).toBe(400);
    expect(whd().deleteMany).not.toHaveBeenCalled();
  });
});
