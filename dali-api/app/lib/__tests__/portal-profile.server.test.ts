import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async () => "https://cdn/photo.png") }));

import { prisma } from "~/lib/db";
import { loadPortalProfile, savePortalProfile } from "~/lib/portal-profile.server";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const USER_ID = "user-1";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = { firstName: "Ada", lastName: "Lovelace" };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.update.mockResolvedValue({});
});

describe("loadPortalProfile", () => {
  it("splits the editable fields from the read-only sign-in address", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      pronouns: null,
      phoneNumber: null,
      classYear: 2027,
      major: null,
      timeZone: null,
      photoUrl: "k",
      daliEmail: null,
      dartmouthEmail: "ada@dartmouth.edu",
      personalEmail: "ada@gmail.com",
      netId: "f00abc",
    });

    const data = await loadPortalProfile(USER_ID);

    expect(data?.email).toBe("ada@dartmouth.edu");
    expect(data?.photoPreviewUrl).toBe("https://cdn/photo.png");
    // No auth identity leaks into the editable set — those fields resolve an
    // account at sign-in, so the form must not be able to write them.
    expect(Object.keys(data!.profile).sort()).toEqual([
      "classYear",
      "firstName",
      "lastName",
      "major",
      "phoneNumber",
      "photoUrl",
      "pronouns",
      "timeZone",
    ]);
  });

  it("returns null when the user row is gone", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await loadPortalProfile(USER_ID)).toBeNull();
  });
});

describe("savePortalProfile", () => {
  it("requires both names", async () => {
    const result = await savePortalProfile(USER_ID, form({ firstName: "Ada", lastName: " " }));
    expect(result).toEqual({ error: "First and last name are required." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range class year", async () => {
    const result = await savePortalProfile(USER_ID, form({ ...VALID, classYear: "27" }));
    expect(result).toEqual({ error: "Enter a valid class year (e.g. 2027)." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("blanks out empty optional fields rather than storing empty strings", async () => {
    const result = await savePortalProfile(
      USER_ID,
      form({ ...VALID, pronouns: "  ", major: "", classYear: "" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({
        firstName: "Ada",
        pronouns: null,
        major: null,
        classYear: null,
      }),
    });
  });

  it("drops a time zone the runtime doesn't recognize", async () => {
    await savePortalProfile(USER_ID, form({ ...VALID, timeZone: "Mars/Olympus" }));
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ timeZone: null }),
    });
  });

  it("writes only the photo for the hero avatar's update-photo intent", async () => {
    const result = await savePortalProfile(
      USER_ID,
      form({ intent: "update-photo", photoUrl: "avatars/user-1/abc.webp" }),
    );
    expect(result).toEqual({ ok: true });
    // No names in this submit — it must not trip the "names are required" guard
    // or clear any other field.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { photoUrl: "avatars/user-1/abc.webp" },
    });
  });

  it("leaves the photo alone when the form carries no photo field", async () => {
    // The profile home's edit form has no photo input — the hero avatar owns
    // it — so a save there must not null out the portrait.
    await savePortalProfile(USER_ID, form(VALID));
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("photoUrl");
  });

  it("still clears the photo when the form does carry an empty photo field", async () => {
    await savePortalProfile(USER_ID, form({ ...VALID, photoUrl: "" }));
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data.photoUrl).toBeNull();
  });

  it("ignores any email field the client tries to post", async () => {
    await savePortalProfile(
      USER_ID,
      form({ ...VALID, dartmouthEmail: "victim@dartmouth.edu", personalEmail: "victim@gmail.com" }),
    );
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("dartmouthEmail");
    expect(data).not.toHaveProperty("personalEmail");
  });
});
