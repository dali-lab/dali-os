import { describe, it, expect, vi } from "vitest";
import {
  itemCount,
  reportMoveBatch,
  runHiddenMoveBatch,
  runMoveBatch,
  type Landed,
} from "~/components/drive/move-batch";
import type { UndoEntry } from "~/components/drive/undo-stack";

type Row = { id: string; title: string; parentFolderId: string | null };
const row = (id: string, parentFolderId: string | null = null): Row => ({ id, title: `Title ${id}`, parentFolderId });
const landedOf = (...rows: Row[]): Landed<Row>[] => rows.map((item) => ({ item, folderId: item.parentFolderId }));

function setup() {
  const toast = { info: vi.fn(), error: vi.fn() };
  const recorded: UndoEntry[] = [];
  const history = {
    record: vi.fn((e: UndoEntry) => {
      recorded.push(e);
      return e;
    }),
    undoEntry: vi.fn(async () => {}),
  };
  const revalidate = vi.fn();
  return { deps: { toast, history, revalidate }, toast, history, recorded, revalidate };
}

describe("itemCount", () => {
  it("singularises one and pluralises the rest", () => {
    expect(itemCount(1)).toBe("1 item");
    expect(itemCount(0)).toBe("0 items");
    expect(itemCount(4)).toBe("4 items");
  });
});

describe("runMoveBatch", () => {
  it("records each item's origin folder before it moves", async () => {
    const items = [row("a", "f1"), row("b", null)];
    expect(await runMoveBatch(items, async () => true)).toEqual([
      { item: items[0], folderId: "f1" },
      { item: items[1], folderId: null },
    ]);
  });

  it("keeps only the items that landed", async () => {
    const items = [row("a"), row("b"), row("c")];
    const landed = await runMoveBatch(items, async (i) => i.id !== "b");
    expect(landed.map((l) => l.item.id)).toEqual(["a", "c"]);
  });

  it("moves sequentially: a parallel burst would race the position rebuild", async () => {
    const order: string[] = [];
    await runMoveBatch([row("a"), row("b")], async (i) => {
      order.push(`start:${i.id}`);
      await Promise.resolve();
      order.push(`end:${i.id}`);
      return true;
    });
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });
});

