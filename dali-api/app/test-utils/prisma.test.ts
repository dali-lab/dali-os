import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { mockedPrisma } from "./prisma";

describe("mockedPrisma", () => {
  it("returns the mocked prisma from ~/lib/db.server", () => {
    expect(mockedPrisma()).toBe(prisma);
  });

  it("exposes vi.fn handles that tests can program", async () => {
    mockedPrisma().user.findUnique.mockResolvedValueOnce({ id: "u1" } as never);
    expect(await prisma.user.findUnique({ where: { id: "u1" } })).toEqual({ id: "u1" });
    expect(vi.isMockFunction(mockedPrisma().user.findUnique)).toBe(true);
  });
});
