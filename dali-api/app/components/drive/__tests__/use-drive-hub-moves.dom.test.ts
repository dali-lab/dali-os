// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { useDriveHubMoves, type DriveHubMovesOptions } from "~/components/drive/use-drive-hub-moves";
import type { DriveItem } from "~/drive/lib/drive.server";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";
import { renderHook } from "./render-hook";

const at = new Date("2026-01-01T00:00:00Z");
const doc = (id: string, parentFolderId: string | null = null): DriveItem =>
  ({ type: "doc", id, title: `Doc ${id}`, parentFolderId, iconEmoji: null, updatedAt: at, href: `/documents/${id}` }) as DriveItem;
const folder = (id: string): DriveItem => ({ ...doc(id), type: "folder", title: `Folder ${id}` }) as DriveItem;

const lab: DriveTreeScope = { id: "lab", label: "Lab-wide", iconEmoji: null, items: [doc("a"), doc("b"), doc("c"), folder("f1")] };
const core: DriveTreeScope = { id: "core", label: "Core", iconEmoji: null, items: [folder("cf")] };
const shared: DriveTreeScope = { id: "shared", label: "Shared with me", iconEmoji: null, items: [] };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  mounted.splice(0).forEach((u) => u());
});
const mounted: Array<() => void> = [];

function setup(over: Partial<DriveHubMovesOptions> = {}, confirm = true) {
  const performMove = vi.fn(async () => true);
  const calls = {
    confirm: vi.fn(async (_opts: unknown) => confirm),
    info: vi.fn(),
    error: vi.fn(),
    revalidate: vi.fn(),
    hide: vi.fn(() => ({ settle: vi.fn() })),
    record: vi.fn((e) => e),
    undoEntry: vi.fn(),
    performMove,
  };
  const scopeActionsMap = new Map([["lab", { performMove } as never]]);
  const options: DriveHubMovesOptions = {
    driveScopes: [lab, core, shared],
    viewerId: "u1",
    effectiveScopeId: "lab",
    scopeActionsMap,
    scopeActionsRef: { current: scopeActionsMap },
    dialog: { confirm: calls.confirm } as never,
    toast: { info: calls.info, error: calls.error } as never,
    history: { record: calls.record, undoEntry: calls.undoEntry } as never,
    revalidate: calls.revalidate,
    pendingHidden: { ids: new Set(), hide: calls.hide },
    ...over,
  };
  const hook = renderHook(useDriveHubMoves, { initialProps: options });
  mounted.push(hook.unmount);
  return { calls, result: hook.result };
}

describe("useDriveHubMoves: same-drive drop", () => {
  it("moves each item into the folder and reports once", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMove("lab", [lab.items[0], lab.items[1]], "f1"));
    expect(calls.performMove).toHaveBeenCalledTimes(2);
    expect(calls.performMove.mock.calls[0].slice(0, 2)).toEqual([lab.items[0], "f1"]);
    expect(calls.info).toHaveBeenCalledTimes(1);
    expect(calls.revalidate).toHaveBeenCalledTimes(1);
    expect(calls.record).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty drop or a drive with no actions", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMove("lab", [], "f1"));
    await act(async () => result.current.onMove("core", [lab.items[0]], null));
    expect(calls.performMove).not.toHaveBeenCalled();
    expect(calls.info).not.toHaveBeenCalled();
  });

  it("says so when nothing could move, with the server's reason for a single item", async () => {
    const performMove = vi.fn(async (_i: DriveItem, _d: string | null, opts?: { onError?: (m: string) => void }) => {
      opts?.onError?.("Not allowed here");
      return false;
    });
    const map = new Map([["lab", { performMove } as never]]);
    const { calls, result } = setup({ scopeActionsMap: map, scopeActionsRef: { current: map } });
    await act(async () => result.current.onMove("lab", [lab.items[0]], "f1"));
    expect(calls.error).toHaveBeenCalledWith("Not allowed here");
    expect(calls.record).not.toHaveBeenCalled();
  });
});

