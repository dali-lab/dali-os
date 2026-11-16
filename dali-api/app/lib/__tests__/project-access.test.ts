import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));

import { isCore, isProjectMember } from "~/lib/roles";
import { canEditProject } from "../project-access";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
});

describe("canEditProject", () => {
  it("allows Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await canEditProject("u1", "p1")).toBe(true);
  });

  it("allows a member staffed on the project", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    expect(await canEditProject("u1", "p1")).toBe(true);
  });

  it("refuses anyone else", async () => {
    expect(await canEditProject("u1", "p1")).toBe(false);
  });

  it("passes the request through so the role checks memoize", async () => {
    const request = new Request("http://localhost/x");
    await canEditProject("u1", "p1", request);
    expect(isCore).toHaveBeenCalledWith("u1", request);
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1", request);
  });

  it("calls the role checks without a request argument when none is given", async () => {
    await canEditProject("u1", "p1");
    expect(isCore).toHaveBeenCalledWith("u1");
    expect(isProjectMember).toHaveBeenCalledWith("u1", "p1");
  });
});
