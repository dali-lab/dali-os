// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
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
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(TasksDrawer, {
          open: true,
          onClose: vi.fn(),
          tasks,
          notifications: [],
          projectTasks: [],
          ...props,
        }),
      ),
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TasksDrawer", () => {
  it("shows the true count and a link to My Tasks when rows are not shown", () => {
    mount({ total: 120 });
    expect(container.querySelector("h2")?.textContent).toBe("Tasks (120)");
    expect(container.textContent).toContain("Showing 50 of 120");
    expect(container.querySelector('a[href="/notifications"]')).not.toBeNull();
  });

  it("opens My Tasks through onOpen", () => {
    const onOpen = vi.fn();
    mount({ total: 120, onOpen });
    act(() => container.querySelector<HTMLAnchorElement>('a[href="/notifications"]')!.click());
    expect(onOpen).toHaveBeenCalledWith("/notifications", "My Tasks");
  });

  it("says nothing extra when every row is shown", () => {
    mount({ total: 50 });
    expect(container.textContent).not.toContain("Showing");
  });

  it("leaves out the link where My Tasks is not reachable", () => {
    mount({ total: 120, allTasksLink: false });
    expect(container.textContent).toContain("Showing 50 of 120");
    expect(container.querySelector('a[href="/notifications"]')).toBeNull();
  });
});
