// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { RsvpButtons } from "~/components/RsvpButtons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let resolveFetch: (r: Response) => void;
const fetchMock = vi.fn();
const onResponded = vi.fn();
const onFailed = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === name)!;

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolveFetch = r)));
  vi.stubGlobal("fetch", fetchMock);
  const Stub = createRoutesStub([
    {
      path: "/",
      loader: () => null,
      Component: () => createElement(RsvpButtons, { notificationId: "n1", onResponded, onFailed }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(ToastProvider, null, createElement(Stub, { initialEntries: ["/"] }))));
  await act(async () => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("RsvpButtons", () => {
  it("shows the answer and reports it before the server replies", async () => {
    await act(async () => button("Maybe").click());
    expect(button("Maybe").getAttribute("aria-pressed")).toBe("true");
    expect(button("Going").getAttribute("aria-pressed")).toBe("false");
    expect(button("Going").disabled).toBe(true);
    expect(onResponded).toHaveBeenCalledWith("Tentative");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("takes the answer back and says why when the server refuses", async () => {
    await act(async () => button("Going").click());
    await act(async () => resolveFetch(json({ error: "Not your invite" }, 403)));
    expect(button("Going").disabled).toBe(false);
    expect(button("Going").getAttribute("aria-pressed")).toBe("false");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Not your invite");
  });

  it("keeps the answer and warns when only the Google sync failed", async () => {
    await act(async () => button("Can't make it").click());
    await act(async () => resolveFetch(json({ ok: true, gcalError: "quota" })));
    expect(onFailed).not.toHaveBeenCalled();
    expect(button("Can't make it").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toContain("Google sync failed: quota");
  });
});
