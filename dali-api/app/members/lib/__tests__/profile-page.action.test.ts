import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
  isImpersonating: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  getUserRoles: vi.fn().mockResolvedValue({}),
  isAdmin: vi.fn(),
  isCore: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/wallet-token", () => ({ rotateWalletSecret: vi.fn() }));
vi.mock("~/lib/wallet-apns.server", () => ({ pushWalletPassUpdate: vi.fn() }));
vi.mock("~/lib/geocode.server", () => ({ geocodePlace: vi.fn() }));
vi.mock("~/members/lib/coffee-chat.server", () => ({ sendCoffeeChatInvite: vi.fn(), hasOutgoingCoffeeChat: vi.fn() }));
vi.mock("~/admin/lib/eligibility.server", () => ({
  applyEligibilityWithNotify: vi.fn(),
  removeEligibility: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isAdmin, isCore } from "~/lib/roles";
import { rotateWalletSecret } from "~/lib/wallet-token";
import { pushWalletPassUpdate } from "~/lib/wallet-apns.server";
import { geocodePlace } from "~/lib/geocode.server";
import { sendCoffeeChatInvite } from "~/members/lib/coffee-chat.server";
import { applyEligibilityWithNotify, removeEligibility } from "~/admin/lib/eligibility.server";
import { runProfileAction } from "~/members/lib/profile-page.server";

const db = prisma as any;
const ME = "u-me";
const OTHER = "u-other";

async function run(
  fields: Record<string, string>,
  { sub = ME, targetId = ME, path }: { sub?: string; targetId?: string; path?: string } = {},
) {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub } } as never);
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return runProfileAction({
    request: new Request(`http://localhost${path ?? `/members/${targetId}`}`, { method: "POST", body }),
    targetId,
  });
}

const profile = (o: Record<string, string> = {}) => ({ firstName: "Ada", lastName: "Lovelace", ...o });
const written = () => db.user.update.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(false);
  db.user.findUnique.mockResolvedValue({ currentLocation: null });
  db.user.update.mockResolvedValue({});
});

describe("who may edit a profile", () => {
  it("refuses a peer's profile edit, photo, experience save and delete", async () => {
    expect(await run(profile(), { targetId: OTHER })).toEqual({ error: "You don't have permission to edit this member." });
    expect(await run({ intent: "update-photo", photoUrl: "http://x/p.png" }, { targetId: OTHER })).toEqual({
      error: "You don't have permission to edit this member.",
    });
    expect(await run({ intent: "save-experience", company: "A", position: "B", startMonth: "2020-01" }, { targetId: OTHER })).toEqual({
      error: "You don't have permission to edit this member.",
    });
    expect(await run({ intent: "delete-experience", experienceId: "e1" }, { targetId: OTHER })).toEqual({
      error: "You don't have permission to edit this member.",
    });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.workExperience.create).not.toHaveBeenCalled();
    expect(db.workExperience.deleteMany).not.toHaveBeenCalled();
  });

  it("lets an admin edit someone else's profile", async () => {
    vi.mocked(isAdmin).mockResolvedValue(true);
    const res = await run(profile(), { targetId: OTHER });
    expect(res).toBeInstanceOf(Response);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OTHER } }));
  });

  it("does not let Core (non-admin) edit profile fields", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await run(profile(), { targetId: OTHER })).toEqual({ error: "You don't have permission to edit this member." });
  });
});

