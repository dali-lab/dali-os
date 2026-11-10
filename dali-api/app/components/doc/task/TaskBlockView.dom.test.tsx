// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/components/ui/toast";
import { TaskBlockView, formatTaskDate, isTaskOverdue } from "./TaskBlockView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = {
  title: "Send the SOW",
  status: "InProgress",
  assignee: { name: "Ada Park" },
  assignees: [{ id: "u1", name: "Ada Park" }],
  projectName: "Campus Compost",
  dueAt: "2026-11-07T00:00:00.000Z",
};

function stubFetch(status: number, body: unknown = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

let root: Root | null = null;
let host: HTMLElement;
let nextId = 0;

async function view(props: { editable?: boolean; docProjectId?: string | null } = {}) {
  nextId += 1;
  const taskId = `task-${nextId}`;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(
        ToastProvider,
        null,
        createElement(TaskBlockView, { taskId, projectId: "p1", label: "Saved title", editable: false, ...props }),
      ),
    );
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return taskId;
}

const links = () => [...host.querySelectorAll("a")];
const link = (name: string) => links().find((a) => a.textContent === name);

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("TaskBlockView", () => {
  it("shows only the saved title to someone without access", async () => {
    stubFetch(403);
    await view();
    expect(host.textContent).toContain("Saved title");
    expect(links()).toHaveLength(0);
    expect(host.textContent).not.toContain("In progress");
  });

  it("shows live status, title, owner and date, and links the title to the task", async () => {
    stubFetch(200, { id: "x", ...card });
    const taskId = await view();
    expect(link("Send the SOW")?.getAttribute("href")).toBe(`/projects/p1?tab=progress&task=${taskId}`);
    expect(host.textContent).toContain("In progress");
    expect(host.textContent).toContain("Nov 7");
  });

  it("hides the project name in the task's own project", async () => {
    stubFetch(200, { id: "x", ...card });
    await view({ docProjectId: "p1" });
    expect(link("Send the SOW")).toBeTruthy();
    expect(host.textContent).not.toContain("Campus Compost");
  });

  it("names the project in any other doc", async () => {
    stubFetch(200, { id: "x", ...card });
    await view({ docProjectId: null });
    expect(host.textContent).toContain("Campus Compost");
  });

  it("collapses co-owners to +N and links out instead of offering an edit", async () => {
    stubFetch(200, { id: "x", ...card, members: [], assignees: [...card.assignees, { id: "u2", name: "Grace Hall" }] });
    await view({ editable: true, docProjectId: "p1" });
    expect(link("Ada Park +1")?.getAttribute("href")).toContain("task=");
    expect(host.querySelector('[aria-label="Owner of Send the SOW"]')).toBeNull();
  });

  it("offers status, owner and date edits on a single-owner task", async () => {
    stubFetch(200, { id: "x", ...card, members: [] });
    await view({ editable: true, docProjectId: "p1" });
    expect(host.querySelector('[aria-label="Owner of Send the SOW"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Status of Send the SOW"]')).toBeTruthy();
  });

  it("never offers edits in a read-only doc", async () => {
    stubFetch(200, { id: "x", ...card });
    await view({ editable: false });
    expect(link("Send the SOW")).toBeTruthy();
    expect(host.querySelector('[aria-label="Status of Send the SOW"]')).toBeNull();
    expect(host.querySelector('[aria-label="Owner of Send the SOW"]')).toBeNull();
  });
});

describe("formatTaskDate", () => {
  it("reads the stored UTC day, whatever the viewer's zone", () => {
    expect(formatTaskDate("2026-11-07T00:00:00.000Z")).toBe("Nov 7");
  });
});

describe("isTaskOverdue", () => {
  const now = new Date("2026-11-08T12:00:00.000Z");

  it("is true for an open task past its day", () => {
    expect(isTaskOverdue({ status: "Todo", dueAt: "2026-11-07T00:00:00.000Z" }, now)).toBe(true);
  });

  it("is false on the day itself", () => {
    expect(isTaskOverdue({ status: "Todo", dueAt: "2026-11-08T00:00:00.000Z" }, now)).toBe(false);
  });

  it("is false for settled or undated tasks", () => {
    expect(isTaskOverdue({ status: "Done", dueAt: "2026-11-07T00:00:00.000Z" }, now)).toBe(false);
    expect(isTaskOverdue({ status: "Cancelled", dueAt: "2026-11-07T00:00:00.000Z" }, now)).toBe(false);
    expect(isTaskOverdue({ status: "Todo", dueAt: null }, now)).toBe(false);
  });
});
