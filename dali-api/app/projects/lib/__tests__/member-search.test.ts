import { describe, expect, it } from "vitest";
import { memberSearchWhere } from "../member-search";

describe("memberSearchWhere", () => {
  it("matches members on every word across name and email, up to four words", () => {
    const where = memberSearchWhere("  ada   o b c d ");
    expect(where.daliMember).toEqual({ isNot: null });
    expect((where.AND as unknown[]).length).toBe(4);
    expect((where.AND as { OR: unknown[] }[])[0].OR).toEqual([
      { firstName: { contains: "ada", mode: "insensitive" } },
      { lastName: { contains: "ada", mode: "insensitive" } },
      { daliEmail: { contains: "ada", mode: "insensitive" } },
      { dartmouthEmail: { contains: "ada", mode: "insensitive" } },
    ]);
  });
});
