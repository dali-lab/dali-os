// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PlacedField } from "../certificate-fields";
import { useCertificateAutosave, type AutosaveStatus } from "../use-certificate-autosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const f = (x: number): PlacedField[] => [{ key: "studentName", x, y: 0.2, w: 0.5, fontSize: 30, color: "#000000", align: "left", bold: false, fit: "wrap" }];

let container: HTMLDivElement;
let root: Root;
let status: AutosaveStatus;
let resolvers: Array<(r: Response) => void>;
const fetchMock = vi.fn();

function Probe({ fields }: { fields: PlacedField[] }) {
  status = useCertificateAutosave(fields, 800);
  return null;
}
const render = (fields: PlacedField[]) => act(() => root.render(createElement(Probe, { fields })));
const reply = async (body: unknown = { ok: true }, ok = true) => {
  const next = resolvers.shift()!;
  await act(async () => next({ ok, json: async () => body } as Response));
};
const sentX = (i: number) => JSON.parse(new URLSearchParams(fetchMock.mock.calls[i][1].body).get("fields")!)[0].x;

beforeEach(() => {
  vi.useFakeTimers();
  resolvers = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => new Promise((r) => resolvers.push(r)));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCertificateAutosave", () => {
  it("saves nothing until fields change", () => {
    render(f(0.1));
    act(() => vi.advanceTimersByTime(5000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.state).toBe("idle");
  });

  it("posts the save-fields intent once after the debounce", async () => {
    render(f(0.1));
    render(f(0.2));
    render(f(0.3));
    expect(status.state).toBe("saving");
    act(() => vi.advanceTimersByTime(799));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(new URLSearchParams(init.body).get("intent")).toBe("save-fields");
    expect(sentX(0)).toBe(0.3);
    await reply();
    expect(status.state).toBe("saved");
  });

  it("keeps one save in flight and sends the newest edit after it returns", async () => {
    render(f(0.1));
    render(f(0.2));
    act(() => vi.advanceTimersByTime(800));
    render(f(0.3));
    act(() => vi.advanceTimersByTime(800));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await reply();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentX(0)).toBe(0.2);
    expect(sentX(1)).toBe(0.3);
    await reply();
    expect(status.state).toBe("saved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed save", async () => {
    render(f(0.1));
    render(f(0.2));
    act(() => vi.advanceTimersByTime(800));
    await reply({ error: "Template not found" }, false);
    expect(status).toEqual({ state: "error", error: "Template not found" });
  });

  it("flushes a pending edit on unmount with keepalive", () => {
    render(f(0.1));
    render(f(0.2));
    act(() => root.unmount());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    expect(sentX(0)).toBe(0.2);
    root = createRoot(container);
  });

  it("flushes a pending edit on beforeunload with keepalive", () => {
    render(f(0.1));
    render(f(0.2));
    act(() => window.dispatchEvent(new Event("beforeunload")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing on unmount when there are no unsaved changes", () => {
    render(f(0.1));
    act(() => root.unmount());
    expect(fetchMock).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
