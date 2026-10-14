// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotebookPicker, type NotebookRow } from "~/components/notebooks/NotebookPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, over: Partial<NotebookRow> = {}): NotebookRow => ({
  id,
  title: `Notebook ${id}`,
  path: "Projects ▸ Atlas",
  workspaceType: "Project",
  workspaceId: "p1",
  parentPageId: null,
  tabCount: 2,
  lastNoteAt: null,
  suggested: false,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function mount(props: Partial<Parameters<typeof NotebookPicker>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(NotebookPicker, { open: true, onClose: () => {}, onPick: () => {}, ...props })));
}

const search = () => document.body.querySelector("input[type='search']") as HTMLInputElement;
const titles = () => Array.from(document.body.querySelectorAll("li button > span:first-child")).map((e) => e.textContent);

function typeQuery(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notebooks: [row("typed")] }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NotebookPicker with a preloaded list", () => {
  it("renders the rows without fetching", async () => {
    mount({ preloaded: { rows: [row("a", { suggested: true }), row("b")], status: "ready" } });
    await act(async () => vi.runAllTimersAsync());
    expect(titles()).toEqual(["Notebook a", "Notebook b"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it is loading while the caller's list loads, still without fetching", async () => {
    mount({ preloaded: { rows: [], status: "loading" } });
    await act(async () => vi.runAllTimersAsync());
    expect(document.body.textContent).toContain("Loading notebooks");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once a query is typed and shows what comes back", async () => {
    mount({ preloaded: { rows: [row("a")], status: "ready" }, projectId: "p1", meetingId: "m1" });
    typeQuery("week");
    await act(async () => vi.runAllTimersAsync());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/notebooks?q=week&projectId=p1&meetingId=m1");
    expect(titles()).toEqual(["Notebook typed"]);
  });

  it("goes back to the preloaded list when the query is cleared", async () => {
    mount({ preloaded: { rows: [row("a")], status: "ready" } });
    typeQuery("week");
    await act(async () => vi.runAllTimersAsync());
    typeQuery("");
    await act(async () => vi.runAllTimersAsync());
    expect(titles()).toEqual(["Notebook a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still hides the excluded notebook", async () => {
    mount({ preloaded: { rows: [row("a"), row("b")], status: "ready" }, excludeId: "a" });
    await act(async () => vi.runAllTimersAsync());
    expect(titles()).toEqual(["Notebook b"]);
  });

  it("hands back the picked notebook with its project and the folder it sits in", async () => {
    const onPick = vi.fn();
    mount({ preloaded: { rows: [row("a", { parentPageId: "p1-m" })], status: "ready" }, onPick });
    act(() => (document.body.querySelector("li button") as HTMLElement).click());
    expect(onPick).toHaveBeenCalledWith({
      id: "a",
      title: "Notebook a",
      path: "Projects ▸ Atlas",
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "p1-m",
    });
  });
});

describe("NotebookPicker without a preloaded list", () => {
  it("fetches when it opens", async () => {
    mount();
    await act(async () => vi.runAllTimersAsync());
    expect(fetchMock).toHaveBeenCalledWith("/api/notebooks", { credentials: "include" });
    expect(titles()).toEqual(["Notebook typed"]);
  });
});

describe("NotebookPicker new row", () => {
  const newButton = () =>
    Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("New notebook in Atlas"));

  it("puts the new-notebook row first and calls it", async () => {
    const onNew = vi.fn();
    mount({ preloaded: { rows: [row("a")], status: "ready" }, newRow: { label: "New notebook in Atlas", onNew } });
    expect(newButton()).toBeTruthy();
    const list = document.body.querySelector("section")!;
    expect(newButton()!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => newButton()!.click());
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("has no such row unless asked", () => {
    mount({ preloaded: { rows: [row("a")], status: "ready" } });
    expect(newButton()).toBeUndefined();
  });

  it("keeps the row while the list is empty", () => {
    mount({ preloaded: { rows: [], status: "ready" }, newRow: { label: "New notebook in Atlas", onNew: () => {} } });
    expect(newButton()).toBeTruthy();
  });
});
