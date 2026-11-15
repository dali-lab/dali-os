// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { flagCodec, listCodec, stringSetCodec, usePersistedState } from "../usePersistedState";
import { useRailCollapsed, NOTEBOOK_RAIL_COLLAPSED_KEY } from "~/components/notebooks/use-rail-collapsed";
import { renderDom } from "~/test-utils/render";

const original = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  if (original) Object.defineProperty(window, "localStorage", original);
  window.localStorage.clear();
});

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isStrings = (v: unknown): v is string[] => Array.isArray(v);

function Flag({ storageKey }: { storageKey: string }) {
  const [on, setOn] = usePersistedState(storageKey, false, isBoolean, flagCodec);
  return createElement("button", { onClick: () => setOn((v) => !v) }, on ? "on" : "off");
}

function Rail() {
  const { collapsed, setCollapsed } = useRailCollapsed();
  return createElement("button", { onClick: () => setCollapsed(!collapsed) }, collapsed ? "collapsed" : "open");
}

describe("usePersistedState codecs", () => {
  it("reads a legacy \"1\" flag and writes \"1\" back, removing the key when off", () => {
    window.localStorage.setItem("flag", "1");
    const { container } = renderDom(createElement(Flag, { storageKey: "flag" }));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("on");
    act(() => button.click());
    expect(button.textContent).toBe("off");
    expect(window.localStorage.getItem("flag")).toBeNull();
    act(() => button.click());
    expect(window.localStorage.getItem("flag")).toBe("1");
  });

  it("falls back when the stored value is unreadable", () => {
    window.localStorage.setItem("list", "{not json");
    function List() {
      const [v] = usePersistedState<string[]>("list", ["x"], isStrings);
      return createElement("p", null, v.join(","));
    }
    const { container } = renderDom(createElement(List));
    expect(container.textContent).toBe("x");
  });

  it("does not crash when storage access throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const { container } = renderDom(createElement(Flag, { storageKey: "flag" }));
    const button = container.querySelector("button")!;
    act(() => button.click());
    expect(button.textContent).toBe("on");
  });

  it("reads the notebook rail's legacy collapsed flag", () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    const { container } = renderDom(createElement(Rail));
    expect(container.textContent).toBe("collapsed");
    act(() => container.querySelector("button")!.click());
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
  });

  it("parses the stored string sets and filtered lists the old hooks wrote", () => {
    expect([...(stringSetCodec.parse('["a","b",3]') as Set<string>)]).toEqual(["a", "b"]);
    expect(stringSetCodec.serialize(new Set(["a"]))).toBe('["a"]');
    const codec = listCodec<"x" | "y">((v): v is "x" | "y" => v === "x" || v === "y");
    expect(codec.parse('["x","z","y"]')).toEqual(["x", "y"]);
    expect(codec.serialize(["y"])).toBe('["y"]');
  });
});
