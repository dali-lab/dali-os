import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    cycleInterviewer: { findFirst: vi.fn() },
    cycleReviewer: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isLabMentor: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ listFavoritesAndRecents: vi.fn() }));
vi.mock("~/lib/release-notes.server", () => ({ viewerHasUnseenReleaseNotes: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listVisibleGroupIdsForUser: vi.fn() }));
vi.mock("~/signing/lib/state.server", () => ({ getAppGateOutstanding: vi.fn() }));
vi.mock("~/forms/lib/gate.server", () => ({ getBoundFormGateOutstanding: vi.fn() }));
vi.mock("~/hiring/lib/new-member-cohort.server", () => ({ isNewMemberCohort: vi.fn() }));
vi.mock("~/lib/realtime-bus.server", () => ({ publish: vi.fn(), subscribe: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getUserRoles, isLabMentor } from "~/lib/roles";
import { listFavoritesAndRecents } from "~/lib/user-pages.server";
import { viewerHasUnseenReleaseNotes } from "~/lib/release-notes.server";
import { listVisibleGroupIdsForUser } from "~/lib/groups";
import { getAppGateOutstanding } from "~/signing/lib/state.server";
import { getBoundFormGateOutstanding } from "~/forms/lib/gate.server";
import { isNewMemberCohort } from "~/hiring/lib/new-member-cohort.server";
import { clearTtlCache, setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import { invalidateLayoutCache } from "~/lib/layout-cache.server";
import {
  layoutAppGate,
  layoutFavorites,
  layoutFormGate,
  layoutHasLiveCycleRole,
  layoutHasUnseenReleaseNotes,
  layoutIsAnyCycleReviewer,
  layoutIsLabMentor,
  layoutIsLiveInterviewer,
  layoutIsNewMember,
  layoutRoles,
} from "~/lib/layout-reads.server";

const db = prisma as unknown as {
  cycleInterviewer: { findFirst: ReturnType<typeof vi.fn> };
  cycleReviewer: { findFirst: ReturnType<typeof vi.fn> };
};
const request = new Request("http://test/");
const twice = async (read: () => Promise<unknown>) => [await read(), await read()];

beforeEach(() => {
  vi.clearAllMocks();
  setTtlCacheEnabledForTests(true);
});

afterEach(() => {
  clearTtlCache();
  setTtlCacheEnabledForTests(null);
});

describe("layoutRoles", () => {
  it("caches a lab member's roles", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isLabMember: true } as never);
    await twice(() => layoutRoles("ada", request));
    expect(getUserRoles).toHaveBeenCalledOnce();
    expect(getUserRoles).toHaveBeenCalledWith("ada", request);
  });

  it("re-reads a non-member every time, so a new member is let in at once", async () => {
    vi.mocked(getUserRoles)
      .mockResolvedValueOnce({ isLabMember: false } as never)
      .mockResolvedValueOnce({ isLabMember: true } as never);
    expect(await twice(() => layoutRoles("ada", request))).toEqual([
      { isLabMember: false },
      { isLabMember: true },
    ]);
  });

  it("re-reads after a roles clear", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isLabMember: true } as never);
    await layoutRoles("ada", request);
    invalidateLayoutCache("roles");
    await layoutRoles("ada", request);
    expect(getUserRoles).toHaveBeenCalledTimes(2);
  });
});

describe.each([
  ["layoutAppGate", layoutAppGate, getAppGateOutstanding, { bindingId: "b1" }],
  ["layoutFormGate", layoutFormGate, getBoundFormGateOutstanding, { token: "t1" }],
] as const)("%s", (_name, read, source, owed) => {
  it("caches nothing owed", async () => {
    vi.mocked(source).mockResolvedValue(null);
    expect(await twice(() => read("ada", request))).toEqual([null, null]);
    expect(source).toHaveBeenCalledOnce();
  });

  it("re-checks while something is owed, so finishing it lets the user through at once", async () => {
    vi.mocked(source)
      .mockResolvedValueOnce(owed as never)
      .mockResolvedValueOnce(null);
    expect(await twice(() => read("ada", request))).toEqual([owed, null]);
  });

  it("picks up a newly owed item after a gates clear", async () => {
    vi.mocked(source)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(owed as never);
    await read("ada", request);
    invalidateLayoutCache("gates");
    expect(await read("ada", request)).toEqual(owed);
  });
});

it("the signing and form gates don't share a cache entry", async () => {
  vi.mocked(getAppGateOutstanding).mockResolvedValue(null);
  vi.mocked(getBoundFormGateOutstanding).mockResolvedValue({ token: "t1" } as never);
  await layoutAppGate("ada", request);
  expect(await layoutFormGate("ada", request)).toEqual({ token: "t1" });
});

