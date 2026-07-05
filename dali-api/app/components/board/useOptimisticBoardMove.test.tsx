// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import {
  useOptimisticBoardMove,
  type OptimisticBoardMove,
} from "./useOptimisticBoardMove";

type Item = { id: string; status: string };

// Minimal hook harness without @testing-library (not a dep in this repo): a
// component captures the hook return into a box on each render. Covers the
// synchronous behaviors (seeding, server-data adoption, the adoptServerItems
// opt-out, and the immediate optimistic patch). The async POST→rollback path is
// exercised end-to-end by e2e/kanban-drag.spec.ts.
function mountHook(useHook: () => OptimisticBoardMove<Item>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const box: { current: OptimisticBoardMove<Item> } = {
    current: undefined as unknown as OptimisticBoardMove<Item>,
  };
  function Harness() {
    box.current = useHook();
    return null;
  }
  act(() => {
    root.render(createElement(Harness));
  });
  return {
    box,
    rerender: () =>
      act(() => {
        root.render(createElement(Harness));
      }),
    unmount: () =>
      act(() => {
        root.unmount();
      }),
  };
}

describe("useOptimisticBoardMove", () => {
  it("seeds local items from serverItems", () => {
    const items: Item[] = [{ id: "a", status: "todo" }];
    const h = mountHook(() => useOptimisticBoardMove(items));
    expect(h.box.current.items).toEqual(items);
    expect(h.box.current.isSaving).toBe(false);
    h.unmount();
  });

  it("applies the optimistic patch synchronously and reports isSaving", () => {
    const h = mountHook(() =>
      useOptimisticBoardMove<Item>([{ id: "a", status: "todo" }]),
    );
    act(() => {
      // A persist that never settles keeps the move in flight so we can observe
      // the optimistic patch + isSaving without touching the async resolution.
      h.box.current.move(
        (cur) => cur.map((i) => ({ ...i, status: "done" })),
        () => new Promise<void>(() => {}),
      );
    });
    expect(h.box.current.items[0].status).toBe("done");
    expect(h.box.current.isSaving).toBe(true);
    h.unmount();
  });

  it("adopts new serverItems when not saving (default)", () => {
    let server: Item[] = [{ id: "a", status: "todo" }];
    const h = mountHook(() => useOptimisticBoardMove(server));
    expect(h.box.current.items[0].status).toBe("todo");

    server = [{ id: "a", status: "review" }];
    h.rerender();
    expect(h.box.current.items[0].status).toBe("review");
    h.unmount();
  });

  it("does NOT adopt serverItems when adoptServerItems is false", () => {
    let server: Item[] = [{ id: "a", status: "todo" }];
    const h = mountHook(() =>
      useOptimisticBoardMove(server, { adoptServerItems: false }),
    );
    server = [{ id: "a", status: "review" }];
    h.rerender();
    expect(h.box.current.items[0].status).toBe("todo");
    h.unmount();
  });

  it("keeps the in-flight optimistic state when serverItems change mid-save", () => {
    let server: Item[] = [{ id: "a", status: "todo" }];
    const h = mountHook(() => useOptimisticBoardMove(server));
    act(() => {
      h.box.current.move(
        (cur) => cur.map((i) => ({ ...i, status: "done" })),
        () => new Promise<void>(() => {}),
      );
    });
    // A remote push arrives mid-save: it must NOT clobber the optimistic move.
    server = [{ id: "a", status: "stale" }];
    h.rerender();
    expect(h.box.current.items[0].status).toBe("done");
    h.unmount();
  });
});
