import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/geocode.server", () => ({ geocodePlace: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { geocodePlace } from "~/lib/geocode.server";
import { updateProfileFields } from "../profile-update.server";

const db = prisma as any;
const written = () => db.user.update.mock.calls[0][0].data;
const opts = { allowNetId: true };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue({ currentLocation: null });
  db.user.update.mockResolvedValue({});
});

describe("validation", () => {
  it("needs both names when either is given", async () => {
    await expect(updateProfileFields("u1", { firstName: "Ada" }, opts)).rejects.toMatchObject({
      field: "name",
      status: 400,
    });
    await expect(
      updateProfileFields("u1", { firstName: "Ada", lastName: "  " }, opts),
    ).rejects.toMatchObject({ field: "name" });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown timezone and clears on empty", async () => {
    await expect(updateProfileFields("u1", { timeZone: "Mars/Olympus" }, opts)).rejects.toMatchObject({
      field: "timeZone",
    });
    await updateProfileFields("u1", { timeZone: "" }, opts);
    expect(written()).toEqual({ timeZone: null });
  });

  it("rejects a malformed personal email", async () => {
    await expect(updateProfileFields("u1", { personalEmail: "ada.example.edu" }, opts)).rejects.toMatchObject({
      field: "personalEmail",
    });
  });

  it("accepts class years 1900 to 2100 as numbers or strings", async () => {
    for (const bad of ["1899", 2101, "20x8", 2020.5]) {
      await expect(updateProfileFields("u1", { classYear: bad }, opts)).rejects.toMatchObject({
        field: "classYear",
      });
    }
    const out = await updateProfileFields("u1", { classYear: "2028" }, opts);
    expect(written()).toEqual({ classYear: 2028 });
    expect(out.updated).toEqual({ classYear: 2028 });
    db.user.update.mockClear();
    await updateProfileFields("u1", { classYear: "" }, opts);
    expect(written()).toEqual({ classYear: null });
  });

  it("stores the birthday at UTC midnight and rejects bad dates", async () => {
    const out = await updateProfileFields("u1", { birthday: "1815-12-10" }, opts);
    expect(written().birthday.toISOString()).toBe("1815-12-10T00:00:00.000Z");
    expect(out.updated.birthday).toBe("1815-12-10");
    await expect(updateProfileFields("u1", { birthday: "nope" }, opts)).rejects.toMatchObject({
      field: "birthday",
    });
  });
});

describe("patch semantics", () => {
  it("leaves undefined fields alone and clears empty strings", async () => {
    await updateProfileFields("u1", { major: "", hometown: " Hanover " }, opts);
    expect(written()).toEqual({ major: null, hometown: "Hanover" });
  });

  it("skips the write for an empty patch", async () => {
    expect(await updateProfileFields("u1", {}, opts)).toEqual({ updated: {} });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("normalizes the handle and clears it when empty", async () => {
    await updateProfileFields("u1", { handle: " Ada_L! " }, opts);
    expect(written()).toEqual({ handle: "ada_l" });
    db.user.update.mockClear();
    await updateProfileFields("u1", { handle: "  " }, opts);
    expect(written()).toEqual({ handle: null });
  });

  it("lowercases the NetID only when allowed, and ignores it otherwise", async () => {
    await updateProfileFields("u1", { netId: "F00ADA" }, opts);
    expect(written()).toEqual({ netId: "f00ada" });
    db.user.update.mockClear();
    const out = await updateProfileFields("u1", { netId: "F00ADA", major: "Math" }, { allowNetId: false });
    expect(written()).toEqual({ major: "Math" });
    expect(out.updated).toEqual({ major: "Math" });
  });
});

describe("location pin", () => {
  it("does not look up or geocode when currentLocation is not in the patch", async () => {
    await updateProfileFields("u1", { major: "Math" }, opts);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(geocodePlace).not.toHaveBeenCalled();
  });

  it("geocodes only when the text changed", async () => {
    db.user.findUnique.mockResolvedValue({ currentLocation: "Hanover, NH" });
    await updateProfileFields("u1", { currentLocation: "Hanover, NH" }, opts);
    expect(geocodePlace).not.toHaveBeenCalled();
    expect(written()).toEqual({ currentLocation: "Hanover, NH" });
  });

  it("stores coordinates on change and clears them when removed", async () => {
    vi.mocked(geocodePlace).mockResolvedValue({ lat: 43.7, lng: -72.3 } as never);
    await updateProfileFields("u1", { currentLocation: "Hanover, NH" }, opts);
    expect(written()).toMatchObject({ currentLocationLat: 43.7, currentLocationLng: -72.3 });

    db.user.update.mockClear();
    vi.mocked(geocodePlace).mockClear();
    db.user.findUnique.mockResolvedValue({ currentLocation: "Hanover, NH" });
    await updateProfileFields("u1", { currentLocation: "" }, opts);
    expect(geocodePlace).not.toHaveBeenCalled();
    expect(written()).toMatchObject({
      currentLocation: null,
      currentLocationLat: null,
      currentLocationLng: null,
    });
  });
});

describe("unique violations", () => {
  const adapterError = (index: string) => ({
    code: "P2002",
    meta: { modelName: "User", driverAdapterError: { cause: { constraint: { index } } } },
  });

  it("names a taken handle for adapter-shaped and target-shaped errors", async () => {
    db.user.update.mockRejectedValue(adapterError("User_handle_key"));
    await expect(updateProfileFields("u1", { handle: "ada" }, opts)).rejects.toMatchObject({
      field: "handle",
      status: 409,
    });
    db.user.update.mockRejectedValue({ code: "P2002", meta: { target: ["handle"] } });
    await expect(updateProfileFields("u1", { handle: "ada" }, opts)).rejects.toMatchObject({
      field: "handle",
    });
  });

  it("names a taken NetID, not the handle", async () => {
    db.user.update.mockRejectedValue(adapterError("User_netId_key"));
    await expect(updateProfileFields("u1", { netId: "f00ada" }, opts)).rejects.toMatchObject({
      field: "netId",
    });
  });

  it("reports other unique violations generically and rethrows everything else", async () => {
    db.user.update.mockRejectedValue({ code: "P2002", meta: {} });
    await expect(updateProfileFields("u1", { major: "x" }, opts)).rejects.toMatchObject({ field: "unique" });
    db.user.update.mockRejectedValue(new Error("db down"));
    await expect(updateProfileFields("u1", { major: "x" }, opts)).rejects.toThrow("db down");
  });
});
