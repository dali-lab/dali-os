// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { SelfCheckInCard } = await import("~/components/SelfCheckInCard");

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const base = {
  eyebrow: "Course",
  title: "Session 1",
  when: "Tue 3pm",
  open: true,
  alreadyPresent: false,
  closedText: "Closed right now.",
  postUrl: "/api/check-in",
};

const render = (props: Partial<Parameters<typeof SelfCheckInCard>[0]> = {}) =>
  act(async () => root.render(createElement(SelfCheckInCard, { ...base, ...props })));
const button = () => container.querySelector("button");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SelfCheckInCard", () => {
  it("shows the header text", async () => {
    await render();
    expect(container.textContent).toContain("Course");
    expect(container.textContent).toContain("Session 1");
    expect(container.textContent).toContain("Tue 3pm");
  });

  it("shows the blocked message and no button", async () => {
    await render({ blocked: "Not enrolled." });
    expect(container.textContent).toContain("Not enrolled.");
    expect(button()).toBeNull();
  });

  it("shows checked in when already present", async () => {
    await render({ alreadyPresent: true });
    expect(container.textContent).toContain("You're checked in.");
    expect(button()).toBeNull();
  });

  it("shows the closed text when not open", async () => {
    await render({ open: false });
    expect(container.textContent).toContain("Closed right now.");
    expect(button()).toBeNull();
  });

  it("posts and shows checked in on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button()!.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/check-in", { method: "POST", credentials: "include" });
    expect(container.textContent).toContain("You're checked in.");
  });

  it("shows the server error on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Too early" }) });
    await render();
    await act(async () => button()!.click());
    expect(container.textContent).toContain("Too early");
    expect(button()).not.toBeNull();
  });

  it("falls back to a generic error", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new Error("x"); } });
    await render();
    await act(async () => button()!.click());
    expect(container.textContent).toContain("Check-in failed");
  });

  it("renders extra with the present state", async () => {
    await render({ alreadyPresent: true, extra: (p) => createElement("p", null, p ? "extra shown" : "no") });
    expect(container.textContent).toContain("extra shown");
  });
});
