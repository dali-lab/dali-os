import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
// Spread the originals so the rest of public-form's import graph (which also
// pulls from these modules) keeps its real exports.
vi.mock("~/lib/roles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/roles")>()),
  requireMember: vi.fn(),
}));
vi.mock("~/lib/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/groups")>()),
  isUserInAnyGroup: vi.fn(),
}));

import { requireMember } from "~/lib/roles";
import { isUserInAnyGroup } from "~/lib/groups";
import { formFillAccess } from "~/forms/lib/public-form";

const mockMember = requireMember as ReturnType<typeof vi.fn>;
const mockInGroup = isUserInAnyGroup as ReturnType<typeof vi.fn>;

function form(
  audience: "Members" | "SignedIn" | "Groups" | "Public",
  audienceGroupIds: string[] = [],
) {
  return { audience, audienceGroupIds };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formFillAccess", () => {
  it("Public admits everyone without any queries", async () => {
    expect(await formFillAccess(form("Public"), null)).toBe("ok");
    expect(await formFillAccess(form("Public"), "user-1")).toBe("ok");
    expect(mockMember).not.toHaveBeenCalled();
    expect(mockInGroup).not.toHaveBeenCalled();
  });

  it("non-public audiences send anonymous visitors to login", async () => {
    expect(await formFillAccess(form("Members"), null)).toBe("login");
    expect(await formFillAccess(form("SignedIn"), null)).toBe("login");
    expect(await formFillAccess(form("Groups", ["g1"]), null)).toBe("login");
  });

  it("SignedIn admits any session without member/group queries", async () => {
    expect(await formFillAccess(form("SignedIn"), "partner-1")).toBe("ok");
    expect(mockMember).not.toHaveBeenCalled();
    expect(mockInGroup).not.toHaveBeenCalled();
  });

  it("Members admits members and denies everyone else", async () => {
    mockMember.mockResolvedValueOnce({ userId: "member-1" });
    expect(await formFillAccess(form("Members"), "member-1")).toBe("ok");

    mockMember.mockResolvedValueOnce(null); // dartmouth student / partner
    expect(await formFillAccess(form("Members"), "student-1")).toBe("denied");
  });

  it("Groups admits only group members — lab membership is not a bypass", async () => {
    mockInGroup.mockResolvedValueOnce(true);
    expect(await formFillAccess(form("Groups", ["g1"]), "user-1")).toBe("ok");
    expect(mockInGroup).toHaveBeenCalledWith("user-1", ["g1"]);

    mockInGroup.mockResolvedValueOnce(false);
    expect(await formFillAccess(form("Groups", ["g1"]), "member-2")).toBe(
      "denied",
    );
    // The Members check is never consulted for a Groups audience.
    expect(mockMember).not.toHaveBeenCalled();
  });
});
