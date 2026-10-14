import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: vi.fn() }));
vi.mock("~/lib/drive-roots.server", () => ({
  ensureRoot: vi.fn(),
  rootKeyFor: (p: { processType?: string | null; processId?: string | null }) => {
    const byType: Record<string, string> = { Core: "core", HiringCycle: "hiring", Mentorship: "mentorship" };
    const key = byType[p.processType ?? ""];
    return key && key === p.processId ? key : null;
  },
}));

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { ensureRoot } from "~/lib/drive-roots.server";
import {
  RECEIVER_SLOTS,
  RECEIVER_LABELS,
  ReceiverError,
  acceptsReceiver,
  clearReceiver,
  clearTypeIfLeavingRoot,
  filingFolderOr,
  findReceiver,
  isUnderRoot,
  projectSlot,
  receiverProcessId,
  resolveFilingFolder,
  setFolderHint,
  setReceiver,
  singletonSlot,
} from "~/lib/drive-receivers.server";

const m = prisma as any;

type P = Record<string, unknown>;
const CLEARED = { folderType: null, processType: null, processId: null };

function page(id: string, over: P = {}): P {
  return {
    id,
    title: id,
    kind: "Folder",
    archivedAt: null,
    parentPageId: null,
    workspaceType: "Lab",
    workspaceId: null,
    folderType: null,
    processType: null,
    processId: null,
    ...over,
  };
}
const hiringRoot = page("hroot", { folderType: "Root", processType: "HiringCycle", processId: "hiring" });
const coreRoot = page("croot", { folderType: "Root", processType: "Core", processId: "core" });

function pages(...rows: P[]) {
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  m.page.findUnique.mockImplementation(({ where }: any) => Promise.resolve(byId.get(where.id) ?? null));
}

beforeEach(() => {
  vi.resetAllMocks();
  m.page.findFirst.mockResolvedValue(null);
  m.page.update.mockResolvedValue({});
  m.page.updateMany.mockResolvedValue({ count: 0 });
  m.$transaction.mockImplementation((fn: any) => fn(m));
  vi.mocked(logAuditEvent).mockResolvedValue(undefined);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as any);
});

describe("RECEIVER_SLOTS", () => {
  it("lists which folder types each process accepts", () => {
    expect(RECEIVER_SLOTS).toEqual({
      Core: ["Meetings", "Agreements", "EducationTemplates", "CertificateBackgrounds"],
      HiringCycle: ["HiringForms", "ApplicationTemplates"],
      Mentorship: ["MentorNotebooks"],
      Project: ["Meetings"],
      Lab: ["Meetings"],
    });
  });

  it("labels every folder type", () => {
    expect(RECEIVER_LABELS).toEqual({
      Meetings: "Meeting notebooks",
      HiringForms: "Hiring forms",
      ApplicationTemplates: "Application templates",
      Agreements: "Agreements",
      EducationTemplates: "Education templates",
      CertificateBackgrounds: "Certificate backgrounds",
      MentorNotebooks: "Mentor notebooks",
    });
  });

  it("acceptsReceiver follows the table", () => {
    expect(acceptsReceiver("Core", "Agreements")).toBe(true);
    expect(acceptsReceiver("HiringCycle", "Agreements")).toBe(false);
    expect(acceptsReceiver("EducationOffering", "Meetings")).toBe(false);
  });

  it("uses sentinel ids for singleton processes and the given id for a project", () => {
    expect(receiverProcessId("Core")).toBe("core");
    expect(receiverProcessId("HiringCycle")).toBe("hiring");
    expect(receiverProcessId("Mentorship")).toBe("mentorship");
    expect(receiverProcessId("Lab")).toBe("lab");
    expect(receiverProcessId("Project", "p1")).toBe("p1");
    expect(singletonSlot("Core", "Agreements")).toEqual({ processType: "Core", processId: "core", folderType: "Agreements" });
    expect(projectSlot("p1")).toEqual({ processType: "Project", processId: "p1", folderType: "Meetings" });
  });
});

describe("findReceiver", () => {
  it("looks up the live folder for the slot", async () => {
    m.page.findFirst.mockResolvedValue({ id: "f1" });
    expect(await findReceiver(singletonSlot("HiringCycle", "HiringForms"))).toBe("f1");
    expect(m.page.findFirst).toHaveBeenCalledWith({
      where: { processType: "HiringCycle", processId: "hiring", folderType: "HiringForms", archivedAt: null },
      select: { id: true },
    });
  });

  it("returns null when there is none", async () => {
    expect(await findReceiver(singletonSlot("Core", "Agreements"))).toBeNull();
  });
});