describe("profile field save", () => {
  it("requires a first and last name", async () => {
    expect(await run({ firstName: " ", lastName: "Lovelace" })).toEqual({ error: "First and last name are required." });
    expect(await run({ firstName: "Ada", lastName: "" })).toEqual({ error: "First and last name are required." });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("trims text, stores blanks as null, lowercases the NetID and normalises the handle", async () => {
    await run(
      profile({
        pronouns: "  she/her ",
        major: "",
        netId: " F00ADA ",
        handle: " Ada_L ",
        personalEmail: " ada@example.edu ",
      }),
    );
    expect(written()).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      pronouns: "she/her",
      major: null,
      netId: "f00ada",
      handle: "ada_l",
      personalEmail: "ada@example.edu",
      classYear: null,
      birthday: null,
    });
  });

  it("clears an empty NetID and handle to null", async () => {
    await run(profile({ netId: "", handle: "   " }));
    expect(written()).toMatchObject({ netId: null, handle: null });
  });

  it("rejects a personal email without @", async () => {
    expect(await run(profile({ personalEmail: "ada.example.edu" }))).toEqual({ error: "Personal email looks malformed." });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown timezone and accepts an IANA one", async () => {
    expect(await run(profile({ timeZone: "Mars/Olympus" }))).toEqual({
      error: "That timezone isn't a recognized IANA zone.",
    });
    await run(profile({ timeZone: "America/New_York" }));
    expect(written().timeZone).toBe("America/New_York");
  });

  it.each(["abc", "1899", "2101", "2026.5"])("rejects class year %s", async (classYear) => {
    expect(await run(profile({ classYear }))).toEqual({ error: "Class year must be a 4-digit year." });
  });

  it("stores a valid class year as a number", async () => {
    await run(profile({ classYear: "2028" }));
    expect(written().classYear).toBe(2028);
  });

  it("anchors the birthday at UTC midnight and rejects garbage", async () => {
    await run(profile({ birthday: "1815-12-10" }));
    expect((written().birthday as Date).toISOString()).toBe("1815-12-10T00:00:00.000Z");
    vi.clearAllMocks();
    expect(await run(profile({ birthday: "not-a-date" }))).toEqual({ error: "Birthday must be a valid date." });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("redirects back to /profile for self-service saves and /members/:id otherwise", async () => {
    const self = (await run(profile(), { path: "/profile" })) as Response;
    expect(self.headers.get("Location")).toBe("/profile");
    vi.mocked(isAdmin).mockResolvedValue(true);
    const other = (await run(profile(), { targetId: OTHER })) as Response;
    expect(other.headers.get("Location")).toBe(`/members/${OTHER}`);
  });
});

describe("Connect map pin", () => {
  it("geocodes only when the location text changed", async () => {
    db.user.findUnique.mockResolvedValue({ currentLocation: "Hanover, NH" });
    await run(profile({ currentLocation: "Hanover, NH" }));
    expect(geocodePlace).not.toHaveBeenCalled();
    expect(written()).not.toHaveProperty("currentLocationLat");
  });

  it("stores the new coordinates when the location changed", async () => {
    vi.mocked(geocodePlace).mockResolvedValue({ lat: 43.7, lng: -72.3 } as never);
    await run(profile({ currentLocation: "Hanover, NH" }));
    expect(geocodePlace).toHaveBeenCalledWith("Hanover, NH");
    expect(written()).toMatchObject({ currentLocationLat: 43.7, currentLocationLng: -72.3 });
  });

  it("clears the pin when the location is removed, without geocoding", async () => {
    db.user.findUnique.mockResolvedValue({ currentLocation: "Hanover, NH" });
    await run(profile({ currentLocation: "" }));
    expect(geocodePlace).not.toHaveBeenCalled();
    expect(written()).toMatchObject({ currentLocation: null, currentLocationLat: null, currentLocationLng: null });
  });
});

describe("unique-constraint failures", () => {
  it("names a taken handle", async () => {
    db.user.update.mockRejectedValue({ code: "P2002", meta: { target: ["handle"] } });
    expect(await run(profile({ handle: "ada" }))).toEqual({ error: "That handle is already taken — pick another." });
  });

  it("treats other unique violations as a NetID duplicate", async () => {
    db.user.update.mockRejectedValue({ code: "P2002", meta: { target: "User_netId_key" } });
    expect(await run(profile({ netId: "f00ada" }))).toEqual({
      error: "That NetID is already on another account — contact ops to merge or correct the duplicate.",
    });
  });

  it("rethrows anything else", async () => {
    db.user.update.mockRejectedValue(new Error("db down"));
    await expect(run(profile())).rejects.toThrow("db down");
  });
});

describe("photo", () => {
  it("lets the member set their photo and clears it when blank", async () => {
    await run({ intent: "update-photo", photoUrl: " http://x/p.png " });
    await run({ intent: "update-photo", photoUrl: "  " });
    expect(db.user.update.mock.calls.map((c: any) => c[0].data)).toEqual([
      { photoUrl: "http://x/p.png" },
      { photoUrl: null },
    ]);
  });
});

describe("work experience", () => {
  const exp = (o: Record<string, string> = {}) => ({
    intent: "save-experience",
    company: "Analytical Engines",
    position: "Programmer",
    startMonth: "2020-04",
    ...o,
  });

  it("creates a new experience owned by the profile", async () => {
    await run(exp());
    expect(db.workExperience.create.mock.calls[0][0].data).toMatchObject({
      userId: ME,
      company: "Analytical Engines",
      position: "Programmer",
      endDate: null,
    });
  });

  it("scopes an edit to the profile's owner so another profile's id is a no-op", async () => {
    await run(exp({ experienceId: "e1" }));
    expect(db.workExperience.updateMany.mock.calls[0][0].where).toEqual({ id: "e1", userId: ME });
    expect(db.workExperience.create).not.toHaveBeenCalled();
  });

  it("returns the validation error and writes nothing", async () => {
    expect(await run(exp({ company: "" }))).toEqual({ error: "Company and position are required." });
    expect(await run(exp({ startMonth: "2020-04", endMonth: "2019-01" }))).toEqual({
      error: "The end can't be before the start.",
    });
    expect(db.workExperience.create).not.toHaveBeenCalled();
  });

  it("deletes only the profile owner's experience", async () => {
    await run({ intent: "delete-experience", experienceId: "e1" });
    expect(db.workExperience.deleteMany).toHaveBeenCalledWith({ where: { id: "e1", userId: ME } });
  });
});

describe("Core-only eligibility intents", () => {
  it.each([
    ["add-eligibility", { domainId: "d1", level: "P1" }],
    ["set-eligibility-level", { domainId: "d1", level: "P1" }],
    ["remove-eligibility", { eligibilityId: "el1" }],
  ])("%s is refused for a non-Core member (even on their own profile)", async (intent, extra) => {
    const res = (await run({ intent, ...extra })) as { error: string };
    expect(res.error).toMatch(/don't have permission/);
    expect(applyEligibilityWithNotify).not.toHaveBeenCalled();
    expect(removeEligibility).not.toHaveBeenCalled();
  });

  it("lets Core assign a domain level, attributed to the actor", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await run({ intent: "add-eligibility", domainId: "d1", level: "P1" }, { sub: "core-1", targetId: OTHER })).toBeNull();
    expect(applyEligibilityWithNotify).toHaveBeenCalledWith({
      userId: OTHER,
      domainId: "d1",
      level: "P1",
      actorId: "core-1",
    });
  });

  it("asks for a domain and a valid level", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await run({ intent: "add-eligibility", domainId: "", level: "P1" }, { targetId: OTHER })).toEqual({
      error: "Pick a domain and a level.",
    });
    expect(await run({ intent: "add-eligibility", domainId: "d1", level: "nonsense" }, { targetId: OTHER })).toEqual({
      error: "Pick a domain and a level.",
    });
    expect(applyEligibilityWithNotify).not.toHaveBeenCalled();
  });

  it("lets Core remove an eligibility but requires its id", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await run({ intent: "remove-eligibility", eligibilityId: "" }, { targetId: OTHER })).toEqual({
      error: "Missing eligibility id.",
    });
    expect(await run({ intent: "remove-eligibility", eligibilityId: "el1" }, { targetId: OTHER })).toBeNull();
    expect(removeEligibility).toHaveBeenCalledWith({ id: "el1" });
  });
});

