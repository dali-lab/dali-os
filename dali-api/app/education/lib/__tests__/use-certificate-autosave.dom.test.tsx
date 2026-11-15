// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import type { PlacedField } from "../certificate-fields";
import { useCertificateAutosave, type AutosaveStatus } from "../use-certificate-autosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DELAY = 20;
const f = (x: number): PlacedField[] => [{ key: "studentName", x, y: 0.2, w: 0.5, fontSize: 30, color: "#000000", align: "left", bold: false, fit: "wrap" }];

let container: HTMLDivElement;
let root: Root;
let status: AutosaveStatus;
let setFields: (fields: PlacedField[]) => void;
let replies: Array<(body: unknown) => void>;
let sent: Array<{ intent: string | null; x: number }>;
const fetchMock = vi.fn();

function Probe() {
  const [fields, set] = useState(f(0.1));
  setFields = set;
  status = useCertificateAutosave(fields, DELAY);
  return null;
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
const edit = (x: number) => act(() => setFields(f(x)));
const reply = async (body: unknown = { ok: true }) => {
  await wait(5);
  const next = replies.shift()!;
  await act(async () => next(body));
  await wait(5);
};

beforeEach(async () => {
  replies = [];
  sent = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null));
  vi.stubGlobal("fetch", fetchMock);
  const Stub = createRoutesStub([
    {
      path: "/t",
      Component: Probe,
      action: async ({ request }) => {
        const form = await request.formData();
        sent.push({ intent: form.get("intent") as string | null, x: JSON.parse(String(form.get("fields")))[0].x });
        const body = await new Promise<unknown>((r) => replies.push(r));
        return body;
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: ["/t"] })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useCertificateAutosave", () => {
  it("saves nothing until fields change", async () => {
    await wait(DELAY * 3);
    expect(sent).toEqual([]);
    expect(status.state).toBe("idle");
  });

  it("posts the save-fields intent to the route action once after the debounce and reads its reply", async () => {
    await edit(0.2);
    await edit(0.3);
    expect(status.state).toBe("saving");
    await wait(DELAY * 3);
    expect(sent).toEqual([{ intent: "save-fields", x: 0.3 }]);
    await reply({ ok: true });
    expect(status.state).toBe("saved");
  });

  it("keeps one save in flight and sends the newest edit after it returns", async () => {
    await edit(0.2);
    await wait(DELAY * 3);
    await edit(0.3);
    await wait(DELAY * 3);
    expect(sent.map((s) => s.x)).toEqual([0.2]);
    await reply({ ok: true });
    expect(sent.map((s) => s.x)).toEqual([0.2, 0.3]);
    expect(status.state).toBe("saving");
    await reply({ ok: true });
    expect(status.state).toBe("saved");
  });

  it("shows the action's own error message", async () => {
    await edit(0.2);
    await wait(DELAY * 3);
    await reply({ error: "Template not found" });
    expect(status).toEqual({ state: "error", error: "Template not found" });
  });

  it("retries the unsaved fields on the next edit after a failure", async () => {
    await edit(0.2);
    await wait(DELAY * 3);
    await reply({ error: "Template not found" });
    await edit(0.4);
    await wait(DELAY * 3);
    expect(sent.map((s) => s.x)).toEqual([0.2, 0.4]);
  });

  it("flushes a pending edit on unmount with a keepalive post", async () => {
    await edit(0.2);
    act(() => root.unmount());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    expect(JSON.parse(new URLSearchParams(init.body).get("fields")!)[0].x).toBe(0.2);
    root = createRoot(container);
  });

  it("flushes a pending edit on beforeunload once", async () => {
    await edit(0.2);
    act(() => window.dispatchEvent(new Event("beforeunload")));
    await wait(DELAY * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });

  it("sends nothing on unmount when there are no unsaved changes", () => {
    act(() => root.unmount());
    expect(fetchMock).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