describe("isUnderRoot", () => {
  it("is true for a folder nested under the matching process root", async () => {
    pages(hiringRoot, page("mid", { parentPageId: "hroot" }), page("f", { parentPageId: "mid" }));
    expect(await isUnderRoot("f", singletonSlot("HiringCycle", "HiringForms"))).toBe(true);
  });

  it("is false under a different process root", async () => {
    pages(coreRoot, page("f", { parentPageId: "croot" }));
    expect(await isUnderRoot("f", singletonSlot("HiringCycle", "HiringForms"))).toBe(false);
  });

  it("is false for a folder at Lab top level with no root above it", async () => {
    pages(page("f"));
    expect(await isUnderRoot("f", singletonSlot("Core", "Agreements"))).toBe(false);
  });

  it("does not count the folder itself as its own root", async () => {
    pages(hiringRoot);
    expect(await isUnderRoot("hroot", singletonSlot("HiringCycle", "HiringForms"))).toBe(false);
  });

  it("stops on a cyclic chain", async () => {
    pages(page("a", { parentPageId: "b" }), page("b", { parentPageId: "a" }));
    expect(await isUnderRoot("a", singletonSlot("Core", "Agreements"))).toBe(false);
  });

  it("matches a project receiver by workspace", async () => {
    pages(page("f", { workspaceType: "Project", workspaceId: "p1" }));
    expect(await isUnderRoot("f", { processType: "Project", processId: "p1" })).toBe(true);
    expect(await isUnderRoot("f", { processType: "Project", processId: "p2" })).toBe(false);
  });

  it("accepts a Lab receiver only when no Root sits above it", async () => {
    pages(page("general", { parentPageId: null }), page("inCore", { parentPageId: "croot" }), coreRoot);
    expect(await isUnderRoot("general", { processType: "Lab", processId: "lab" })).toBe(true);
    expect(await isUnderRoot("inCore", { processType: "Lab", processId: "lab" })).toBe(false);
  });

  it("rejects a Lab-process folder that lives in a project workspace", async () => {
    pages(page("f", { workspaceType: "Project", workspaceId: "p1" }));
    expect(await isUnderRoot("f", { processType: "Lab", processId: "lab" })).toBe(false);
  });
});

