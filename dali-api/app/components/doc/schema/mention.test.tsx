// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMentionMenuItems } from "./mention";
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
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useMentionMenuItems", () => {
  it("keeps the same getItems across re-renders with the same editor", () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "ada", tick: 0, seen });
    render({ editor: editorA, query: "ada", tick: 1, seen });
    render({ editor: editorA, query: "ada", tick: 2, seen });
    expect(new Set(seen).size).toBe(1);
  });

  it("does not refetch when the host re-renders with an unchanged query", () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "ada", tick: 0, seen });
    for (let tick = 1; tick <= 5; tick++) render({ editor: editorA, query: "ada", tick, seen });
    expect(urls()).toEqual(["/api/mentions/search?q=ada", "/api/mentions/pages?q=ada"]);
  });

  it("fetches again when the query changes", () => {
    const seen: Array<(q: string) => unknown> = [];
    render({ editor: editorA, query: "a", tick: 0, seen });
    render({ editor: editorA, query: "ad", tick: 1, seen });
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

  it("uses the given page search instead of the pages endpoint", () => {
    const seen: Array<(q: string) => unknown> = [];
    const noPages = vi.fn(async () => []);
    render({ editor: editorA, query: "ada", tick: 0, seen, searchPages: noPages });
    render({ editor: editorA, query: "ada", tick: 1, seen, searchPages: noPages });
    expect(urls()).toEqual(["/api/mentions/search?q=ada"]);
    expect(noPages).toHaveBeenCalledTimes(1);
    expect(noPages).toHaveBeenCalledWith("ada");
  });
});
