import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
  currentTermMemberWhere: vi.fn(),
}));
vi.mock("~/lib/groups", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { groupMemberOptions } from "~/members/routes/members.groups";
import type { MemberCardData } from "~/members/components/GroupRoster";

function member(over: Partial<MemberCardData>): MemberCardData {
  return {
    id: "u1",
    firstName: "Ada",
    lastName: "Lovelace",
    daliEmail: "ada@example.edu",
    photoUrl: null,
    coreTitles: [],
    domainRoles: [],
    isCurrentMember: true,
    ...over,
  };
}

describe("groupMemberOptions", () => {
  it("offers current members by name, with their email to search on", () => {
    expect(groupMemberOptions([member({})])).toEqual([
      { value: "u1", label: "Ada Lovelace", description: "ada@example.edu" },
    ]);
  });

  it("leaves out alumni", () => {
    expect(groupMemberOptions([member({ id: "u2", isCurrentMember: false })])).toEqual([]);
  });

  it("falls back to the email when a member has no name", () => {
    const [opt] = groupMemberOptions([member({ firstName: "", lastName: "", daliEmail: "x@example.edu" })]);
    expect(opt.label).toBe("x@example.edu");
  });

  it("has no description when there is no email", () => {
    const [opt] = groupMemberOptions([member({ daliEmail: null })]);
    expect(opt.description).toBeUndefined();
  });
});
