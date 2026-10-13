import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { scheduledMeeting: { findMany: vi.fn() } } }));
vi.mock("~/jobs/core-actor.server", () => ({ resolveCoreActor: vi.fn() }));
vi.mock("~/lib/core-meeting.server", () => ({ coreByPlacementBulk: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({
  resolveFilingFolder: vi.fn(),
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: "core", folderType }),
}));
vi.mock("~/lib/shortcuts.server", () => {
  class ShortcutError extends Error {}
  return { createShortcut: vi.fn(), ShortcutError };
});

import { prisma } from "~/lib/db";
import { resolveCoreActor } from "~/jobs/core-actor.server";
import { coreByPlacementBulk } from "~/lib/core-meeting.server";
import { resolveFilingFolder } from "~/lib/drive-receivers.server";
import { createShortcut, ShortcutError } from "~/lib/shortcuts.server";
import { CORE_FLAG_BATCH, runCoreFlagToShortcuts } from "~/jobs/core-flag-to-shortcuts.server";
import { JOBS } from "~/jobs/registry";

const m = prisma as any;
const flagged = (notebookId: string, organizerId = "org") => ({ notebookId, organizerId });
const shortcutOk = { shortcutId: "s", created: true, grantShareId: null, grantDeclined: false };
const dest = { workspaceType: "Lab", workspaceId: null, parentPageId: "core-meetings" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(resolveCoreActor).mockResolvedValue({ actorId: "core-a", coreGroupId: "g" });
  vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: "core-meetings", viaReceiver: true });
  m.scheduledMeeting.findMany.mockResolvedValue([]);
  vi.mocked(coreByPlacementBulk).mockImplementation(async (ids) => new Map(ids.map((id) => [id, false])));
  vi.mocked(createShortcut).mockResolvedValue(shortcutOk);
});

describe("core-flag-to-shortcuts registration", () => {
  it("is registered, off by default, and runs every minute until done", () => {
    const job = JOBS.find((j) => j.name === "core-flag-to-shortcuts");
    expect(job?.enabledByDefault).toBe(false);
    expect(job?.intervalMinutes).toBe(1);
  });
});

describe("runCoreFlagToShortcuts", () => {
  it("aborts without a Core actor", async () => {
    vi.mocked(resolveCoreActor).mockResolvedValue({ abort: "no core" });

    const res = await runCoreFlagToShortcuts();

    expect(res).toEqual({ items: 0, note: "Aborted: no core" });
    expect(m.scheduledMeeting.findMany).not.toHaveBeenCalled();
  });

  it("aborts when Core has no folder to file into", async () => {
    vi.mocked(resolveFilingFolder).mockResolvedValue({ folderId: null, viaReceiver: false });

    expect((await runCoreFlagToShortcuts()).items).toBe(0);
    expect(createShortcut).not.toHaveBeenCalled();
  });

  it("reads only flagged meetings whose live notebook is distinct", async () => {
    await runCoreFlagToShortcuts();

    expect(m.scheduledMeeting.findMany.mock.calls[0][0]).toMatchObject({
      where: { isCoreMeeting: true, notebook: { is: { kind: "Notebook", archivedAt: null } } },
      distinct: ["notebookId"],
    });
  });

  it("shortcuts each notebook not already Core into Core's Meetings folder as its organizer", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1", "o1"), flagged("nb2", "o2"), flagged("nb3", "o3")]);
    vi.mocked(coreByPlacementBulk).mockResolvedValue(
      new Map([
        ["nb1", false],
        ["nb2", true],
        ["nb3", false],
      ]),
    );

    const res = await runCoreFlagToShortcuts();

    expect(vi.mocked(createShortcut).mock.calls.map((c) => c[0])).toEqual([
      { targetPageId: "nb1", dest, actorId: "o1" },
      { targetPageId: "nb3", dest, actorId: "o3" },
    ]);
    expect(resolveFilingFolder).toHaveBeenCalledWith(expect.anything(), "core-a");
    expect(res).toEqual({ items: 2, note: "linked 2, declined 0, remaining 0" });
  });

  it("files one shortcut for a notebook shared by several meetings", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1", "o1"), flagged("nb1", "o2")]);

    await runCoreFlagToShortcuts();

    expect(createShortcut).toHaveBeenCalledTimes(1);
  });

  it("falls back to the Core actor when the organizer can't file there", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1", "o1")]);
    vi.mocked(createShortcut).mockRejectedValueOnce(new ShortcutError("no")).mockResolvedValueOnce(shortcutOk);

    const res = await runCoreFlagToShortcuts();

    expect(vi.mocked(createShortcut).mock.calls.map((c) => c[0].actorId)).toEqual(["o1", "core-a"]);
    expect(res.note).toBe("linked 1, declined 0, remaining 0");
  });

  it("counts a notebook nobody can file as declined and carries on", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1"), flagged("nb2")]);
    vi.mocked(createShortcut).mockImplementation((async ({ targetPageId }: { targetPageId: string }) => {
      if (targetPageId === "nb1") throw new ShortcutError("no");
      return shortcutOk;
    }) as never);

    const res = await runCoreFlagToShortcuts();

    expect(res).toEqual({ items: 1, note: "linked 1, declined 1, remaining 1" });
  });

  it("counts an unexpected failure as declined instead of retrying it as someone else", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1")]);
    vi.mocked(createShortcut).mockRejectedValue(new Error("db"));

    const res = await runCoreFlagToShortcuts();

    expect(createShortcut).toHaveBeenCalledTimes(1);
    expect(res.note).toBe("linked 0, declined 1, remaining 1");
  });

  it("takes one batch per tick and reports the rest as remaining", async () => {
    const rows = Array.from({ length: CORE_FLAG_BATCH + 5 }, (_, i) => flagged(`nb${i}`));
    m.scheduledMeeting.findMany.mockResolvedValue(rows);

    const res = await runCoreFlagToShortcuts();

    expect(createShortcut).toHaveBeenCalledTimes(CORE_FLAG_BATCH);
    expect(res).toEqual({ items: CORE_FLAG_BATCH, note: `linked ${CORE_FLAG_BATCH}, declined 0, remaining 5` });
  });

  it("is a no-op once every notebook is Core by placement", async () => {
    m.scheduledMeeting.findMany.mockResolvedValue([flagged("nb1")]);
    vi.mocked(coreByPlacementBulk).mockResolvedValue(new Map([["nb1", true]]));

    const res = await runCoreFlagToShortcuts();

    expect(createShortcut).not.toHaveBeenCalled();
    expect(res).toEqual({ items: 0, note: "linked 0, declined 0, remaining 0" });
  });
});
