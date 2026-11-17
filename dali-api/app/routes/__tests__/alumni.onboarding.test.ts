import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/read-only-roles.server", () => ({ readOnlyRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/alumni-onboarding.server", () => ({
  loadOnboarding: vi.fn(),
  finishOnboarding: vi.fn(),
  saveAbout: vi.fn(),
  saveBasedIn: vi.fn(),
  saveHometown: vi.fn(),
  savePreferredEmail: vi.fn(),
  saveStudy: vi.fn(),
  saveWorkSlot: vi.fn(),
}));
vi.mock("~/lib/alumni-history.server", () => ({ reportHistoryCorrection: vi.fn() }));
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
  return { ProfileValidationError, ProfileConflictError };
});
vi.mock("~/components/alumni-onboarding/AlumniOnboarding", () => ({ AlumniOnboarding: () => null }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { BadRequestError } from "~/lib/http-error";
import {
  finishOnboarding,
  loadOnboarding,
  saveAbout,
  saveBasedIn,
  saveHometown,
  savePreferredEmail,
  saveStudy,
  saveWorkSlot,
} from "~/lib/alumni-onboarding.server";
import { reportHistoryCorrection } from "~/lib/alumni-history.server";
import { ProfileValidationError } from "~/members/lib/profile-update.server";
import { action, loader } from "../alumni.onboarding";

const flags = (onboarding: boolean, game = false) =>
  vi.mocked(isFeatureEnabled).mockImplementation(async (key) => (key === "alumni-onboarding" ? onboarding : game));

const request = () => new Request("https://os.example/alumni/onboarding");
const runLoader = () => loader({ request: request() } as never) as Promise<Response | Record<string, unknown>>;

const post = (fields: Record<string, string>) =>
  action({
    request: new Request("https://os.example/alumni/onboarding", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(readOnlyRoles).mockResolvedValue({ isAlumni: true } as never);
  vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: true } as never);
  flags(true);
  vi.mocked(loadOnboarding).mockResolvedValue({ firstName: "Ada" } as never);
});

describe("loader", () => {
  it("sends a signed-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await runLoader()) as Response;
    expect(res.status).toBe(302);
    expect(loadOnboarding).not.toHaveBeenCalled();
  });

  it("redirects anyone who is not an alumnus", async () => {
    vi.mocked(readOnlyRoles).mockResolvedValue({ isAlumni: false } as never);
    const res = (await runLoader()) as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(loadOnboarding).not.toHaveBeenCalled();
  });

  it("redirects when the alumni-onboarding flag is off", async () => {
    flags(false, true);
    const res = (await runLoader()) as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(loadOnboarding).not.toHaveBeenCalled();
  });

  it("returns the profile data", async () => {
    expect(await runLoader()).toEqual({ firstName: "Ada" });
  });
});

describe("action", () => {
  it("rejects a signed-out request, a non-alumnus and a flag that is off", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await post({ intent: "finish" })).status).toBe(401);

    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: false } as never);
    expect((await post({ intent: "finish" })).status).toBe(403);

    vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: true } as never);
    flags(false);
    expect((await post({ intent: "finish" })).status).toBe(403);
    expect(finishOnboarding).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    expect((await post({ intent: "nope" })).status).toBe(400);
  });

  it("saves the class year with majors and minors parsed from JSON, and hometown", async () => {
    await post({ intent: "save-class", classYear: "2024", majors: '["CS","Studio Art"]', minors: "[]" });
    expect(saveStudy).toHaveBeenCalledWith("u1", { classYear: "2024", majors: ["CS", "Studio Art"], minors: [] });
    await post({ intent: "save-hometown", hometown: "Portland" });
    expect(saveHometown).toHaveBeenCalledWith("u1", "Portland");
  });

  it("saves based in with the picked city id, and the primary email", async () => {
    await post({ intent: "save-based-in", currentLocation: "Brooklyn, New York", currentLocationGeonameId: "5110302" });
    expect(saveBasedIn).toHaveBeenCalledWith("u1", {
      currentLocation: "Brooklyn, New York",
      currentLocationGeonameId: "5110302",
    });
    await post({ intent: "save-email", email: "ada@example.com" });
    expect(savePreferredEmail).toHaveBeenCalledWith("u1", "ada@example.com");
  });

  it("sends a history report to Core and refuses an empty one", async () => {
    const res = await post({ intent: "report-history", note: "Also on Rauner Archive in 24W" });
    expect(await res.json()).toEqual({ ok: true });
    expect(reportHistoryCorrection).toHaveBeenCalledWith("u1", "Also on Rauner Archive in 24W");
    const empty = await post({ intent: "report-history", note: "   " });
    expect(empty.status).toBe(400);
    expect(reportHistoryCorrection).toHaveBeenCalledTimes(1);
  });

  it("saves a job slot and rejects an unknown slot", async () => {
    const res = await post({ intent: "save-work", slot: "before", id: "w1", position: "Intern", company: "Etsy", year: "2023" });
    expect(await res.json()).toEqual({ ok: true });
    expect(saveWorkSlot).toHaveBeenCalledWith("u1", {
      slot: "before",
      id: "w1",
      position: "Intern",
      company: "Etsy",
      year: "2023",
    });
    const bad = await post({ intent: "save-work", slot: "someday", position: "x", company: "y" });
    expect(bad.status).toBe(400);
    expect(saveWorkSlot).toHaveBeenCalledTimes(1);
  });

  it("saves interests with the topic list parsed from JSON", async () => {
    await post({ intent: "save-about", funFact: "f", outsideOfWork: "o", askMeAbout: '["Grad school","Startups"]' });
    expect(saveAbout).toHaveBeenCalledWith("u1", {
      funFact: "f",
      outsideOfWork: "o",
      askMeAbout: ["Grad school", "Startups"],
      linkedinUrl: "",
      personalSite: "",
      birthday: "",
      dietaryRestrictions: "",
    });
    await post({
      intent: "save-about",
      askMeAbout: "garbage",
      linkedinUrl: "https://linkedin.com/in/ada",
      birthday: "2001-06-05",
      dietaryRestrictions: "Vegetarian",
    });
    expect(saveAbout).toHaveBeenLastCalledWith("u1", {
      funFact: "",
      outsideOfWork: "",
      askMeAbout: [],
      linkedinUrl: "https://linkedin.com/in/ada",
      personalSite: "",
      birthday: "2001-06-05",
      dietaryRestrictions: "Vegetarian",
    });
  });

  it("finishes with only the switched-on tiles true", async () => {
    const res = await post({ intent: "finish", coffeeChats: "on", resumeReviews: "on", speaking: "on" });
    expect(await res.json()).toEqual({ ok: true });
    expect(finishOnboarding).toHaveBeenCalledWith("u1", {
      coffeeChats: true,
      resumeReviews: true,
      partnerReferrals: false,
      mentoring: false,
      speaking: true,
    });
  });

  it("turns validation failures into a 400 with the message", async () => {
    vi.mocked(saveAbout).mockRejectedValue(new ProfileValidationError("askMeAbout", "Pick up to 10 topics."));
    const res = await post({ intent: "save-about" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick up to 10 topics." });

    vi.mocked(saveWorkSlot).mockRejectedValue(new BadRequestError("Add a role and a company."));
    const work = await post({ intent: "save-work", slot: "now" });
    expect(work.status).toBe(400);
    expect(await work.json()).toEqual({ error: "Add a role and a company." });
  });

  it("lets unexpected errors through", async () => {
    vi.mocked(finishOnboarding).mockRejectedValue(new Error("db down"));
    await expect(post({ intent: "finish" })).rejects.toThrow("db down");
  });
});
