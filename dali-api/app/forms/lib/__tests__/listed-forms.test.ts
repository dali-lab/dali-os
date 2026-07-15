import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  requireMember: vi.fn(),
}));
vi.mock("~/lib/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/groups")>()),
  isUserInAnyGroup: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireMember } from "~/lib/roles";
import { isUserInAnyGroup } from "~/lib/groups";
import { listedFormsFor } from "~/forms/lib/public-form";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockMember = requireMember as ReturnType<typeof vi.fn>;
const mockInGroup = isUserInAnyGroup as ReturnType<typeof vi.fn>;

function formRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Lab Survey",
    publicToken: "tok-1",
    audience: "Members",
    audienceGroupIds: [],
    oneResponsePerMember: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.findMany.mockResolvedValue([]);
  mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
  mockMember.mockResolvedValue({ userId: "user-1" });
  mockInGroup.mockResolvedValue(false);
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

  it("filters forms whose audience denies the viewer", async () => {
    mockPrisma.form.findMany.mockResolvedValue([
      formRow({ id: "f-members", publicToken: "t1", audience: "Members" }),
      formRow({
        id: "f-groups",
        publicToken: "t2",
        audience: "Groups",
        audienceGroupIds: ["g1"],
      }),
    ]);
    mockMember.mockResolvedValue(null); // not a member
    mockInGroup.mockResolvedValue(false); // not in the group

    expect(await listedFormsFor("user-1")).toEqual([]);
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
