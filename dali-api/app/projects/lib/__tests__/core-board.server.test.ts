import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ project: { findFirst: vi.fn(), create: vi.fn() } }));
vi.mock("~/lib/db.server", () => ({ prisma: db }));

import { getCoreBoardProject } from "~/projects/lib/core-board.server";

const CORE = { id: "core1", name: "Core" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getCoreBoardProject", () => {
  it("returns the existing CoreBoard project without creating one", async () => {
    db.project.findFirst.mockResolvedValue(CORE);
    await expect(getCoreBoardProject()).resolves.toEqual(CORE);
    expect(db.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: "CoreBoard" } }));
    expect(db.project.create).not.toHaveBeenCalled();
  });

  it("creates it named Core when none exists", async () => {
    db.project.findFirst.mockResolvedValue(null);
    db.project.create.mockResolvedValue(CORE);
    await expect(getCoreBoardProject()).resolves.toEqual(CORE);
    expect(db.project.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "Core", kind: "CoreBoard" } }),
    );
  });

  it("re-reads after losing a create race (P2002)", async () => {
    db.project.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(CORE);
    db.project.create.mockRejectedValue({ code: "P2002" });
    await expect(getCoreBoardProject()).resolves.toEqual(CORE);
    expect(db.project.findFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows other create errors", async () => {
    db.project.findFirst.mockResolvedValue(null);
    const boom = new Error("db down");
    db.project.create.mockRejectedValue(boom);
    await expect(getCoreBoardProject()).rejects.toBe(boom);
  });
});
