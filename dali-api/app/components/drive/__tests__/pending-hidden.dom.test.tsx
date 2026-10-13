// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "./render-hook";
import { usePendingHidden, withoutHidden } from "~/components/drive/pending-hidden";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stable = {};
const scope = (id: string, ...itemIds: string[]) => ({ id, items: itemIds.map((i) => ({ id: i })) });

describe("withoutHidden", () => {
  it("returns the same array when nothing is hidden", () => {
    const scopes = [scope("lab", "a", "b")];
    expect(withoutHidden(scopes, new Set())).toBe(scopes);
  });

  it("drops hidden ids from every scope", () => {
    const out = withoutHidden([scope("lab", "a", "b"), scope("core", "b", "c")], new Set(["b"]));
    expect(out.map((s) => s.items.map((i) => i.id))).toEqual([["a"], ["c"]]);
  });

  it("keeps the identity of scopes it did not touch", () => {
    const untouched = scope("core", "c");
    const out = withoutHidden([scope("lab", "a"), untouched], new Set(["a"]));
    expect(out[1]).toBe(untouched);
    expect(out[0].items).toEqual([]);
  });

  it("does not mutate its input", () => {
    const lab = scope("lab", "a", "b");
    withoutHidden([lab], new Set(["a"]));
    expect(lab.items).toHaveLength(2);
  });

  it("ignores ids that are not in any scope", () => {
    const scopes = [scope("lab", "a")];
    expect(withoutHidden(scopes, new Set(["zzz"]))[0].items).toEqual([{ id: "a" }]);
  });
});

describe("usePendingHidden", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function mount() {
    return renderHook(({ state, data }: { state: "idle" | "loading"; data: unknown }) => usePendingHidden(state, data), {
      initialProps: { state: "idle" as "idle" | "loading", data: stable as unknown },
    });
  }

  it("hides ids the moment the request starts", () => {
    const { result } = mount();
    act(() => void result.current.hide(["a", "b"]));
    expect([...result.current.ids].sort()).toEqual(["a", "b"]);
  });

  it("shows only the failed ids again, right away", () => {
    const { result } = mount();
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a", "b", "c"]);
    });
    act(() => pending.settle(["b"]));
    expect([...result.current.ids].sort()).toEqual(["a", "c"]);
  });

  it("keeps settled ids hidden until the revalidation goes idle", () => {
    const { result, rerender } = mount();
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a"]);
    });
    act(() => pending.settle());
    expect([...result.current.ids]).toEqual(["a"]);
    rerender({ state: "loading", data: stable });
    expect([...result.current.ids]).toEqual(["a"]);
    rerender({ state: "idle", data: stable });
    expect([...result.current.ids]).toEqual([]);
  });

  it("treats a revalidation already in flight as the one that follows the request", () => {
    const { result, rerender } = mount();
    rerender({ state: "loading", data: stable });
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a"]);
    });
    act(() => pending.settle());
    rerender({ state: "idle", data: stable });
    expect([...result.current.ids]).toEqual([]);
  });

  it("does not release on an idle it saw before the request settled", () => {
    const { result, rerender } = mount();
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a"]);
    });
    rerender({ state: "idle", data: stable });
    expect([...result.current.ids]).toEqual(["a"]);
    act(() => pending.settle());
    expect([...result.current.ids]).toEqual(["a"]);
  });

  it("releases when fresh loader data arrives even if the loading state was never seen", () => {
    const { result, rerender } = mount();
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a"]);
    });
    act(() => pending.settle());
    rerender({ state: "idle", data: { fresh: true } });
    expect([...result.current.ids]).toEqual([]);
  });

  it("gives up hiding after the safety timeout", () => {
    const { result } = mount();
    let pending!: ReturnType<typeof result.current.hide>;
    act(() => {
      pending = result.current.hide(["a"]);
    });
    act(() => pending.settle());
    act(() => void vi.advanceTimersByTime(15_001));
    expect([...result.current.ids]).toEqual([]);
  });

  it("keeps a later request's ids hidden when an earlier one releases", () => {
    const { result, rerender } = mount();
    let first!: ReturnType<typeof result.current.hide>;
    act(() => {
      first = result.current.hide(["a"]);
    });
    act(() => first.settle());
    rerender({ state: "loading", data: stable });
    let second!: ReturnType<typeof result.current.hide>;
    act(() => {
      second = result.current.hide(["b"]);
    });
    rerender({ state: "idle", data: stable });
    expect([...result.current.ids]).toEqual(["b"]);
    act(() => second.settle());
    rerender({ state: "loading", data: stable });
    rerender({ state: "idle", data: stable });
    expect([...result.current.ids]).toEqual([]);
  });

  it("hides a moved row before its request answers, then clears after revalidation", async () => {
    const { result, rerender } = mount();
    const rows = [scope("lab", "a", "b")];
    let answer!: () => void;
    const request = new Promise<void>((resolve) => (answer = resolve));
    let done!: Promise<unknown>;
    act(() => {
      done = (async () => {
        const pending = result.current.hide(["a"]);
        await request;
        pending.settle();
      })();
    });
    expect(withoutHidden(rows, result.current.ids)[0].items.map((i) => i.id)).toEqual(["b"]);
    await act(async () => {
      answer();
      await done;
    });
    expect(withoutHidden(rows, result.current.ids)[0].items.map((i) => i.id)).toEqual(["b"]);
    rerender({ state: "loading", data: stable });
    rerender({ state: "idle", data: stable });
    expect(withoutHidden(rows, result.current.ids)[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
