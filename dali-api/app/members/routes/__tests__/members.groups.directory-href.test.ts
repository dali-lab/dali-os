import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
  currentTermMemberWhere: vi.fn(),
}));
vi.mock("~/lib/groups", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { directoryHrefForSystemKey } from "~/members/routes/members.groups";

describe("directoryHrefForSystemKey", () => {
  it("links a project system group to the directory project filter", () => {
    expect(directoryHrefForSystemKey("project:proj-1")).toBe("/members?project=proj-1");
  });

  it("links a domain system group to the directory domain filter", () => {
    expect(directoryHrefForSystemKey("domain:dom-1")).toBe("/members?domain=dom-1");
  });

  it("links a term system group to the directory term filter", () => {
    expect(directoryHrefForSystemKey("term:term-1")).toBe("/members?term=term-1");
  });

  it("has no directory link for lab-wide and offering groups", () => {
    expect(directoryHrefForSystemKey("core")).toBeNull();
    expect(directoryHrefForSystemKey("hiring")).toBeNull();
    expect(directoryHrefForSystemKey("alumni")).toBeNull();
    expect(directoryHrefForSystemKey("offering:off-1")).toBeNull();
  });

  it("has no directory link for custom (non-system) groups", () => {
    expect(directoryHrefForSystemKey(null)).toBeNull();
  });
});
