import { describe, it, expect, beforeEach, vi } from "vitest";

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  page: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }));
vi.mock("~/lib/page-names.server", () => ({ assertUniqueName: vi.fn() }));
vi.mock("~/lib/meeting-shares.server", () => ({ syncMeetingShares: vi.fn() }));

import { ensureOfferingFormsFolder } from "~/lib/pages";

beforeEach(() => {
  vi.resetAllMocks();
  tx.page.create.mockResolvedValue({ id: "forms" });
});

describe("ensureOfferingFormsFolder", () => {
  it("creates the Forms folder as a system folder of type OfferingForms", async () => {
    tx.page.findFirst.mockResolvedValue(null);
    expect(await ensureOfferingFormsFolder("off-1", "u1")).toBe("forms");
    expect(tx.page.create.mock.calls[0][0].data).toMatchObject({
      workspaceType: "EducationOffering",
      workspaceId: "off-1",
      title: "Forms",
      kind: "Folder",
      folderType: "OfferingForms",
    });
  });

  it("reuses an existing Forms folder", async () => {
    tx.page.findFirst.mockResolvedValue({ id: "existing" });
    expect(await ensureOfferingFormsFolder("off-1", "u1")).toBe("existing");
    expect(tx.page.create).not.toHaveBeenCalled();
  });
});
