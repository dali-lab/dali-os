import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));

import { prisma } from "~/lib/db";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import { listedFormsFor } from "~/forms/lib/public-form";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockFillAccess = fillAccessByPage as ReturnType<typeof vi.fn>;

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Lab Survey",
    publicToken: "tok-1",
    oneResponsePerMember: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.findMany.mockResolvedValue([]);
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockFillAccess.mockResolvedValue("ok");
});

describe("listedFormsFor", () => {
  it("queries only listed + published forms with a token", async () => {
    await listedFormsFor("user-1");
    expect(mockPrisma.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listed: true, published: true, publicToken: { not: null } },
      }),
    );
  });

  it("returns admitted forms with their fill link", async () => {
    mockPrisma.form.findMany.mockResolvedValue([formRow()]);

    expect(await listedFormsFor("user-1")).toEqual([
      { id: "form-1", name: "Lab Survey", fillUrl: "/forms/fill/tok-1" },
    ]);
  });

  it("filters forms whose page denies the viewer", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      formRow({ id: "f-open", publicToken: "t1" }),
      formRow({ id: "f-closed", publicToken: "t2" }),
    ]);
    mockFillAccess.mockImplementation(async (id: string) => (id === "f-open" ? "ok" : "denied"));

    expect((await listedFormsFor("user-1")).map((f) => f.id)).toEqual(["f-open"]);
    expect(mockFillAccess).toHaveBeenCalledWith("f-closed", "user-1", undefined);
  });

  it("drops one-response forms the member already submitted, keeps unfilled ones", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      formRow({ id: "f-done", publicToken: "t1", oneResponsePerMember: true }),
      formRow({ id: "f-open", publicToken: "t2", oneResponsePerMember: true }),
    ]);
    mockPrisma.formSubmission.findFirst
      .mockResolvedValueOnce({ id: "sub-1", createdAt: new Date() }) // f-done
      .mockResolvedValueOnce(null); // f-open

    const result = await listedFormsFor("user-1");
    expect(result.map((f) => f.id)).toEqual(["f-open"]);
  });
});
