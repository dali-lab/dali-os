import { describe, it, expect, vi } from "vitest";
import { itemCount, reportMoveBatch, runMoveBatch } from "~/components/drive/move-batch";

// A batch move reports ONCE. The surfaces that call this used to loop a
// single-item move, so twelve files meant twelve stacked toasts, twelve tree
// revalidations, and twelve Undos that each reversed one file.

function toastSpy() {
  return { info: vi.fn(), error: vi.fn() };
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
    const items = [
      { id: "a", parentFolderId: "f1" },
      { id: "b", parentFolderId: null },
    ];
    const landed = await runMoveBatch(items, async () => true);
    expect(landed).toEqual([
      { item: items[0], folderId: "f1" },
      { item: items[1], folderId: null },
    ]);
  });

  it("keeps only the items that landed", async () => {
    const items = [
      { id: "a", parentFolderId: null },
      { id: "b", parentFolderId: null },
      { id: "c", parentFolderId: null },
    ];
    const landed = await runMoveBatch(items, async (i) => (i as { id: string }).id !== "b");
    expect(landed.map((l) => (l.item as { id: string }).id)).toEqual(["a", "c"]);
  });

  it("moves sequentially — a parallel burst would race the position rebuild", async () => {
    const order: string[] = [];
    const items = [
      { id: "a", parentFolderId: null },
      { id: "b", parentFolderId: null },
    ];
    await runMoveBatch(items, async (i) => {
      const id = (i as { id: string }).id;
      order.push(`start:${id}`);
      await Promise.resolve();
      order.push(`end:${id}`);
      return true;
    });
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });
});

describe("reportMoveBatch", () => {
  const ok = { moved: 3, total: 3, summary: "Moved 3 items to Design" };

  it("shows exactly one toast for the whole batch", () => {
    const toast = toastSpy();
    reportMoveBatch(toast, vi.fn(), { ...ok, undo: async () => {} });
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("revalidates once, not once per item", () => {
    const revalidate = vi.fn();
    reportMoveBatch(toastSpy(), revalidate, { ...ok, undo: async () => {} });
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("offers an Undo that reverses the whole batch, then revalidates again", async () => {
    const toast = toastSpy();
    const revalidate = vi.fn();
    const undo = vi.fn().mockResolvedValue(undefined);
    reportMoveBatch(toast, revalidate, { ...ok, undo });

    // The toast body carries the Undo button; fire its onClick.
    const node = toast.info.mock.calls[0][0] as { props: { children: unknown[] } };
    const button = node.props.children[1] as { props: { onClick: () => void } };
    button.props.onClick();
    await vi.waitFor(() => expect(revalidate).toHaveBeenCalledTimes(2));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("reports without an Undo when there is nothing to reverse", () => {
    // A move out of My Drive is one-way: the endpoint refuses a Member
    // destination, so an Undo could only fail.
    const toast = toastSpy();
    reportMoveBatch(toast, vi.fn(), { ...ok, undo: null });
    expect(toast.info).toHaveBeenCalledWith("Moved 3 items to Design", { duration: 6000 });
  });

  it("reports a partial failure without an Undo", () => {
    // Putting back only the half that landed splits the selection across two
    // places, which is harder to reason about than what the user can see.
    const toast = toastSpy();
    reportMoveBatch(toast, vi.fn(), {
      moved: 2,
      total: 3,
      summary: "Moved 2 of 3 items to Design",
      undo: async () => {},
    });
    expect(toast.info).toHaveBeenCalledWith("Moved 2 of 3 items to Design", { duration: 6000 });
  });

  it("errors — and never claims success — when nothing moved", () => {
    const toast = toastSpy();
    reportMoveBatch(toast, vi.fn(), { moved: 0, total: 3, summary: "unused", undo: async () => {} });
    expect(toast.error).toHaveBeenCalledWith("Couldn't move 3 items");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("names a single failed item without a count", () => {
    const toast = toastSpy();
    reportMoveBatch(toast, vi.fn(), { moved: 0, total: 1, summary: "unused", undo: null });
    expect(toast.error).toHaveBeenCalledWith("Couldn't move that item");
  });
});
