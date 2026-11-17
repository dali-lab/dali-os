import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v: string | null) => v) }));
vi.mock("~/members/lib/profile-update.server", () => ({ updateProfileFields: vi.fn() }));

import { mockedPrisma } from "~/test-utils/prisma";
import { updateProfileFields } from "~/members/lib/profile-update.server";
import {
  alumniInviteFor,
  finishOnboarding,
  loadOnboarding,
  openToPatch,
  saveAbout,
  saveWorkSlot,
} from "../alumni-onboarding.server";

const db = mockedPrisma();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("alumniInviteFor", () => {
  const flags = (onboarding: boolean, game: boolean) => ({ "alumni-onboarding": onboarding, "alumni-game": game });

  it("never invites someone who is not an alumnus", async () => {
    expect(await alumniInviteFor("u1", false, flags(true, true))).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("sends an alumnus who has not onboarded to the new flow, even with the game on", async () => {
    db.user.findUnique.mockResolvedValue({ alumniOnboardedAt: null } as never);
    expect(await alumniInviteFor("u1", true, flags(true, true))).toBe("onboarding");
    expect(db.pixelAvatar.findUnique).not.toHaveBeenCalled();
  });

  it("stops inviting once they have finished, without falling back to the game", async () => {
    db.user.findUnique.mockResolvedValue({ alumniOnboardedAt: new Date() } as never);
    expect(await alumniInviteFor("u1", true, flags(true, true))).toBeNull();
    expect(db.pixelAvatar.findUnique).not.toHaveBeenCalled();
  });

  it("keeps today's game invite when the onboarding flag is off", async () => {
    db.pixelAvatar.findUnique.mockResolvedValue(null);
    expect(await alumniInviteFor("u1", true, flags(false, true))).toBe("game");
    db.pixelAvatar.findUnique.mockResolvedValue({ userId: "u1" } as never);
    expect(await alumniInviteFor("u1", true, flags(false, true))).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("invites no one when both flags are off", async () => {
    expect(await alumniInviteFor("u1", true, flags(false, false))).toBeNull();
  });
});

describe("finishOnboarding", () => {
  const choices = { coffeeChats: true, resumeReviews: true, partnerReferrals: false, mentoring: false, speaking: true };

  it("sets both the resume and portfolio columns from the one resume tile", () => {
    expect(openToPatch(choices)).toEqual({
      coffeeChats: true,
      resumeReviews: true,
      portfolioReviews: true,
      partnerReferrals: false,
      mentoring: false,
      speaking: true,
    });
    expect(openToPatch({ ...choices, resumeReviews: false })).toMatchObject({
      resumeReviews: false,
      portfolioReviews: false,
    });
  });

  it("writes through the shared updater and stamps the finish time once", async () => {
    await finishOnboarding("u1", choices);
    expect(updateProfileFields).toHaveBeenCalledWith("u1", { openTo: openToPatch(choices) }, { allowNetId: false });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", alumniOnboardedAt: null },
      data: { alumniOnboardedAt: expect.any(Date) },
    });
  });

  it("does not stamp the finish time when the updater rejects", async () => {
    vi.mocked(updateProfileFields).mockRejectedValueOnce(new Error("bad"));
    await expect(finishOnboarding("u1", choices)).rejects.toThrow("bad");
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("saveAbout", () => {
  it("hands the interests to the shared updater", async () => {
    const about = { funFact: "a", outsideOfWork: "b", askMeAbout: ["c"] };
    await saveAbout("u1", about);
    expect(updateProfileFields).toHaveBeenCalledWith("u1", about, { allowNetId: false });
  });
});

describe("saveWorkSlot", () => {
  const base = { id: "", position: "Designer", company: "Spotify", year: "" };

  it("rejects a missing role or company and an overlong one", async () => {
    await expect(saveWorkSlot("u1", { ...base, slot: "now", position: " " })).rejects.toMatchObject({ status: 400 });
    await expect(saveWorkSlot("u1", { ...base, slot: "now", company: "" })).rejects.toMatchObject({ status: 400 });
    await expect(saveWorkSlot("u1", { ...base, slot: "now", company: "x".repeat(121) })).rejects.toMatchObject({
      status: 400,
    });
    expect(db.workExperience.create).not.toHaveBeenCalled();
  });

  it("adds a current job when there is none", async () => {
    await saveWorkSlot("u1", { ...base, slot: "now" });
    expect(db.workExperience.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", company: "Spotify", position: "Designer" }),
    });
  });

  it("edits the current job scoped to the owner", async () => {
    await saveWorkSlot("u1", { ...base, slot: "now", id: "w1" });
    expect(db.workExperience.updateMany).toHaveBeenCalledWith({
      where: { id: "w1", userId: "u1", endDate: null },
      data: { position: "Designer", company: "Spotify" },
    });
  });

  it("needs a four digit year to add an earlier job", async () => {
    await expect(saveWorkSlot("u1", { ...base, slot: "before" })).rejects.toMatchObject({ status: 400 });
    await expect(saveWorkSlot("u1", { ...base, slot: "before", year: "23" })).rejects.toMatchObject({ status: 400 });
    await saveWorkSlot("u1", { ...base, slot: "before", year: "2023" });
    const date = new Date(Date.UTC(2023, 0, 1));
    expect(db.workExperience.create).toHaveBeenCalledWith({
      data: { userId: "u1", company: "Spotify", position: "Designer", startDate: date, endDate: date },
    });
  });

  it("moves an earlier job's end to the new year and pulls the start back with it", async () => {
    db.workExperience.findFirst.mockResolvedValue({
      startDate: new Date(Date.UTC(2023, 5, 1)),
      endDate: new Date(Date.UTC(2023, 8, 1)),
    } as never);
    await saveWorkSlot("u1", { ...base, slot: "before", id: "w2", year: "2022" });
    const end = new Date(Date.UTC(2022, 8, 1));
    expect(db.workExperience.updateMany).toHaveBeenCalledWith({
      where: { id: "w2", userId: "u1" },
      data: { position: "Designer", company: "Spotify", endDate: end, startDate: end },
    });
  });

  it("refuses to edit a job that is not the member's", async () => {
    db.workExperience.findFirst.mockResolvedValue(null);
    await expect(saveWorkSlot("u1", { ...base, slot: "before", id: "other" })).rejects.toMatchObject({ status: 400 });
    expect(db.workExperience.updateMany).not.toHaveBeenCalled();
  });
});

describe("loadOnboarding", () => {
  const user = {
    firstName: "Ada",
    lastName: "Lovelace",
    classYear: 2024,
    major: "Computer Science",
    hometown: "Portland",
    currentLocationCity: "New York",
    photoUrl: null,
    funFact: null,
    outsideOfWork: null,
    askMeAbout: ["Grad school"],
    openToCoffeeChats: true,
    openToResumeReviews: false,
    openToPortfolioReviews: true,
    openToPartnerReferrals: false,
    openToMentoring: false,
    openToSpeaking: true,
    workExperiences: [
      { id: "w1", company: "Spotify", position: "Product designer", location: "New York", endDate: null },
      { id: "w2", company: "Etsy", position: "Design intern", location: null, endDate: new Date(Date.UTC(2023, 7, 1)) },
    ],
    projectAssignments: [
      { project: { id: "p1", name: "Habitat Map" }, term: { id: "t1", sortKey: 1 }, domain: { displayName: "Development" } },
    ],
  };

  beforeEach(() => {
    db.user.findUniqueOrThrow.mockResolvedValue(user as never);
    db.user.count.mockResolvedValueOnce(31).mockResolvedValueOnce(4);
  });

  it("prefills the rows, the name tag and the worth-a-look counts from real data", async () => {
    const data = await loadOnboarding("u1");
    expect(data).toMatchObject({
      firstName: "Ada",
      funFact: "",
      outsideOfWork: "",
      askMeAbout: ["Grad school"],
      dali: { projectCount: 1, termCount: 1, projectNames: ["Habitat Map"], rolesLine: "Development" },
      now: { id: "w1", position: "Product designer", company: "Spotify", year: null },
      before: { id: "w2", year: 2023 },
      nameTag: { name: "Ada Lovelace '24", subtitle: "Product designer, Spotify" },
      worthALook: {
        connect: { title: "Alumni in New York", detail: "31 nearby on Connect" },
        peers: { detail: "4 people who also worked on Habitat Map" },
      },
    });
  });

  it("reads resume reviews as on when either of the two columns is on", async () => {
    expect((await loadOnboarding("u1")).openTo).toEqual({
      coffeeChats: true,
      resumeReviews: true,
      partnerReferrals: false,
      mentoring: false,
      speaking: true,
    });
  });

  it("falls back to plain copy when there is nothing to count", async () => {
    db.user.count.mockReset();
    db.user.findUniqueOrThrow.mockResolvedValue({
      ...user,
      currentLocationCity: null,
      workExperiences: [],
      projectAssignments: [],
    } as never);
    const data = await loadOnboarding("u1");
    expect(db.user.count).not.toHaveBeenCalled();
    expect(data.worthALook.connect).toEqual({ title: "Alumni near you", detail: "See who is around on Connect" });
    expect(data.worthALook.peers.detail).toBe("Find people who worked on the same projects");
    expect(data.now).toBeNull();
    expect(data.nameTag.subtitle).toBeNull();
  });
});