describe("setReceiver", () => {
  const slot = singletonSlot("HiringCycle", "HiringForms");

  it("marks a folder under the root and writes an audit event", async () => {
    pages(hiringRoot, page("f", { parentPageId: "hroot" }));
    await setReceiver(slot, "f", "u1");
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "f" },
      data: { folderType: "HiringForms", processType: "HiringCycle", processId: "hiring" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "page.receiver",
        userId: "u1",
        targetId: "f",
        metadata: expect.objectContaining({ op: "set", folderType: "HiringForms", previousFolderId: null }),
      }),
    );
  });

  it("clears the previous receiver in the same transaction", async () => {
    pages(hiringRoot, page("f", { parentPageId: "hroot" }));
    m.page.findFirst.mockResolvedValue({ id: "old" });
    await setReceiver(slot, "f", "u1");
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.page.update).toHaveBeenNthCalledWith(1, { where: { id: "old" }, data: CLEARED });
    expect(m.page.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "f" } }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ previousFolderId: "old" }) }),
    );
  });

  it("rejects a folder outside the process root", async () => {
    pages(page("f"));
    await expect(setReceiver(slot, "f", "u1")).rejects.toBeInstanceOf(ReceiverError);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a Root", async () => {
    pages(hiringRoot);
    await expect(setReceiver(slot, "hroot", "u1")).rejects.toThrow(/root/i);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a trashed folder and a non-folder", async () => {
    pages(page("t", { archivedAt: new Date() }), page("d", { kind: "FreeForm" }));
    await expect(setReceiver(slot, "t", "u1")).rejects.toBeInstanceOf(ReceiverError);
    await expect(setReceiver(slot, "d", "u1")).rejects.toBeInstanceOf(ReceiverError);
    await expect(setReceiver(slot, "missing", "u1")).rejects.toBeInstanceOf(ReceiverError);
  });

  it("rejects a slot the process does not accept", async () => {
    await expect(
      setReceiver({ processType: "HiringCycle", processId: "hiring", folderType: "Agreements" }, "f", "u1"),
    ).rejects.toBeInstanceOf(ReceiverError);
  });

  it("rejects a folder that already receives a different slot, with a 409", async () => {
    pages(
      hiringRoot,
      page("f", { parentPageId: "hroot", folderType: "ApplicationTemplates", processType: "HiringCycle", processId: "hiring" }),
    );
    await expect(setReceiver(slot, "f", "u1")).rejects.toMatchObject({ status: 409 });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("is a no-op when the folder already receives this slot", async () => {
    pages(
      hiringRoot,
      page("f", { parentPageId: "hroot", folderType: "HiringForms", processType: "HiringCycle", processId: "hiring" }),
    );
    await setReceiver(slot, "f", "u1");
    expect(m.$transaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("lets a Meetings hint folder become a Meetings receiver", async () => {
    pages(coreRoot, page("f", { parentPageId: "croot", folderType: "Meetings" }));
    await setReceiver(singletonSlot("Core", "Meetings"), "f", "u1");
    expect(m.page.update).toHaveBeenCalledWith({
      where: { id: "f" },
      data: { folderType: "Meetings", processType: "Core", processId: "core" },
    });
  });

  it("refuses to turn a Meetings hint into a different kind of receiver", async () => {
    pages(hiringRoot, page("f", { parentPageId: "hroot", folderType: "Meetings" }));
    await expect(setReceiver(slot, "f", "u1")).rejects.toMatchObject({ status: 409 });
  });

  it("turns a unique-index race into a clear error", async () => {
    pages(hiringRoot, page("f", { parentPageId: "hroot" }));
    m.$transaction.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    m.page.findFirst.mockResolvedValue({ id: "winner" });
    await expect(setReceiver(slot, "f", "u1")).rejects.toMatchObject({ name: "ReceiverError", status: 409 });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("rethrows other database errors", async () => {
    pages(hiringRoot, page("f", { parentPageId: "hroot" }));
    m.$transaction.mockRejectedValue(new Error("boom"));
    await expect(setReceiver(slot, "f", "u1")).rejects.toThrow("boom");
  });
});

describe("clearReceiver", () => {
  const slot = singletonSlot("Core", "Agreements");

  it("nulls the three columns on the current receiver", async () => {
    m.page.findFirst.mockResolvedValue({ id: "f" });
    expect(await clearReceiver(slot, "u1")).toBe("f");
    expect(m.page.update).toHaveBeenCalledWith({ where: { id: "f" }, data: CLEARED });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "page.receiver", targetId: "f", metadata: expect.objectContaining({ op: "clear" }) }),
    );
  });

  it("does nothing when there is no receiver", async () => {
    expect(await clearReceiver(slot, "u1")).toBeNull();
    expect(m.page.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe("setFolderHint", () => {
  it("sets and clears the hint on a user folder", async () => {
    pages(page("f"));
    await setFolderHint("f", "Meetings", "u1");
    expect(m.page.update).toHaveBeenLastCalledWith({ where: { id: "f" }, data: { folderType: "Meetings" } });
    await setFolderHint("f", null, "u1");
    expect(m.page.update).toHaveBeenLastCalledWith({ where: { id: "f" }, data: { folderType: null } });
    expect(logAuditEvent).toHaveBeenCalledTimes(2);
  });

  it("refuses a process receiver", async () => {
    pages(page("f", { folderType: "Meetings", processType: "Core", processId: "core" }));
    await expect(setFolderHint("f", null, "u1")).rejects.toMatchObject({ status: 409 });
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("refuses a Root", async () => {
    pages(coreRoot);
    await expect(setFolderHint("croot", "Meetings", "u1")).rejects.toBeInstanceOf(ReceiverError);
    expect(m.page.update).not.toHaveBeenCalled();
  });
});

describe("clearTypeIfLeavingRoot", () => {
  it("queries only live typed non-Root receivers among the given ids", async () => {
    m.page.findMany.mockResolvedValue([]);
    await clearTypeIfLeavingRoot(["a", "b"]);
    expect(m.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["a", "b"] },
          kind: "Folder",
          archivedAt: null,
          processType: { not: null },
          NOT: { folderType: "Root" },
        }),
      }),
    );
  });

  it("clears exactly the receivers that left their root", async () => {
    m.page.findMany.mockResolvedValue([
      { id: "stays", processType: "HiringCycle", processId: "hiring" },
      { id: "leaves", processType: "HiringCycle", processId: "hiring" },
    ]);
    pages(hiringRoot, page("stays", { parentPageId: "hroot" }), page("leaves"));
    m.page.updateMany.mockResolvedValue({ count: 1 });

    expect(await clearTypeIfLeavingRoot(["stays", "leaves"])).toEqual(["leaves"]);
    expect(m.page.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["leaves"] } }, data: CLEARED });
  });

  it("writes nothing when every receiver is still under its root", async () => {
    m.page.findMany.mockResolvedValue([{ id: "stays", processType: "HiringCycle", processId: "hiring" }]);
    pages(hiringRoot, page("stays", { parentPageId: "hroot" }));
    expect(await clearTypeIfLeavingRoot(["stays"])).toEqual([]);
    expect(m.page.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list", async () => {
    expect(await clearTypeIfLeavingRoot([])).toEqual([]);
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("clears a project receiver moved to another project", async () => {
    m.page.findMany.mockResolvedValue([{ id: "f", processType: "Project", processId: "p1" }]);
    pages(page("f", { workspaceType: "Project", workspaceId: "p2" }));
    expect(await clearTypeIfLeavingRoot(["f"])).toEqual(["f"]);
  });
});

describe("resolveFilingFolder", () => {
  it("returns the receiver when one exists", async () => {
    m.page.findFirst.mockResolvedValue({ id: "recv" });
    expect(await resolveFilingFolder(singletonSlot("HiringCycle", "HiringForms"), "u1")).toEqual({
      folderId: "recv",
      viaReceiver: true,
    });
    expect(ensureRoot).not.toHaveBeenCalled();
  });

  it.each([
    ["Core", "Agreements", "core"],
    ["HiringCycle", "HiringForms", "hiring"],
    ["Mentorship", "MentorNotebooks", "mentorship"],
  ] as const)("falls back to the %s root", async (processType, folderType, key) => {
    vi.mocked(ensureRoot).mockResolvedValue("root-id");
    expect(await resolveFilingFolder(singletonSlot(processType, folderType), "u1")).toEqual({
      folderId: "root-id",
      viaReceiver: false,
    });
    expect(ensureRoot).toHaveBeenCalledWith(key, "u1");
  });

  it("falls back to the workspace top level for the Lab", async () => {
    expect(await resolveFilingFolder(singletonSlot("Lab", "Meetings"), "u1")).toEqual({ folderId: null, viaReceiver: false });
    expect(ensureRoot).not.toHaveBeenCalled();
  });

  describe("a project with no Meetings receiver", () => {
    const tx = { $queryRaw: vi.fn(), page: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() } };
    const mark = { folderType: "Meetings", processType: "Project", processId: "p1" };

    beforeEach(() => {
      tx.$queryRaw.mockReset().mockResolvedValue([]);
      tx.page.findFirst.mockReset().mockResolvedValue(null);
      tx.page.update.mockReset().mockResolvedValue({});
      tx.page.create.mockReset().mockResolvedValue({ id: "made" });
      m.$transaction.mockImplementation(async (fn: unknown) => (typeof fn === "function" ? fn(tx) : Promise.all(fn as Promise<unknown>[])));
    });

    it("makes a Meetings folder at the project's top level and marks it as the receiver", async () => {
      tx.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ position: 3 });

      expect(await resolveFilingFolder(projectSlot("p1"), "u1")).toEqual({ folderId: "made", viaReceiver: true });

      expect(tx.page.create).toHaveBeenCalledWith({
        data: {
          workspaceType: "Project",
          workspaceId: "p1",
          parentPageId: null,
          title: "Meetings",
          kind: "Folder",
          position: 4,
          createdById: "u1",
          ...mark,
        },
        select: { id: true },
      });
      expect(ensureRoot).not.toHaveBeenCalled();
    });

    it("adopts a live top-level folder already titled Meetings instead of making a second one", async () => {
      tx.page.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "theirs" });

      expect(await resolveFilingFolder(projectSlot("p1"), "u1")).toEqual({ folderId: "theirs", viaReceiver: true });

      expect(tx.page.update).toHaveBeenCalledWith({ where: { id: "theirs" }, data: mark });
      expect(tx.page.create).not.toHaveBeenCalled();
    });

    it("returns the receiver another request marked while this one waited on the lock", async () => {
      tx.page.findFirst.mockResolvedValueOnce({ id: "raced" });

      expect(await resolveFilingFolder(projectSlot("p1"), "u1")).toEqual({ folderId: "raced", viaReceiver: true });

      expect(tx.page.update).not.toHaveBeenCalled();
      expect(tx.page.create).not.toHaveBeenCalled();
    });

    it("locks the project row before deciding", async () => {
      await resolveFilingFolder(projectSlot("p1"), "u1");
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});

describe("filingFolderOr", () => {
  const slot = singletonSlot("Core", "Agreements");

  it("runs the legacy path with the flag off and never looks for a receiver", async () => {
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(false);
    const legacy = vi.fn().mockResolvedValue("legacy-folder");
    expect(await filingFolderOr(slot, "u1", legacy)).toBe("legacy-folder");
    expect(m.page.findFirst).not.toHaveBeenCalled();
    expect(isFeatureEnabledForEveryone).toHaveBeenCalledWith("drive-receivers", undefined);
  });

  it("resolves receiver-else-root with the flag on and skips the legacy path", async () => {
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(true);
    vi.mocked(ensureRoot).mockResolvedValue("core-root");
    const legacy = vi.fn();
    expect(await filingFolderOr(slot, "u1", legacy)).toBe("core-root");
    expect(legacy).not.toHaveBeenCalled();
  });
});
