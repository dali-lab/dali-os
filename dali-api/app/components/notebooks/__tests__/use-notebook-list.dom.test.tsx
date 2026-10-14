// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNotebookList } from "~/components/notebooks/use-notebook-list";
import type { NotebookListState } from "~/components/notebooks/notebook-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Args = Parameters<typeof useNotebookList>[0];

let container: HTMLDivElement;
let root: Root;
let current: NotebookListState;
let fetchMock: ReturnType<typeof vi.fn>;

function Probe(args: Args) {
  current = useNotebookList(args);
  return null;
}

const render = (args: Args) => act(async () => root.render(createElement(Probe, args)));
const nb = { id: "a", title: "A", path: "Lab", workspaceType: "Lab", workspaceId: null, tabCount: 0, lastNoteAt: null, suggested: false };

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notebooks: [nb] }) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useNotebookList", () => {
  it("fetches nothing while disabled", async () => {
    await render({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current.status).toBe("loading");
  });

  it("loads the list as soon as it is enabled", async () => {
    await render({ enabled: false });
    await render({ enabled: true, projectId: "p1", meetingId: "m1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/notebooks?projectId=p1&meetingId=m1");
    expect(current).toEqual({ rows: [nb], status: "ready" });
  });

  it("fetches once per project and meeting while enabled", async () => {
    await render({ enabled: true, projectId: "p1" });
    await render({ enabled: true, projectId: "p1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render({ enabled: true, projectId: "p2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await render({ enabled: true, projectId: "p2", meetingId: "m1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports an error and keeps the rows it had", async () => {
    await render({ enabled: true, projectId: "p1" });
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await render({ enabled: true, projectId: "p2" });
    expect(current).toEqual({ rows: [nb], status: "error" });
  });
});
