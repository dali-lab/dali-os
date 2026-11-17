import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/read-only-roles.server", () => ({ readOnlyRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/alumni-game.server", () => ({
  addHistoryNote: vi.fn(),
  addQuestWorkExperience: vi.fn(),
  confirmQuestField: vi.fn(),
  loadDaliHistoryLines: vi.fn(),
  setOpenTo: vi.fn(),
}));
vi.mock("~/members/lib/profile-update.server", async () => {
  const { BadRequestError, ConflictError } = await import("~/lib/http-error");
  class ProfileValidationError extends BadRequestError {
    constructor(
      public field: string,
      message: string,
    ) {
      super(message);
    }
  }
  class ProfileConflictError extends ConflictError {
    constructor(
      public field: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { updateProfileFields: vi.fn(), ProfileValidationError, ProfileConflictError };
});

import { requireAuth } from "~/lib/auth";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  addHistoryNote,
  addQuestWorkExperience,
  confirmQuestField,
  setOpenTo,
} from "~/lib/alumni-game.server";
import {
  updateProfileFields,
  ProfileValidationError,
} from "~/members/lib/profile-update.server";
import { action } from "../alumni.form";

const submit = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("https://os.example/alumni/form", { method: "POST", body }),
  } as never);
};

const baseFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  personalEmail: "",
  preferredPick: "ada@dali.dartmouth.edu",
  classYear: "2019",
  currentLocation: "",
  hometown: "",
  birthday: "",
  major: "",
  minors: "",
  funFact: "",
  dietaryRestrictions: "",
  linkedinUrl: "",
  personalSite: "",
  workPosition: "",
  workCompany: "",
  historyNote: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(readOnlyRoles).mockResolvedValue({ isLabMemberOrAlum: true } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(updateProfileFields).mockResolvedValue({ updated: {} });
});

describe("POST /alumni/form", () => {
  it("bounces a viewer who is not a lab member or alum", async () => {
    vi.mocked(readOnlyRoles).mockResolvedValue({ isLabMemberOrAlum: false } as never);
    await expect(submit(baseFields)).rejects.toMatchObject({ status: 302 });
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it("bounces when the alumni-game flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await expect(submit(baseFields)).rejects.toMatchObject({ status: 302 });
    expect(updateProfileFields).not.toHaveBeenCalled();
  });

  it("saves the profile fields and redirects to the profile for review", async () => {
    const res = (await submit({
      ...baseFields,
      major: "Computer Science",
      birthday: "2001-06-05",
    })) as Response;
    expect(updateProfileFields).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        classYear: "2019",
        major: "Computer Science",
        birthday: "2001-06-05",
        preferredEmail: "ada@dali.dartmouth.edu",
      }),
      { allowNetId: false },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/profile");
  });

  it("uses the typed personal email as preferred when that option is picked", async () => {
    await submit({ ...baseFields, preferredPick: "personal", personalEmail: "ada@new.com" });
    expect(updateProfileFields).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ personalEmail: "ada@new.com", preferredEmail: "ada@new.com" }),
      { allowNetId: false },
    );
  });

  it("adds a work experience only when both role and company are given", async () => {
    await submit({ ...baseFields, workPosition: "Designer", workCompany: "" });
    expect(addQuestWorkExperience).not.toHaveBeenCalled();
    expect(confirmQuestField).not.toHaveBeenCalledWith("u1", "work");
    await submit({ ...baseFields, workPosition: "Designer", workCompany: "Google" });
    expect(addQuestWorkExperience).toHaveBeenCalledWith("u1", "Google", "Designer");
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "work");
  });

  it("stores a history correction and always confirms the history step", async () => {
    await submit({ ...baseFields, historyNote: "missing the kiosk project" });
    expect(addHistoryNote).toHaveBeenCalledWith("u1", "missing the kiosk project");
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "history");
  });

  it("skips the note when nothing is off", async () => {
    await submit(baseFields);
    expect(addHistoryNote).not.toHaveBeenCalled();
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "history");
  });

  it("saves the open-to toggles from the checkboxes", async () => {
    await submit({ ...baseFields, openToCoffeeChats: "on", openToPortfolioReviews: "on" });
    expect(setOpenTo).toHaveBeenCalledWith("u1", {
      coffeeChats: true,
      resumeReviews: false,
      portfolioReviews: true,
    });
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "openTo");
  });

  it("confirms name and email quest steps on save", async () => {
    await submit(baseFields);
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "name");
    expect(confirmQuestField).toHaveBeenCalledWith("u1", "email");
  });

  it("surfaces a validation error instead of redirecting", async () => {
    vi.mocked(updateProfileFields).mockRejectedValue(
      new ProfileValidationError("classYear", "Class year must be a 4-digit year."),
    );
    const res = await submit({ ...baseFields, classYear: "nope" });
    expect(res).toEqual({ error: "Class year must be a 4-digit year." });
    expect(setOpenTo).not.toHaveBeenCalled();
    expect(confirmQuestField).not.toHaveBeenCalled();
  });
});
