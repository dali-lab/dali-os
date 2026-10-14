import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreFromTrashRequest, runTrash, trashTypeOf } from "~/components/drive/trash-batch";
import type { UndoEntry } from "~/components/drive/undo-stack";

type Item = { id: string; type: "doc" | "folder" | "file" | "form"; title: string };
const item = (id: string, type: Item["type"] = "doc"): Item => ({ id, type, title: `Title ${id}` });
const ok = () => new Response("{}", { status: 200 });
const refused = (error?: string) => new Response(JSON.stringify(error ? { error } : {}), { status: 409 });

function setup() {
  const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
  const recorded: UndoEntry[] = [];
  const history = {
    record: vi.fn((e: UndoEntry) => (recorded.push(e), e)),
    undoEntry: vi.fn(async () => {}),
  };
  const settle = vi.fn();
  const hiding = { hide: vi.fn(() => ({ settle })) };
  const revalidate = vi.fn();
  return { toast, history, recorded, hiding, settle, revalidate };
}

afterEach(() => vi.unstubAllGlobals());

describe("trashTypeOf", () => {
  it("files forms, files and folders under their own type and everything else as a doc", () => {
    expect(trashTypeOf({ type: "form" })).toBe("form");
    expect(trashTypeOf({ type: "file" })).toBe("file");
    expect(trashTypeOf({ type: "folder" })).toBe("folder");
    expect(trashTypeOf({ type: "doc" })).toBe("doc");
    expect(trashTypeOf({ type: "agreement" })).toBe("doc");
  });
});

describe("restoreFromTrashRequest", () => {
  it("posts a restore intent with the item's type and id", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    await restoreFromTrashRequest(item("f1", "folder"));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/drive/trash");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect([body.get("intent"), body.get("type"), body.get("id")]).toEqual(["restore", "folder", "f1"]);
  });
});