describe("useDriveHubMoves: cross-drive move", () => {
  it("asks once and reports once for several items", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "core", [lab.items[0], lab.items[1], lab.items[2]]));
    expect(calls.confirm).toHaveBeenCalledTimes(1);
    expect(calls.confirm.mock.calls[0][0]).toMatchObject({ title: "Move 3 items?", confirmLabel: "Move" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pages/a/move");
    expect(calls.info).toHaveBeenCalledTimes(1);
    expect(calls.revalidate).toHaveBeenCalledTimes(1);
  });

  it("names the document and the audience when moving a single item", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "core", [lab.items[0]]));
    expect(calls.confirm.mock.calls[0][0]).toMatchObject({
      title: "Move to Core?",
      description: '"Doc a" will move to Core and become visible to Core only.',
    });
  });

  it("moves nothing when the confirm is cancelled", async () => {
    const { calls, result } = setup({}, false);
    await act(async () => result.current.onMoveToScope("lab", "core", [lab.items[0]]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.hide).not.toHaveBeenCalled();
    expect(calls.info).not.toHaveBeenCalled();
  });

  it("does not ask when the destination is the same drive, and skips an item already at the top", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "lab", [lab.items[0]]));
    expect(calls.confirm).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    const nested = setup();
    await act(async () => nested.result.current.onMoveToScope("lab", "lab", [doc("n", "f1")]));
    expect(nested.calls.confirm).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to move into or out of a virtual space", async () => {
    const { calls, result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "shared", [lab.items[0]]));
    expect(calls.error).toHaveBeenCalledWith("Open the document to change where it lives");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a refused move with the server's reason", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "No access" }) });
    const { calls, result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "core", [lab.items[0]]));
    expect(calls.error).toHaveBeenCalledWith("No access");
  });

  it("sends only the page route for docs and the drive route for files", async () => {
    const file = { ...doc("x"), type: "file" } as DriveItem;
    const { result } = setup();
    await act(async () => result.current.onMoveToScope("lab", "core", [file]));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drive/move");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ itemType: "file", itemId: "x", destFolderPageId: null });
  });
});

describe("useDriveHubMoves: destination picker", () => {
  it("opens the picker for a bulk move, then moves everything to the pick and reports once", async () => {
    const { calls, result } = setup();
    let done!: Promise<void>;
    act(() => {
      done = result.current.onBulkMove([lab.items[0], lab.items[1]]);
    });
    expect(result.current.movePicker?.heading).toBe("Move 2 items");
    expect(result.current.movePicker?.disabledDest).toEqual({ driveId: "lab", folderId: null });
    await act(async () => {
      result.current.resolveMovePicker({ driveId: "core", folderId: null });
      await done;
    });
    expect(result.current.movePicker).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls.info).toHaveBeenCalledTimes(1);
  });

  it("moves nothing when the picker is cancelled", async () => {
    const { calls, result } = setup();
    let done!: Promise<void>;
    act(() => {
      done = result.current.requestMoveCrossDrive("lab", lab.items[0]);
    });
    expect(result.current.movePicker?.heading).toBe('Move "Doc a"');
    await act(async () => {
      result.current.resolveMovePicker(null);
      await done;
    });
    expect(result.current.movePicker).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.confirm).not.toHaveBeenCalled();
  });

  it("bans a folder and its subtree as its own destination", () => {
    const { result } = setup();
    act(() => void result.current.requestMoveCrossDrive("lab", lab.items[3]));
    expect(result.current.movePicker?.disabledFolderIds?.has("f1")).toBe(true);
  });

  it("offers no drive that is virtual, and says when there is nowhere to go", async () => {
    const { calls, result } = setup({ driveScopes: [lab, shared] });
    act(() => void result.current.requestMoveCrossDrive("lab", lab.items[0]));
    expect(result.current.movePicker?.drives.map((d) => d.id)).toEqual(["lab"]);
    act(() => result.current.resolveMovePicker(null));
    const only = setup({ driveScopes: [shared] });
    await act(async () => only.result.current.requestMoveCrossDrive("shared", lab.items[0]));
    expect(only.calls.error).toHaveBeenCalledWith("There's nowhere else to move this");
    expect(only.result.current.movePicker).toBeNull();
    expect(calls.error).not.toHaveBeenCalled();
  });

  it("ignores a bulk move with no items, no open drive, or inside a virtual space", async () => {
    const { calls, result } = setup({ effectiveScopeId: null });
    await act(async () => result.current.onBulkMove([lab.items[0]]));
    await act(async () => result.current.onBulkMove([]));
    expect(result.current.movePicker).toBeNull();
    const virtual = setup({ effectiveScopeId: "shared" });
    await act(async () => virtual.result.current.onBulkMove([lab.items[0]]));
    expect(virtual.calls.error).toHaveBeenCalledWith("Open the document to change where it lives");
    expect(calls.error).not.toHaveBeenCalled();
  });
});