describe("hiring gates", () => {
  it("layoutIsLiveInterviewer asks about the live cycles and caches the answer", async () => {
    db.cycleInterviewer.findFirst.mockResolvedValue({ id: "ci1" });
    expect(await twice(() => layoutIsLiveInterviewer("ada", ["c1", "c2"]))).toEqual([true, true]);
    expect(db.cycleInterviewer.findFirst).toHaveBeenCalledOnce();
    expect(db.cycleInterviewer.findFirst).toHaveBeenCalledWith({
      where: { userId: "ada", applicationCycleId: { in: ["c1", "c2"] } },
      select: { id: true },
    });
  });

  it("layoutIsLiveInterviewer is false with no row", async () => {
    db.cycleInterviewer.findFirst.mockResolvedValue(null);
    expect(await layoutIsLiveInterviewer("ada", ["c1"])).toBe(false);
  });

  it("re-reads when the set of live cycles changes, but not when it only reorders", async () => {
    db.cycleInterviewer.findFirst.mockResolvedValue(null);
    await layoutIsLiveInterviewer("ada", ["c1", "c2"]);
    await layoutIsLiveInterviewer("ada", ["c2", "c1"]);
    expect(db.cycleInterviewer.findFirst).toHaveBeenCalledOnce();
    await layoutIsLiveInterviewer("ada", ["c1", "c2", "c3"]);
    expect(db.cycleInterviewer.findFirst).toHaveBeenCalledTimes(2);
  });

  it("layoutIsAnyCycleReviewer checks any cycle and caches", async () => {
    db.cycleReviewer.findFirst.mockResolvedValue({ id: "r1" });
    expect(await twice(() => layoutIsAnyCycleReviewer("ada"))).toEqual([true, true]);
    expect(db.cycleReviewer.findFirst).toHaveBeenCalledOnce();
    expect(db.cycleReviewer.findFirst).toHaveBeenCalledWith({
      where: { userId: "ada" },
      select: { id: true },
    });
  });

  it.each([
    [{ id: "r" }, null, true],
    [null, { id: "i" }, true],
    [null, null, false],
  ])("layoutHasLiveCycleRole: reviewer %j, interviewer %j → %s", async (reviewer, interviewer, expected) => {
    db.cycleReviewer.findFirst.mockResolvedValue(reviewer);
    db.cycleInterviewer.findFirst.mockResolvedValue(interviewer);
    expect(await layoutHasLiveCycleRole("ada", ["c1"])).toBe(expected);
  });

  it("the live-role and interviewer reads don't share a cache entry", async () => {
    db.cycleReviewer.findFirst.mockResolvedValue({ id: "r" });
    db.cycleInterviewer.findFirst.mockResolvedValue(null);
    expect(await layoutHasLiveCycleRole("ada", ["c1"])).toBe(true);
    expect(await layoutIsLiveInterviewer("ada", ["c1"])).toBe(false);
  });

  it("re-reads after a hiring clear", async () => {
    db.cycleReviewer.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "r1" });
    await layoutIsAnyCycleReviewer("ada");
    invalidateLayoutCache("hiring");
    expect(await layoutIsAnyCycleReviewer("ada")).toBe(true);
  });
});

describe("layoutHasUnseenReleaseNotes", () => {
  it("passes the user's visible groups and caches the answer", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([{ id: "g1" }, { id: "g2" }] as never);
    vi.mocked(viewerHasUnseenReleaseNotes).mockResolvedValue(true);
    expect(await twice(() => layoutHasUnseenReleaseNotes("ada", false, request))).toEqual([true, true]);
    expect(viewerHasUnseenReleaseNotes).toHaveBeenCalledExactlyOnceWith({
      userId: "ada",
      isCore: false,
      groupIds: ["g1", "g2"],
    });
  });

  it("keeps the Core and member answers apart", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
    vi.mocked(viewerHasUnseenReleaseNotes).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await layoutHasUnseenReleaseNotes("ada", false, request)).toBe(false);
    expect(await layoutHasUnseenReleaseNotes("ada", true, request)).toBe(true);
  });

  it("re-reads after the user's release notes are cleared", async () => {
    vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
    vi.mocked(viewerHasUnseenReleaseNotes).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await layoutHasUnseenReleaseNotes("ada", false, request);
    invalidateLayoutCache("releaseNotes", ["ada"]);
    expect(await layoutHasUnseenReleaseNotes("ada", false, request)).toBe(false);
  });
});

describe.each([
  ["layoutFavorites", () => layoutFavorites("ada", request), listFavoritesAndRecents, { favorites: [], recents: [] }, "favorites"],
  ["layoutIsLabMentor", () => layoutIsLabMentor("ada", request), isLabMentor, true, "mentor"],
  ["layoutIsNewMember", () => layoutIsNewMember("ada"), isNewMemberCohort, true, "newMember"],
] as const)("%s", (_name, read, source, value, piece) => {
  it("caches its read", async () => {
    vi.mocked(source).mockResolvedValue(value as never);
    expect(await twice(read)).toEqual([value, value]);
    expect(source).toHaveBeenCalledOnce();
  });

  it("re-reads after its piece is cleared for the user", async () => {
    vi.mocked(source).mockResolvedValue(value as never);
    await read();
    invalidateLayoutCache(piece, ["ada"]);
    await read();
    expect(source).toHaveBeenCalledTimes(2);
  });
});

it("layoutIsLabMentor asks about the current term", async () => {
  vi.mocked(isLabMentor).mockResolvedValue(false);
  await layoutIsLabMentor("ada", request);
  expect(isLabMentor).toHaveBeenCalledWith("ada", undefined, request);
});

it("layoutFavorites shares the request with the home panel's read", async () => {
  vi.mocked(listFavoritesAndRecents).mockResolvedValue({ favorites: [], recents: [] } as never);
  await layoutFavorites("ada", request);
  expect(listFavoritesAndRecents).toHaveBeenCalledWith("ada", request);
});