describe("runTrash", () => {
  it("hides the rows first, then deletes them one after another", async () => {
    const s = setup();
    const order: string[] = [];
    await runTrash({
      items: [item("a"), item("b")],
      deleteOne: async (i) => (order.push(`${s.hiding.hide.mock.calls.length}:${i.id}`), ok()),
      ...s,
    });
    expect(s.hiding.hide).toHaveBeenCalledWith(["a", "b"]);
    expect(order).toEqual(["1:a", "1:b"]);
  });

  it("settles with nothing failed, revalidates once, and names one item", async () => {
    const s = setup();
    await runTrash({ items: [item("a")], deleteOne: async () => ok(), ...s });
    expect(s.settle).toHaveBeenCalledWith([]);
    expect(s.revalidate).toHaveBeenCalledTimes(1);
    expect(s.toast.success.mock.calls[0][0]).toBe("Moved “Title a” to Trash");
  });

  it("counts several items", async () => {
    const s = setup();
    await runTrash({ items: [item("a"), item("b"), item("c"), item("d")], deleteOne: async () => ok(), ...s });
    expect(s.toast.success.mock.calls[0][0]).toBe("Moved 4 items to Trash");
  });

  it("holds the toast for 8 seconds with an Undo that goes through the history", async () => {
    const s = setup();
    await runTrash({ items: [item("a")], deleteOne: async () => ok(), ...s });
    const [, opts] = s.toast.success.mock.calls[0];
    expect(opts.duration).toBe(8000);
    expect(opts.actions.map((a: { label: string }) => a.label)).toEqual(["Undo"]);
    opts.actions[0].onClick();
    expect(s.history.undoEntry).toHaveBeenCalledWith(s.recorded[0]);
  });

  it("undo restores every trashed item and redo trashes them again", async () => {
    const s = setup();
    const deleted: string[] = [];
    const restored: string[] = [];
    await runTrash({
      items: [item("a"), item("b", "file")],
      deleteOne: async (i) => (deleted.push(i.id), ok()),
      restoreOne: async (i) => (restored.push(i.id), true),
      ...s,
    });
    deleted.length = 0;
    await s.recorded[0].undo();
    await s.recorded[0].redo();
    expect(restored).toEqual(["a", "b"]);
    expect(deleted).toEqual(["a", "b"]);
  });

  it("restores through the trash endpoint by default", async () => {
    const s = setup();
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);
    await runTrash({ items: [item("a", "form")], deleteOne: async () => ok(), ...s });
    await s.recorded[0].undo();
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect([body.get("intent"), body.get("type"), body.get("id")]).toEqual(["restore", "form", "a"]);
  });

  it("gives the entry its own undone and redone messages", async () => {
    const s = setup();
    await runTrash({ items: [item("a")], deleteOne: async () => ok(), ...s });
    expect(s.recorded[0].undoneMessage).toBe("Restored “Title a”");
    expect(s.recorded[0].redoneMessage).toBe("Moved “Title a” to Trash");
  });

  it("undo throws when something could not be restored", async () => {
    const s = setup();
    await runTrash({
      items: [item("a"), item("b")],
      deleteOne: async () => ok(),
      restoreOne: async (i) => i.id !== "b",
      ...s,
    });
    await expect(s.recorded[0].undo()).rejects.toThrow("Couldn't restore everything");
  });

  it("redo throws when something could not be trashed again", async () => {
    const s = setup();
    let first = true;
    await runTrash({
      items: [item("a")],
      deleteOne: async () => (first ? ((first = false), ok()) : refused()),
      restoreOne: async () => true,
      ...s,
    });
    await expect(s.recorded[0].redo()).rejects.toThrow("Couldn't move everything to Trash again");
  });

  it("gives back the rows that failed and says why for a single item", async () => {
    const s = setup();
    await runTrash({ items: [item("a", "folder")], deleteOne: async () => refused("The folder must be empty first."), ...s });
    expect(s.settle).toHaveBeenCalledWith(["a"]);
    expect(s.toast.error).toHaveBeenCalledWith("The folder must be empty first.");
    expect(s.toast.success).not.toHaveBeenCalled();
    expect(s.history.record).not.toHaveBeenCalled();
  });

  it("falls back to a plain message when the server gave no reason", async () => {
    const s = setup();
    await runTrash({ items: [item("a")], deleteOne: async () => refused(), ...s });
    expect(s.toast.error).toHaveBeenCalledWith("Couldn't delete");
  });

  it("treats a network failure as a failed delete", async () => {
    const s = setup();
    await runTrash({
      items: [item("a")],
      deleteOne: async () => {
        throw new Error("offline");
      },
      ...s,
    });
    expect(s.settle).toHaveBeenCalledWith(["a"]);
    expect(s.toast.error).toHaveBeenCalledWith("Couldn't delete");
  });

  it("counts the failures in a batch, still reporting and recording what did go", async () => {
    const s = setup();
    await runTrash({
      items: [item("a"), item("b"), item("c")],
      deleteOne: async (i) => (i.id === "b" ? refused("nope") : ok()),
      ...s,
    });
    expect(s.settle).toHaveBeenCalledWith(["b"]);
    expect(s.toast.error).toHaveBeenCalledWith("1 item couldn't be deleted");
    expect(s.toast.success.mock.calls[0][0]).toBe("Moved 2 items to Trash");
    expect(s.history.record).toHaveBeenCalledTimes(1);
  });

  it("pluralises the failure count", async () => {
    const s = setup();
    await runTrash({ items: [item("a"), item("b")], deleteOne: async () => refused(), ...s });
    expect(s.toast.error).toHaveBeenCalledWith("2 items couldn't be deleted");
  });

  it("still revalidates when everything failed", async () => {
    const s = setup();
    await runTrash({ items: [item("a")], deleteOne: async () => refused(), ...s });
    expect(s.revalidate).toHaveBeenCalledTimes(1);
  });
});
