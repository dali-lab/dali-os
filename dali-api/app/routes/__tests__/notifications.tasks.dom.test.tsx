// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({}));
vi.mock("~/lib/login-next", () => ({}));
vi.mock("~/lib/roles", () => ({}));
vi.mock("~/lib/tasks", () => ({}));
vi.mock("~/lib/notifications", () => ({}));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ pageTitle: "", iconBtn: "" }) }));
vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "UTC" }));
vi.mock("~/components/RsvpButtons", () => ({
  RsvpButtons: () => null,
  notifyTasksChanged: vi.fn(),
}));
vi.mock("~/components/NotificationBell", () => ({ TASKS_CHANGED_EVENT: "x" }));
vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import NotificationsRoute from "~/routes/notifications";

const task = (id: string) => ({
  id,
  title: `Task ${id}`,
  body: null,
  link: null,
  createdAt: "2026-05-20T10:00:00.000Z",
  source: "general",
  eventType: null,
  dueAt: null,
  hasAction: false,
  formTodo: false,
});
const work = (id: string) => ({
  id,
  title: `Work ${id}`,
  projectId: "proj",
  projectName: "Atlas",
  status: "Todo",
  dueAt: null,
  activityAt: "2026-05-20T10:00:00.000Z",
  link: `/projects/proj?tab=board&task=${id}`,
});

let container: HTMLDivElement;
let root: Root;

async function mount(entry: string, data: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let current = data;
  const router = createMemoryRouter(
    [{ path: "/notifications", Component: NotificationsRoute, loader: () => current }],
    { initialEntries: [entry] },
  );
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  return {
    setData: (next: Record<string, unknown>) => {
      current = next;
    },
    revalidate: () => act(async () => void (await router.revalidate())),
  };
}

const base = {
  notifications: [],
  history: null,
  singleFeed: false,
  projectTasks: [],
  projectCursor: null,
  projectTotal: 0,
  tasks: [],
  tasksCursor: null,
  taskTotal: 0,
};

const text = () => container.textContent ?? "";
const click = (label: string) =>
  act(async () => {
    [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!.click();
  });

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("My Tasks paging", () => {
  it("shows the true totals and loads the next open page", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ items: [task("n3"), task("n4")], nextCursor: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount("/notifications?tab=open", {
      ...base,
      tasks: [task("n1"), task("n2")],
      tasksCursor: "2026-05-20T10:00:00.000Z|n2",
      taskTotal: 4,
      projectTotal: 7,
    });
    expect(text()).toContain("My Tasks (11)");
    expect(text()).toContain("Showing 2 of 4");

    await click("Load more");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my-tasks?kind=open&cursor=2026-05-20T10%3A00%3A00.000Z%7Cn2",
      expect.anything(),
    );
    expect(text()).toContain("Task n4");
    expect(text()).not.toContain("Load more");
  });

  it("removes a task from a loaded page once it is confirmed", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/my-tasks")
        ? Response.json({ items: [task("n3"), task("n4")], nextCursor: "next" })
        : Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const page = await mount("/notifications?tab=open", {
      ...base,
      tasks: [task("n1")],
      tasksCursor: "c",
      taskTotal: 5,
    });
    await click("Load more");
    expect(text()).toContain("Task n3");

    const card = [...container.querySelectorAll("button")].filter((b) => b.textContent === "Confirm")[1];
    await act(async () => card.click());
    expect(text()).not.toContain("Task n3");
    expect(text()).toContain("Task n4");
    expect(text()).toContain("Showing 2 of 4");

    page.setData({ ...base, tasks: [task("n1")], tasksCursor: "c", taskTotal: 4 });
    await page.revalidate();
    expect(text()).not.toContain("Task n3");
    expect(text()).toContain("Showing 2 of 4");
  });

  it("asks for project work by how many rows are still loaded", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/my-tasks")
        ? Response.json({ items: [], nextCursor: null })
        : Response.json({ ok: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const page = await mount("/notifications", {
      ...base,
      projectTasks: [work("p1"), work("p2")],
      projectCursor: "2",
      projectTotal: 6,
    });
    expect(text()).toContain("Showing 2 of 6");
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Mark done")?.click();
    });
    await click("Load more");
    expect(fetchMock).toHaveBeenCalledWith("/api/my-tasks?kind=project&cursor=1", expect.anything());
  });
});
