// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("~/components/ui/Drawer", () => ({
  Drawer: ({ title, children }: { title: string; children: React.ReactNode }) =>
    createElement("div", null, createElement("h2", null, title), children),
}));

import { TasksDrawer } from "~/components/AttentionPanel";

let container: HTMLDivElement;
let root: Root;

function mount(props: Partial<React.ComponentProps<typeof TasksDrawer>>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, title: `Task ${i}`, link: null }));
  const router = createMemoryRouter([
    {
      path: "/",
      Component: () =>
        createElement(TasksDrawer, {
          open: true,
          onClose: vi.fn(),
          tasks,
          notifications: [],
          projectTasks: [],
          ...props,
        }),
    },
  ]);
  act(() => root.render(createElement(RouterProvider, { router })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TasksDrawer", () => {
  it("shows the true count and a link to My Tasks when rows are not shown", () => {
    mount({ totals: { generalTasks: 120 } });
    expect(container.querySelector("h2")?.textContent).toBe("Tasks (120)");
    expect(container.textContent).toContain("Showing 50 of 120");
    expect(container.querySelector('a[href="/notifications"]')).not.toBeNull();
  });

  it("opens My Tasks through onOpen", () => {
    const onOpen = vi.fn();
    mount({ totals: { generalTasks: 120 }, onOpen });
    act(() => container.querySelector<HTMLAnchorElement>('a[href="/notifications"]')!.click());
    expect(onOpen).toHaveBeenCalledWith("/notifications", "My Tasks");
  });

  it("says nothing extra when every row is shown", () => {
    mount({ totals: { generalTasks: 50 } });
    expect(container.textContent).not.toContain("Showing");
  });

  it("leaves out the link where My Tasks is not reachable", () => {
    mount({ totals: { generalTasks: 120 }, allTasksLink: false });
    expect(container.textContent).toContain("Showing 50 of 120");
    expect(container.querySelector('a[href="/notifications"]')).toBeNull();
  });

  it("counts each tab with its unloaded rows, matching the title", () => {
    const pings = Array.from({ length: 48 }, (_, i) => ({
      id: `p${i}`,
      title: `Ping ${i}`,
      link: `/projects/p1?tab=board&task=w${i}`,
      eventType: "task.assigned",
    }));
    const general = [
      { id: "g1", title: "Invite", link: null, eventType: "meeting.invite" },
      { id: "g2", title: "Mention", link: null, eventType: "pagedoc.mention" },
    ];
    mount({ tasks: [...general, ...pings], totals: { generalTasks: 10 } });
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Project work48", "General10"]);
    expect(container.querySelector("h2")?.textContent).toBe("Tasks (58)");
  });

  it("titles a portal feed Notifications, with one list and its own empty state", () => {
    mount({ tasks: [], singleFeed: true, title: "Notifications" });
    expect(container.querySelector("h2")?.textContent).toBe("Notifications (0)");
    expect(container.textContent).not.toContain("Project work");
    expect(container.textContent).toContain("New notifications will show up here.");
  });

  it("keeps the alumni single feed's wording", () => {
    mount({ tasks: [], singleFeed: true });
    expect(container.querySelector("h2")?.textContent).toBe("Tasks (0)");
    expect(container.textContent).toContain("New tasks will show up here.");
  });
});
