import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";

const findMany = prisma.project.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
  (prisma.term.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "t1",
    code: "25F",
  });
});

// Private projects must never be offered as an answer on a form that queries
// the project database — for any filling member, Core included.
describe("projects:* reference sources exclude private projects", () => {
  it.each([
    ["projects:open-this-term", undefined],
    ["projects:active", undefined],
    ["projects:active-in-term", { termId: "t1" }],
  ] as const)("%s filters on isPrivate: false", async (key, ctx) => {
    const options = await resolveReferenceOptions(key, ctx);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ isPrivate: false });
    expect(options).toEqual([{ value: "p1", label: "Alpha" }]);
  });

  it("keeps the existing non-archived filter alongside it", async () => {
    await resolveReferenceOptions("projects:active");
    expect(findMany.mock.calls[0][0].where).toEqual({
      isPrivate: false,
      status: { not: "Archived" },
    });
  });
});
