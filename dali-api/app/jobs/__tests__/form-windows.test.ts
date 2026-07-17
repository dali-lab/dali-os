import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormWindows } from "~/jobs/form-windows.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const NOW = new Date("2026-07-15T12:00:00Z");
const LAST = new Date("2026-07-15T11:59:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.findMany.mockResolvedValue([]);
  mockPrisma.form.update.mockResolvedValue({});
  mockPrisma.form.updateMany.mockResolvedValue({ count: 0 });
});

describe("form-windows", () => {
  it("publishes forms whose opensAt crossed since the last run, minting a token", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "f1", publicToken: null, _count: { versions: 2 } },
      { id: "f2", publicToken: "tok-existing", _count: { versions: 1 } },
    ]);

    const result = await runFormWindows({
      now: NOW,
      lastSuccessAt: LAST,
      settings: {},
    });

    expect(mockPrisma.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { published: false, opensAt: { gt: LAST, lte: NOW } },
      }),
    );
    expect(mockPrisma.form.update).toHaveBeenCalledTimes(2);
    const first = mockPrisma.form.update.mock.calls[0][0];
    expect(first.where).toEqual({ id: "f1" });
    expect(first.data.published).toBe(true);
    expect(first.data.publicToken).toMatch(/^[0-9a-f]{48}$/); // freshly minted
    const second = mockPrisma.form.update.mock.calls[1][0];
    expect(second.data.publicToken).toBe("tok-existing"); // link stays stable
    expect(result.items).toBe(2);
  });

  it("skips forms with no versions, like manual publish does", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "f1", publicToken: null, _count: { versions: 0 } },
    ]);

    const result = await runFormWindows({
      now: NOW,
      lastSuccessAt: LAST,
      settings: {},
    });

    expect(mockPrisma.form.update).not.toHaveBeenCalled();
    expect(result.note).toContain("skippedNoVersions=1");
  });

  it("unpublishes forms whose closesAt crossed", async () => {
    mockPrisma.form.updateMany.mockResolvedValue({ count: 3 });

    const result = await runFormWindows({
      now: NOW,
      lastSuccessAt: LAST,
      settings: {},
    });

    expect(mockPrisma.form.updateMany).toHaveBeenCalledWith({
      where: { published: true, closesAt: { gt: LAST, lte: NOW } },
      data: { published: false },
    });
    expect(result.items).toBe(3);
  });

  it("bounds the first run to a 24h lookback instead of all history", async () => {
    await runFormWindows({ now: NOW, lastSuccessAt: null, settings: {} });

    const where = mockPrisma.form.findMany.mock.calls[0][0].where;
    expect(where.opensAt.gt).toEqual(new Date("2026-07-14T12:00:00Z"));
  });
});