describe("wallet pass revocation", () => {
  it("lets a member reset their own pass and nudges their devices", async () => {
    const res = (await run({ intent: "revoke-wallet-pass" })) as Response;
    expect(rotateWalletSecret).toHaveBeenCalledWith(ME);
    expect(pushWalletPassUpdate).toHaveBeenCalledWith(ME);
    expect(res.headers.get("Location")).toBe(`/members/${ME}`);
  });

  it("lets Core revoke someone else's pass", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await run({ intent: "revoke-wallet-pass" }, { sub: "core-1", targetId: OTHER });
    expect(rotateWalletSecret).toHaveBeenCalledWith(OTHER);
  });

  it("refuses a peer revoking someone else's pass", async () => {
    const res = await run({ intent: "revoke-wallet-pass" }, { targetId: OTHER });
    expect(res).toEqual({ error: "You don't have permission to reset this member's pass." });
    expect(rotateWalletSecret).not.toHaveBeenCalled();
  });
});

describe("coffee chats", () => {
  it("sends a coffee chat or resume review invite as the viewer", async () => {
    vi.mocked(sendCoffeeChatInvite).mockResolvedValue(null as never);
    await run({ intent: "coffee-chat" }, { targetId: OTHER });
    await run({ intent: "resume-review" }, { targetId: OTHER });
    expect(vi.mocked(sendCoffeeChatInvite).mock.calls).toEqual([
      [ME, OTHER],
      [ME, OTHER, "ResumeReview"],
    ]);
  });
});
