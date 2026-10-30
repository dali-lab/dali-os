import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/form-access.server", () => ({ canBuildForm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { authorizeCollabDoc } from "~/lib/collabAuth";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("form:{id}:draft room", () => {
  it("lets whoever canBuildForm in", async () => {
    (prisma as any).form.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(canBuildForm).mockResolvedValue(true);
    expect(await authorizeCollabDoc("u1", "form:f1:draft")).toEqual({ allowed: true, readOnly: false });
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1");
  });

  it("keeps everyone else out", async () => {
    (prisma as any).form.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(canBuildForm).mockResolvedValue(false);
    expect(await authorizeCollabDoc("u1", "form:f1:draft")).toMatchObject({ allowed: false });
  });

  it("denies a form that does not exist without asking access", async () => {
    (prisma as any).form.findUnique.mockResolvedValue(null);
    expect(await authorizeCollabDoc("u1", "form:f1:draft")).toMatchObject({ allowed: false });
    expect(canBuildForm).not.toHaveBeenCalled();
  });
});
