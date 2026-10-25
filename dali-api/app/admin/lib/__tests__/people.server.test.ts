import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(),
  isS3Configured: vi.fn(),
}));

import { getDownloadUrl, isS3Configured } from "~/lib/s3";
import { loadPeopleById } from "~/admin/lib/people.server";

const findMany = vi.fn();
const db = { user: { findMany } } as unknown as Parameters<typeof loadPeopleById>[0];

const user = (over: Record<string, unknown>) => ({
  id: "u1",
  firstName: "Ada",
  lastName: "Lovelace",
  daliEmail: "ada@example.edu",
  photoUrl: null,
  ...over,
});

describe("loadPeopleById", () => {
  beforeEach(() => {
    findMany.mockReset();
    vi.mocked(getDownloadUrl).mockReset();
    vi.mocked(getDownloadUrl).mockResolvedValue("https://s3.example/signed");
    vi.mocked(isS3Configured).mockReturnValue(true);
  });

  it("skips the query when there are no ids", async () => {
    expect((await loadPeopleById(db, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("queries each id once", async () => {
    findMany.mockResolvedValue([]);
    await loadPeopleById(db, ["u1", "u2", "u1"]);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ["u1", "u2"] } });
  });

  it("presigns uploaded photo keys so the browser gets a working src", async () => {
    findMany.mockResolvedValue([user({ photoUrl: "uploads/avatars/u1/a.webp" })]);
    const people = await loadPeopleById(db, ["u1"]);
    expect(people.get("u1")?.photoUrl).toBe("https://s3.example/signed");
    expect(getDownloadUrl).toHaveBeenCalledWith("uploads/avatars/u1/a.webp", { cacheFor: 3600 });
  });

  it("passes external photo URLs through", async () => {
    findMany.mockResolvedValue([user({ photoUrl: "https://lh3.googleusercontent.com/a/x" })]);
    const people = await loadPeopleById(db, ["u1"]);
    expect(people.get("u1")?.photoUrl).toBe("https://lh3.googleusercontent.com/a/x");
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns a null photo when the user has none", async () => {
    findMany.mockResolvedValue([user({})]);
    expect((await loadPeopleById(db, ["u1"])).get("u1")).toEqual({
      id: "u1",
      name: "Ada Lovelace",
      email: "ada@example.edu",
      photoUrl: null,
    });
  });

  it("falls back to the email, then null, for the name", async () => {
    findMany.mockResolvedValue([
      user({ id: "u1", firstName: "", lastName: "" }),
      user({ id: "u2", firstName: "", lastName: "", daliEmail: null }),
    ]);
    const people = await loadPeopleById(db, ["u1", "u2"]);
    expect(people.get("u1")?.name).toBe("ada@example.edu");
    expect(people.get("u2")?.name).toBeNull();
  });

  it("leaves deleted users out of the map", async () => {
    findMany.mockResolvedValue([user({})]);
    const people = await loadPeopleById(db, ["u1", "gone"]);
    expect(people.has("gone")).toBe(false);
  });
});
