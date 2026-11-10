// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

vi.mock("~/lib/db.server");
vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "America/New_York" }));
vi.mock("~/components/RsvpButtons", () => ({ RsvpButtons: () => null }));

import { HistoryTab } from "~/routes/notifications";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, title: string) => ({
  id,
  kind: "info",
  title,
  body: null,
  sender: null,
  state: "Open" as const,
  sentAt: "2026-10-20T15:00:00.000Z",
  clearedAt: null,
  link: null,
  canRsvp: false,
});

const initial = {
  items: [row("1", "From the loader")],
  nextCursor: null,
  counts: { open: 1, cleared: 0 },
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let router: ReturnType<typeof createMemoryRouter>;

const text = () => container.textContent ?? "";
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });

function mount(initialStatus: "open" | "cleared" | "all" = "all", search = "?tab=history") {
  const status = initialStatus === "all" ? "" : `&status=${initialStatus}`;
  router = createMemoryRouter(
    [{ path: "/notifications", Component: () => createElement(HistoryTab, { initial, initialStatus }) }],
    { initialEntries: [`/notifications${search}${status}`] },
  );
  act(() => root.render(createElement(RouterProvider, { router })));
}

const params = () => new URLSearchParams(router.state.location.search);

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ items: [row("2", "From the network")], nextCursor: null, counts: { open: 1, cleared: 2 } }),
  }));
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

describe("HistoryTab first page", () => {
  it("shows the loader's page without fetching it again", async () => {
    mount("all");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain("From the loader");
  });

  it("fetches when the status filter changes", async () => {
    mount("all");
    await flush();
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Open"))!;
    await act(async () => open.click());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notifications?status=open");
    expect(text()).toContain("From the network");
  });

  it("fetches again when returning to the starting filter after leaving it", async () => {
    mount("all");
    const click = async (label: string) => {
      const b = [...container.querySelectorAll("button")].find((x) => x.textContent?.startsWith(label))!;
      await act(async () => b.click());
      await flush();
    };
    await click("Open");
    await click("All");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("/api/notifications?status=all");
  });

  it("fetches when a search is typed", async () => {
    mount("all");
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "invite");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notifications?status=all&q=invite");
  });

  it("does not skip a starting status other than all", async () => {
    mount("cleared");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the picked status in the URL, replacing history", async () => {
    mount("all");
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Open"))!;
    await act(async () => open.click());
    await flush();
    expect(params().get("status")).toBe("open");
    expect(params().get("tab")).toBe("history");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("leaves All out of the URL", async () => {
    mount("open");
    const all = [...container.querySelectorAll("button")].find((b) => b.textContent === "All")!;
    await act(async () => all.click());
    await flush();
    expect(params().has("status")).toBe(false);
  });

  it("opens on the status in the URL", async () => {
    mount("cleared");
    const active = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Cleared"))!;
    expect(active.getAttribute("aria-selected")).toBe("true");
  });

  it("saves the search in the URL once typing stops", async () => {
    mount("all");
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "invite");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(params().has("q")).toBe(false);
    await flush();
    expect(params().get("q")).toBe("invite");
  });

  it("opens on the search in the URL and fetches it", async () => {
    mount("all", "?tab=history&q=invite");
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("invite");
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notifications?status=all&q=invite");
  });
});
