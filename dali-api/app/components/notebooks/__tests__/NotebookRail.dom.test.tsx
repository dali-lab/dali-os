// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { NotebookRail, type NotebookView } from "~/components/notebooks/NotebookRail";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { NOTEBOOK_RAIL_COLLAPSED_KEY } from "~/components/notebooks/use-rail-collapsed";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notebook: NotebookView = {
  id: "nb1",
  title: "Weekly sync",
  canEdit: true,
  workspaceType: "Lab",
  workspaceId: null,
  folderId: null,
  templateId: null,
  projectId: null,
  nextNote: null,
  tabs: [
    { id: "nb1", label: "Oct 6", meeting: "Weekly sync", isNote: true },
    { id: "p2", label: "Oct 13", meeting: "Weekly sync", isNote: true },
    { id: "p3", label: "Agenda", meeting: null, isNote: false },
  ],
};

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ url: string; body: unknown }>;

function tick() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(element: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(ToastProvider, null, createElement(DialogProvider, null, element())),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
  await tick();
}

const rail = (overrides: Partial<NotebookView> = {}) =>
  mount(() => createElement(NotebookRail, { notebook: { ...notebook, ...overrides }, currentId: "nb1" }));

const nav = () => container.querySelector("nav") as HTMLElement;
const byLabel = (label: string) => document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await tick();
}

async function menuItem(trigger: string, item: string) {
  const button =
    byLabel(trigger) ?? [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === trigger);
  await click(button!);
  const found = [...document.body.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.includes(item));
  expect(found).toBeTruthy();
  await click(found!);
}

function type(input: HTMLInputElement, value: string) {
  return act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(el: Element, k: string) {
  return act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.startsWith("/api/page-templates")) return new Response(JSON.stringify({ templates: [] }));
      if (url.startsWith("/api/notebooks")) return new Response(JSON.stringify({ notebooks: [] }));
      return new Response(JSON.stringify({ results: [] }));
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("NotebookRail dialogs", () => {
  it("renders Add an existing document outside the sticky nav", async () => {
    await rail();
    await menuItem("Add", "Existing document");
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Add an existing document");
    expect(nav().contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("renders Notebook template outside the sticky nav", async () => {
    await rail();
    await menuItem("Notebook options", "Set template");
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Notebook template");
    expect(nav().contains(dialog)).toBe(false);
  });

  it("renders Merge into outside the sticky nav", async () => {
    await rail();
    await menuItem("Notebook options", "Merge into");
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Merge into");
    expect(nav().contains(dialog)).toBe(false);
  });

  it("renders the notebook picker in the document body, not where it is mounted", async () => {
    await mount(() => createElement(NotebookPicker, { open: true, onClose: () => {}, onPick: () => {} }));
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
  });
});

describe("NotebookRail title", () => {
  const input = () => byLabel("Notebook title") as HTMLInputElement;

  it("is a text field without a native tooltip or a button", async () => {
    await rail();
    expect(input().tagName).toBe("INPUT");
    expect(input().value).toBe("Weekly sync");
    expect(input().hasAttribute("title")).toBe(false);
    expect(input().className).toContain("cursor-text");
    expect(input().className).toContain("bg-transparent");
    expect(container.querySelector('button[title]')).toBeNull();
  });

  it("renames on Enter", async () => {
    await rail();
    await type(input(), "  Standup  ");
    input().focus();
    await key(input(), "Enter");
    await tick();
    expect(posts).toEqual([{ url: "/api/documents/nb1", body: { title: "Standup" } }]);
  });

  it("renames on blur", async () => {
    await rail();
    input().focus();
    await type(input(), "Standup");
    await act(async () => input().blur());
    await tick();
    expect(posts).toEqual([{ url: "/api/documents/nb1", body: { title: "Standup" } }]);
  });

  it("reverts on Escape without sending", async () => {
    await rail();
    input().focus();
    await type(input(), "Standup");
    await key(input(), "Escape");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(posts).toEqual([]);
    expect(input().value).toBe("Weekly sync");
  });

  it("reverts an empty value without sending", async () => {
    await rail();
    input().focus();
    await type(input(), "   ");
    await act(async () => input().blur());
    await tick();
    expect(posts).toEqual([]);
    expect(input().value).toBe("Weekly sync");
  });

  it("does not send an unchanged title", async () => {
    await rail();
    input().focus();
    await act(async () => input().blur());
    await tick();
    expect(posts).toEqual([]);
  });

  it("shows read-only viewers plain text", async () => {
    await rail({ canEdit: false });
    expect(byLabel("Notebook title")).toBeNull();
    expect(nav().querySelector("p")?.textContent).toBe("Weekly sync");
  });
});

describe("NotebookRail collapse", () => {
  const strip = () => container.querySelector('[data-testid="notebook-rail-strip"]');

  it("starts expanded with a Hide tabs button and no strip", async () => {
    await rail();
    expect(strip()).toBeNull();
    expect(byLabel("Hide tabs")).toBeTruthy();
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
  });

  it("only offers Hide tabs at lg and up", async () => {
    await rail();
    expect(byLabel("Hide tabs")!.className).toContain("hidden");
    expect(byLabel("Hide tabs")!.className).toContain("lg:inline-flex");
  });

  it("collapses to the strip and remembers it", async () => {
    await rail();
    await click(byLabel("Hide tabs")!);
    expect(strip()).toBeTruthy();
    expect(window.localStorage.getItem("dali:notebook-rail:collapsed")).toBe("1");
  });

  it("expands again and clears the key", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    await click(byLabel("Show tabs")!);
    expect(strip()).toBeNull();
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
  });

  it("renders the strip on first load when the key is 1, with the tab count", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    expect(strip()).toBeTruthy();
    expect(container.querySelector('[data-testid="notebook-rail-count"]')?.textContent).toBe("3");
  });

  it("expands when the glyph or count is clicked", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    await click(byLabel("Show 3 tabs")!);
    expect(strip()).toBeNull();
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
  });

  it("ignores any other stored value", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "0");
    await rail();
    expect(strip()).toBeNull();
  });

  it("keeps the tabs in the document below lg, hiding them only at lg and up", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    const list = nav().querySelector("ul")!;
    expect(list.querySelectorAll("a")).toHaveLength(3);
    const wrapper = list.parentElement!;
    expect(wrapper.className).toContain("contents");
    expect(wrapper.className).toContain("lg:hidden");
    expect(wrapper.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(strip()!.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(strip()!.className).toContain("lg:flex");
  });
});
