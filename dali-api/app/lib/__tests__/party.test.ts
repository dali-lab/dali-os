import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WindowLike = {
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };
  sessionStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };
  dispatchEvent: (e: Event) => boolean;
};

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("party.ts retro helpers", () => {
  let classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; toggle: ReturnType<typeof vi.fn>; contains: (c: string) => boolean };
  let docClasses: Set<string>;
  let win: WindowLike;

  beforeEach(() => {
    docClasses = new Set();
    classList = {
      add: vi.fn((c: string) => void docClasses.add(c)),
      remove: vi.fn((c: string) => void docClasses.delete(c)),
      toggle: vi.fn((c: string, on?: boolean) => {
        const next = on ?? !docClasses.has(c);
        if (next) docClasses.add(c);
        else docClasses.delete(c);
        return next;
      }),
      contains: (c: string) => docClasses.has(c),
    };
    win = {
      localStorage: makeStorage(),
      sessionStorage: makeStorage(),
      dispatchEvent: vi.fn(() => true),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { documentElement: { classList } });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("setRetro(true) sets the localStorage flag and adds the html class", async () => {
    const { setRetro, isRetroOn } = await import("~/lib/party");
    setRetro(true);
    expect(isRetroOn()).toBe(true);
    expect(win.localStorage.getItem("dali:party:retro")).toBe("1");
    expect(docClasses.has("dali-retro")).toBe(true);
  });

  it("setRetro(false) clears the localStorage key and removes the html class", async () => {
    const { setRetro, isRetroOn } = await import("~/lib/party");
    setRetro(true);
    setRetro(false);
    expect(isRetroOn()).toBe(false);
    expect(win.localStorage.getItem("dali:party:retro")).toBeNull();
    expect(docClasses.has("dali-retro")).toBe(false);
  });

  it("setRetro(false) also resets the session click counter so the /party redirect doesn't trigger unexpectedly", async () => {
    const { setRetro } = await import("~/lib/party");
    win.sessionStorage.setItem("dali:party:logo-clicks", "5");
    setRetro(true);
    setRetro(false);
    expect(win.sessionStorage.getItem("dali:party:logo-clicks")).toBeNull();
  });

  it("setRetro(true) does not clear the session click counter", async () => {
    const { setRetro } = await import("~/lib/party");
    win.sessionStorage.setItem("dali:party:logo-clicks", "3");
    setRetro(true);
    expect(win.sessionStorage.getItem("dali:party:logo-clicks")).toBe("3");
  });

  it("setRetro dispatches a retro-change event so subscribers can rerender", async () => {
    const { setRetro } = await import("~/lib/party");
    setRetro(true);
    expect(win.dispatchEvent).toHaveBeenCalled();
    const event = (win.dispatchEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { type: string };
    expect(event.type).toBe("dali:party:retro-change");
  });
});
