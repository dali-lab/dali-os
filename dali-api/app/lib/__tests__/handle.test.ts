import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { baseHandle, normalizeHandle, ensureUniqueHandle } from "~/lib/handle";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
};

describe("baseHandle", () => {
  it("uses first initial + last name, lowercased", () => {
    expect(baseHandle("Sophie", "Park")).toBe("spark");
    expect(baseHandle("Jane", "Smith")).toBe("jsmith");
  });

  it("strips non-alphanumerics and casing", () => {
    expect(baseHandle("José", "O'Brien-Lee")).toBe("jobrienlee");
  });

  it("falls back to the first name when there's no last name", () => {
    expect(baseHandle("Madonna", "")).toBe("madonna");
  });

  it("falls back to 'member' when a name yields nothing usable", () => {
    expect(baseHandle("", "")).toBe("member");
    expect(baseHandle("!!!", "###")).toBe("member");
  });
});

describe("normalizeHandle", () => {
  it("strips a leading @, lowercases, and drops illegal chars", () => {
    expect(normalizeHandle("@Spark")).toBe("spark");
    expect(normalizeHandle("s.park!!")).toBe("spark");
    expect(normalizeHandle("under_score_ok")).toBe("under_score_ok");
  });

  it("returns empty string when nothing survives", () => {
    expect(normalizeHandle("@@@")).toBe("");
  });
});

describe("ensureUniqueHandle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the base when it's free", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await ensureUniqueHandle("spark")).toBe("spark");
  });

  it("appends an incrementing suffix on collision", async () => {
    mockPrisma.user.findUnique.mockImplementation(
      async ({ where }: { where: { handle: string } }) =>
        where.handle === "spark" || where.handle === "spark2" ? { id: "x" } : null,
    );
    expect(await ensureUniqueHandle("spark")).toBe("spark3");
  });

  it("lets a user keep their own handle via excludeUserId", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "me" });
    expect(await ensureUniqueHandle("spark", { excludeUserId: "me" })).toBe("spark");
  });
});
