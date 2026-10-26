// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getMentionMenuItems, mentionPageCache, mentionUserCache, useMentionMenuItems } from "./mention";
import type { DocEditorInstance } from "./build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const editorA = { insertInlineContent: vi.fn() } as unknown as DocEditorInstance;
const editorB = { insertInlineContent: vi.fn() } as unknown as DocEditorInstance;

let fetchMock: ReturnType<typeof vi.fn>;
let container: HTMLDivElement;
let root: Root;

// Mirrors BlockNote's useLoadSuggestionMenuItems: load on [query, getItems].
function Menu(props: {
  editor: DocEditorInstance;
  query: string;
  tick: number;
  seen: Array<(q: string) => unknown>;
  searchPages?: (q: string) => Promise<never[]>;
}) {
  const getItems = useMentionMenuItems(props.editor, props.searchPages);
  props.seen.push(getItems);
  useEffect(() => {
    void getItems(props.query);
  }, [props.query, getItems]);
  return null;
}

function render(props: Parameters<typeof Menu>[0]) {
  act(() => root.render(createElement(Menu, props)));
}

function urls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.includes("/pages") ? { pages: [] } : { members: [] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  mentionUserCache.clear();
  mentionPageCache.clear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(150); });

describe("useMentionMenuItems", () => {
  it("keeps the same getItems across re-renders with the same editor", () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "ada", tick: 0, seen });
    render({ editor: editorA, query: "ada", tick: 1, seen });
    render({ editor: editorA, query: "ada", tick: 2, seen });
    expect(new Set(seen).size).toBe(1);
  });

  it("does not refetch when the host re-renders with an unchanged query", async () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "ada", tick: 0, seen });
    for (let tick = 1; tick <= 5; tick++) render({ editor: editorA, query: "ada", tick, seen });
    await settle();
    expect(urls()).toEqual(["/api/mentions/search?q=ada", "/api/mentions/pages?q=ada"]);
  });

  it("fetches the new query once typing pauses", async () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "a", tick: 0, seen });
    await settle();
    render({ editor: editorA, query: "ad", tick: 1, seen });
    await settle();
    expect(urls()).toEqual([
      "/api/mentions/search?q=a",
      "/api/mentions/pages?q=a",
      "/api/mentions/search?q=ad",
      "/api/mentions/pages?q=ad",
    ]);
  });

  it("returns a new getItems when the editor changes", () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "ada", tick: 0, seen });
    render({ editor: editorB, query: "ada", tick: 0, seen });
    expect(new Set(seen).size).toBe(2);
  });

  it("uses the given page search instead of the pages endpoint", async () => {
    const seen: Array<(q: string) => unknown> = [];
    const noPages = vi.fn(async () => []);
    render({ editor: editorA, query: "ada", tick: 0, seen, searchPages: noPages });
    render({ editor: editorA, query: "ada", tick: 1, seen, searchPages: noPages });
    await settle();
    expect(urls()).toEqual(["/api/mentions/search?q=ada"]);
    expect(noPages).toHaveBeenCalledTimes(1);
    expect(noPages).toHaveBeenCalledWith("ada", expect.any(Function));
  });
});

const people = [
  { id: "u1", name: "Ada Lovelace", handle: "ada" },
  { id: "u2", name: "Grace Hopper", handle: "grace" },
  { id: "u3", name: "Alan Turing", handle: "alan" },
];
const pages = [
  { id: "p1", title: "Roadmap" },
  { id: "p2", title: "Retro notes" },
];

function serve(
  respond: (url: string) => unknown = (url) =>
    url.includes("/pages") ? { pages } : { members: people },
) {
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => respond(url) }));
}

const titles = (items: Array<{ title: string }>) => items.map((i) => i.title);

describe("getMentionMenuItems caching", () => {
  it("opens instantly from cache the second time \"@\" is typed", async () => {
    serve();
    const first = getMentionMenuItems(editorA, "");
    await vi.advanceTimersByTimeAsync(150);
    expect(titles(await first)).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing", "Roadmap", "Retro notes"]);

    fetchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const second = await getMentionMenuItems(editorA, "");
    expect(titles(second)).toEqual(["Ada Lovelace", "Grace Hopper", "Alan Turing", "Roadmap", "Retro notes"]);
  });

  it("refetches in the background and reports changed results", async () => {
    serve();
    const warm = getMentionMenuItems(editorA, "");
    await vi.advanceTimersByTimeAsync(150);
    await warm;
    await vi.advanceTimersByTimeAsync(2500);

    serve((url) => (url.includes("/pages") ? { pages } : { members: [people[0]] }));
    const onFresh = vi.fn();
    const items = await getMentionMenuItems(editorA, "", undefined, undefined, onFresh);
    expect(titles(items)).toContain("Grace Hopper");
    await vi.advanceTimersByTimeAsync(150);
    expect(onFresh).toHaveBeenCalled();
    const after = await getMentionMenuItems(editorA, "");
    expect(titles(after)).not.toContain("Grace Hopper");
  });

  it("shows the longest cached prefix, filtered, while a longer query is in flight", async () => {
    serve();
    const warm = getMentionMenuItems(editorA, "a");
    await vi.advanceTimersByTimeAsync(150);
    await warm;

    fetchMock.mockClear();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const items = await getMentionMenuItems(editorA, "al");
    expect(titles(items)).toEqual(["Alan Turing"]);
  });

  it("debounces network requests while typing", async () => {
    serve();
    for (const q of ["a", "ad", "ada"]) {
      void getMentionMenuItems(editorA, q);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(urls()).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    expect(urls()).toEqual(["/api/mentions/search?q=ada", "/api/mentions/pages?q=ada"]);
  });

  it("does not cache a failed request", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const failed = getMentionMenuItems(editorA, "x");
    await vi.advanceTimersByTimeAsync(150);
    expect(await failed).toEqual([]);
    expect(mentionUserCache.peek("x")).toBeNull();
  });
});