describe("runHiddenMoveBatch", () => {
  function hiding() {
    const settle = vi.fn();
    const hide = vi.fn(() => ({ settle }));
    return { hide, settle };
  }

  it("hides every row before the first request goes out", async () => {
    const h = hiding();
    const seen: string[] = [];
    await runHiddenMoveBatch(
      [row("a"), row("b")],
      async (i) => {
        seen.push(`${i.id}:${h.hide.mock.calls.length}`);
        return true;
      },
      h,
    );
    expect(h.hide).toHaveBeenCalledWith(["a", "b"]);
    expect(seen).toEqual(["a:1", "b:1"]);
  });

  it("settles with nothing failed when everything landed", async () => {
    const h = hiding();
    await runHiddenMoveBatch([row("a"), row("b")], async () => true, h);
    expect(h.settle).toHaveBeenCalledWith([]);
  });

  it("brings back the rows that did not land", async () => {
    const h = hiding();
    const landed = await runHiddenMoveBatch([row("a"), row("b"), row("c")], async (i) => i.id === "b", h);
    expect(landed.map((l) => l.item.id)).toEqual(["b"]);
    expect(h.settle).toHaveBeenCalledWith(["a", "c"]);
  });

  it("brings every row back when the batch throws", async () => {
    const h = hiding();
    await expect(
      runHiddenMoveBatch(
        [row("a"), row("b")],
        async () => {
          throw new Error("offline");
        },
        h,
      ),
    ).rejects.toThrow("offline");
    expect(h.settle).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("reportMoveBatch", () => {
  const forward = vi.fn(async () => true);
  const back = vi.fn(async () => true);

  it("shows exactly one toast for the whole batch, naming the items and the path", () => {
    const { deps, toast } = setup();
    reportMoveBatch(deps, {
      landed: landedOf(row("a"), row("b"), row("c")),
      total: 3,
      destination: "Core ▸ Meetings",
      forward,
      back,
    });
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info.mock.calls[0][0]).toBe("Moved 3 items to Core ▸ Meetings");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names a single item by title", () => {
    const { deps, toast } = setup();
    reportMoveBatch(deps, { landed: landedOf(row("a")), total: 1, destination: "Core", forward, back });
    expect(toast.info.mock.calls[0][0]).toBe("Moved “Title a” to Core");
  });

  it("revalidates once, not once per item", () => {
    const { deps, revalidate } = setup();
    reportMoveBatch(deps, { landed: landedOf(row("a"), row("b")), total: 2, destination: null, forward, back });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("holds the toast for 8 seconds with an Undo action and no inline button", () => {
    const { deps, toast } = setup();
    reportMoveBatch(deps, { landed: landedOf(row("a")), total: 1, destination: "Core", forward, back });
    const [message, opts] = toast.info.mock.calls[0];
    expect(typeof message).toBe("string");
    expect(opts.duration).toBe(8000);
    expect(opts.actions.map((a: { label: string }) => a.label)).toEqual(["Undo"]);
  });

  it("records one history entry and the toast's Undo goes through it", () => {
    const { deps, toast, history, recorded } = setup();
    reportMoveBatch(deps, { landed: landedOf(row("a"), row("b")), total: 2, destination: "Core", forward, back });
    expect(history.record).toHaveBeenCalledTimes(1);
    expect(recorded[0].label).toBe("Move");
    toast.info.mock.calls[0][1].actions[0].onClick();
    expect(history.undoEntry).toHaveBeenCalledWith(recorded[0]);
  });

  it("undo puts every landed item back, in order, and redo sends them again", async () => {
    const { deps, recorded } = setup();
    const calls: string[] = [];
    const landed = landedOf(row("a", "f1"), row("b", "f2"));
    reportMoveBatch(deps, {
      landed,
      total: 2,
      destination: "Core",
      forward: async (l) => (calls.push(`fwd:${l.item.id}`), true),
      back: async (l) => (calls.push(`back:${l.item.id}:${l.folderId}`), true),
    });
    await recorded[0].undo();
    await recorded[0].redo();
    expect(calls).toEqual(["back:a:f1", "back:b:f2", "fwd:a", "fwd:b"]);
  });

  it("undo throws when an item could not be put back, so the history keeps the entry", async () => {
    const { deps, recorded } = setup();
    reportMoveBatch(deps, {
      landed: landedOf(row("a"), row("b")),
      total: 2,
      destination: "Core",
      forward,
      back: async (l) => l.item.id !== "b",
    });
    await expect(recorded[0].undo()).rejects.toThrow("Couldn't put everything back");
  });

  it("redo throws when an item could not be moved again", async () => {
    const { deps, recorded } = setup();
    reportMoveBatch(deps, {
      landed: landedOf(row("a")),
      total: 1,
      destination: "Core",
      forward: async () => false,
      back,
    });
    await expect(recorded[0].redo()).rejects.toThrow("Couldn't move everything again");
  });

  it("offers no Undo and records nothing for a one-way move", () => {
    const { deps, toast, history } = setup();
    reportMoveBatch(deps, { landed: landedOf(row("a")), total: 1, destination: "Core", forward, back: null });
    expect(history.record).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Moved “Title a” to Core", { duration: 8000 });
  });

  it("reports a partial failure without an Undo", () => {
    // Putting back only the half that landed splits the selection across two places.
    const { deps, toast, history } = setup();
    reportMoveBatch(deps, {
      landed: landedOf(row("a"), row("b")),
      total: 3,
      destination: "Core ▸ Meetings",
      forward,
      back,
    });
    expect(history.record).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Moved 2 of 3 items to Core ▸ Meetings", { duration: 8000 });
  });

  it("errors, and never claims success, when nothing moved", () => {
    const { deps, toast, history } = setup();
    reportMoveBatch(deps, { landed: [], total: 3, destination: "Core", forward, back });
    expect(toast.error).toHaveBeenCalledWith("Couldn't move 3 items");
    expect(toast.info).not.toHaveBeenCalled();
    expect(history.record).not.toHaveBeenCalled();
  });

  it("names a single failed item without a count", () => {
    const { deps, toast } = setup();
    reportMoveBatch(deps, { landed: [], total: 1, destination: null, forward, back });
    expect(toast.error).toHaveBeenCalledWith("Couldn't move that item");
  });

  it("prefers the server's reason when it gave one", () => {
    const { deps, toast } = setup();
    reportMoveBatch(deps, { landed: [], total: 1, destination: null, forward, back, failure: "Can't move a folder into itself" });
    expect(toast.error).toHaveBeenCalledWith("Can't move a folder into itself");
  });

  it("still revalidates when nothing moved", () => {
    const { deps, revalidate } = setup();
    reportMoveBatch(deps, { landed: [], total: 1, destination: null, forward, back });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });
});
