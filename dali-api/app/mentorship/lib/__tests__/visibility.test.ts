import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMentor: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));

import { isCore, isLabMentor } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canViewMentorNote } from "../visibility";

const access = (canView: boolean) => ({ canView, canEdit: false, canComment: false });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMentor).mockResolvedValue(false);
});

describe("canViewMentorNote with a Drive page", () => {
  it("follows page access, not roles, once the note has a page", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(true));

    expect(await canViewMentorNote("u1", { mentorId: "u2", pageId: "p1" })).toBe(true);
    expect(getPageAccess).toHaveBeenCalledWith("u1", "p1");
    expect(isLabMentor).not.toHaveBeenCalled();
  });

  it("denies a mentee, who the Mentorship root excludes, even if they authored nothing", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access(false));

    expect(await canViewMentorNote("mentee", { mentorId: "u2", pageId: "p1" })).toBe(false);
  });

  it("denies a lab mentor the page does not admit", async () => {
    vi.mocked(isLabMentor).mockResolvedValue(true);
    vi.mocked(getPageAccess).mockResolvedValue(access(false));

    expect(await canViewMentorNote("u1", { mentorId: "u2", pageId: "p1" })).toBe(false);
  });
});

describe("canViewMentorNote before migration", () => {
  it("lets Core, the author and any lab mentor read", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(true);
    expect(await canViewMentorNote("core", { mentorId: "u2", pageId: null })).toBe(true);

    expect(await canViewMentorNote("u2", { mentorId: "u2", pageId: null })).toBe(true);

    vi.mocked(isLabMentor).mockResolvedValue(true);
    expect(await canViewMentorNote("u3", { mentorId: "u2" })).toBe(true);
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("denies everyone else", async () => {
    expect(await canViewMentorNote("mentee", { mentorId: "u2", pageId: null })).toBe(false);
  });
});
