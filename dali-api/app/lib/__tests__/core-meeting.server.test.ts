import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findMany: vi.fn() },
    processFolderBinding: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/page-ancestry.server", () => ({ loadAncestorChain: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({
  findReceiver: vi.fn(),
  singletonSlot: (processType: string, folderType: string) => ({ processType, processId: "core", folderType }),
}));
vi.mock("~/lib/drive-roots.server", () => ({ findRoot: vi.fn() }));

import { prisma } from "~/lib/db";
import { loadAncestorChain } from "~/lib/page-ancestry.server";
import { findReceiver } from "~/lib/drive-receivers.server";
import { findRoot } from "~/lib/drive-roots.server";
import {
  coreByPlacementBulk,
  isCoreByPlacement,
  isMeetingCore,
  isMeetingCoreBulk,
} from "~/lib/core-meeting.server";

const m = prisma as any;

type Notebook = { id: string; parentPageId: string | null };
type Shortcut = { targetPageId: string; parentPageId: string | null };

function world(opts: {
  notebooks?: Notebook[];
  shortcuts?: Shortcut[];
  chains?: Record<string, string[]>;
  receiver?: string | null;
  root?: string | null;
  binding?: string | null;
}) {
  vi.mocked(findReceiver).mockResolvedValue(opts.receiver === undefined ? "recv" : opts.receiver);
  vi.mocked(findRoot).mockResolvedValue(opts.root === undefined ? "coreroot" : opts.root);
  m.processFolderBinding.findUnique.mockResolvedValue(opts.binding ? { folderPageId: opts.binding } : null);
  m.page.findMany.mockImplementation(async (args: any) =>
    args.where.kind === "Shortcut" ? (opts.shortcuts ?? []) : (opts.notebooks ?? []),
  );
  vi.mocked(loadAncestorChain).mockImplementation((async (id: string) =>
    (opts.chains?.[id] ?? [id]).map((chainId) => ({ id: chainId }))) as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isCoreByPlacement", () => {
  it("is false without a notebook and never queries", async () => {
    expect(await isCoreByPlacement(null)).toBe(false);
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("is true for a notebook directly in Core's Meetings receiver", async () => {
    world({ notebooks: [{ id: "n1", parentPageId: "recv" }] });
    expect(await isCoreByPlacement("n1")).toBe(true);
    expect(loadAncestorChain).not.toHaveBeenCalled();
  });

  it("is true for a notebook nested under the receiver", async () => {
    world({
      notebooks: [{ id: "n1", parentPageId: "sub" }],
      chains: { sub: ["sub", "recv", "coreroot"] },
    });
    expect(await isCoreByPlacement("n1")).toBe(true);
  });

  it("is true when only a shortcut to the notebook sits under the Core root", async () => {
    world({
      notebooks: [{ id: "n1", parentPageId: "proj" }],
      shortcuts: [{ targetPageId: "n1", parentPageId: "deep" }],
      chains: { proj: ["proj", "projroot"], deep: ["deep", "coreroot"] },
    });
    expect(await isCoreByPlacement("n1")).toBe(true);
  });

  it("is true under the flag-off Core meeting-notes binding folder", async () => {
    world({ notebooks: [{ id: "n1", parentPageId: "bound" }], receiver: null, binding: "bound" });
    expect(await isCoreByPlacement("n1")).toBe(true);
  });

  it("is false when neither the notebook nor a shortcut is under Core", async () => {
    world({
      notebooks: [{ id: "n1", parentPageId: "proj" }],
      shortcuts: [{ targetPageId: "n1", parentPageId: "labdocs" }],
      chains: { proj: ["proj", "projroot"], labdocs: ["labdocs"] },
    });
    expect(await isCoreByPlacement("n1")).toBe(false);
  });

  it("is false when Core has no folders at all", async () => {
    world({ notebooks: [{ id: "n1", parentPageId: "x" }], receiver: null, root: null });
    expect(await isCoreByPlacement("n1")).toBe(false);
  });

  it("ignores a notebook at the top of a workspace", async () => {
    world({ notebooks: [{ id: "n1", parentPageId: null }] });
    expect(await isCoreByPlacement("n1")).toBe(false);
  });
});

describe("coreByPlacementBulk", () => {
  it("answers every id, in the order given, with one ancestor walk per folder", async () => {
    world({
      notebooks: [
        { id: "a", parentPageId: "shared" },
        { id: "b", parentPageId: "shared" },
        { id: "c", parentPageId: "recv" },
      ],
      shortcuts: [{ targetPageId: "b", parentPageId: "recv" }],
      chains: { shared: ["shared", "projroot"] },
    });
    const result = await coreByPlacementBulk(["c", "a", "b", "missing"]);
    expect([...result]).toEqual([
      ["c", true],
      ["a", false],
      ["b", true],
      ["missing", false],
    ]);
    expect(loadAncestorChain).toHaveBeenCalledTimes(1);
  });

  it("returns an empty map for no ids without querying", async () => {
    expect((await coreByPlacementBulk([])).size).toBe(0);
    expect(m.page.findMany).not.toHaveBeenCalled();
  });
});

describe("isMeetingCore", () => {
  it("falls back to the column when the meeting has no notebook", async () => {
    expect(await isMeetingCore({ isCoreMeeting: true, notebookId: null })).toBe(true);
    expect(await isMeetingCore({ isCoreMeeting: false, notebookId: null })).toBe(false);
    expect(m.page.findMany).not.toHaveBeenCalled();
  });

  it("lets placement override the column once there is a notebook", async () => {
    world({ notebooks: [{ id: "n1", parentPageId: "proj" }], chains: { proj: ["proj"] } });
    expect(await isMeetingCore({ isCoreMeeting: true, notebookId: "n1" })).toBe(false);
    world({ notebooks: [{ id: "n1", parentPageId: "recv" }] });
    expect(await isMeetingCore({ isCoreMeeting: false, notebookId: "n1" })).toBe(true);
  });
});

describe("isMeetingCoreBulk", () => {
  it("mixes placement and the column fallback, keyed by meeting id", async () => {
    world({
      notebooks: [
        { id: "n1", parentPageId: "recv" },
        { id: "n2", parentPageId: "proj" },
      ],
      chains: { proj: ["proj"] },
    });
    const result = await isMeetingCoreBulk([
      { id: "m1", isCoreMeeting: false, notebookId: "n1" },
      { id: "m2", isCoreMeeting: true, notebookId: "n2" },
      { id: "m3", isCoreMeeting: true, notebookId: null },
      { id: "m4", isCoreMeeting: false, notebookId: null },
    ]);
    expect([...result]).toEqual([
      ["m1", true],
      ["m2", false],
      ["m3", true],
      ["m4", false],
    ]);
  });
});
