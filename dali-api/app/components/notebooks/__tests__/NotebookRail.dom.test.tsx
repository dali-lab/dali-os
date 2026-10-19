// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Outlet, createRoutesStub } from "react-router";
import { NotebookRail, NoteLocationLine, type NotebookView } from "~/components/notebooks/NotebookRail";
import { NotebookPicker } from "~/components/notebooks/NotebookPicker";
import { NOTEBOOK_RAIL_COLLAPSED_KEY } from "~/components/notebooks/use-rail-collapsed";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notebook: NotebookView = {
  id: "nb1",
  title: "Weekly sync",
  canEdit: true,
  canManage: true,
  workspaceType: "Lab",
  workspaceId: null,
  folderId: null,
  templateId: null,
  projectId: null,
  nextNotes: [],
  tabs: [
    { id: "nb1", label: "Oct 6", meeting: "Weekly sync", isNote: true },
    { id: "p2", label: "Oct 13", meeting: "Weekly sync", isNote: true },
    { id: "p3", label: "Agenda", meeting: null, isNote: false },
  ],
};

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ url: string; body: unknown }>;
let calendarPosts: Array<Record<string, unknown>>;

function tick() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(element: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([
    {
      Component: () => createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(Outlet))),
      children: [
        { path: "/", Component: () => element() },
        { path: "/documents/:id", Component: () => createElement("p", null, "opened") },
        {
          path: "/calendar",
          action: async ({ request }) => {
            calendarPosts.push(Object.fromEntries(await request.formData()));
            return { notePageId: null };
          },
        },
      ],
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
  calendarPosts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        posts.push({ url, body });
        return new Response(JSON.stringify(body.intent === "new-note" ? { ok: true, id: "note9" } : { ok: true }));
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
    await rail({ canEdit: false, canManage: false });
    expect(byLabel("Notebook title")).toBeNull();
    expect(nav().querySelector("p")?.textContent).toBe("Weekly sync");
  });
});

describe("NotebookRail manage authority", () => {
  const openMenu = async (label: string) => {
    const button =
      byLabel(label) ?? [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    await click(button!);
    return [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());
  };

  it("lets an editor who cannot manage add but not restructure", async () => {
    await rail({ canManage: false });
    expect(byLabel("Notebook options")).toBeNull();
    expect(byLabel("Options for Oct 6")).toBeNull();
    expect(byLabel("Notebook title")).toBeNull();
    expect(nav().querySelector("p")?.textContent).toBe("Weekly sync");
    expect(await openMenu("Add")).toContain("Existing document…");
  });

  it("shows every structure item to a manager", async () => {
    await rail();
    expect(await openMenu("Notebook options")).toEqual(["Set template…", "Merge into…", "Dissolve", "Move to Trash"]);
    expect(byLabel("Notebook title")).toBeTruthy();
    expect(await openMenu("Options for Oct 6")).toEqual(
      expect.arrayContaining(["Detach from meeting", "Remove from notebook"]),
    );
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
    await click(byLabel("Show 3 tabs")!);
    expect(strip()).toBeNull();
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBeNull();
  });

  it("renders the strip on first load when the key is 1, with the tab count", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    expect(strip()).toBeTruthy();
    expect(container.querySelector('[data-testid="notebook-rail-count"]')?.textContent).toBe("3");
  });

  it("collapses to one flat pill holding the list glyph and the count, with no card around it", async () => {
    window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
    await rail();
    const pill = byLabel("Show 3 tabs")!;
    expect(pill.className).toContain("rounded-full");
    expect(pill.querySelector("svg.lucide-list")).toBeTruthy();
    expect(pill.querySelector('[data-testid="notebook-rail-count"]')?.textContent).toBe("3");
    expect(strip()!.querySelectorAll("button")).toHaveLength(1);
    // One surface: nothing inside the pill paints its own background.
    for (const el of pill.querySelectorAll("*")) expect(el.className.toString()).not.toMatch(/\bbg-/);
    expect(nav().className).toContain("lg:bg-transparent");
    expect(nav().className).toContain("lg:border-0");
  });

  it("keeps the card while expanded", async () => {
    await rail();
    expect(nav().className).not.toContain("lg:bg-transparent");
    expect(nav().className).toContain("bg-os-card");
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

describe("NotebookRail tab list", () => {
  const items = () => [...nav().querySelectorAll("li")];
  const linkOf = (li: Element) => li.querySelector("a")!;

  it("draws every tab as a pill with a document glyph, the open one filled and tinted", async () => {
    await rail();
    const [open, ...rest] = items();
    expect(linkOf(open).getAttribute("aria-current")).toBe("page");
    expect(open.className).toContain("rounded-full");
    expect(open.className).toContain("bg-os-accent/15");
    expect(linkOf(open).className).toContain("text-os-accent");
    expect(linkOf(open).querySelector("svg.lucide-file-text")).toBeTruthy();
    for (const li of rest) {
      expect(li.className).not.toContain("bg-os-accent/15");
      expect(linkOf(li).getAttribute("aria-current")).toBeNull();
      expect(linkOf(li).querySelector("svg.lucide-file-text")).toBeTruthy();
    }
  });

  it("keeps the meeting name under a note's label", async () => {
    await rail();
    expect(items()[0].textContent).toContain("Oct 6");
    expect(items()[0].textContent).toContain("Weekly sync");
    expect(items()[2].textContent).toBe("Agenda");
  });

  it("keeps the open tab's ⋮ visible and reveals the others on hover", async () => {
    await rail();
    const open = byLabel("Options for Oct 6")!;
    const other = byLabel("Options for Oct 13")!;
    expect(open.className).not.toContain("lg:opacity-0");
    expect(other.className).toContain("lg:opacity-0");
    expect(other.className).toContain("lg:group-hover:opacity-100");
    expect(open.querySelector("svg.lucide-ellipsis-vertical")).toBeTruthy();
  });

  it("puts the title, a plus and the options on one header row", async () => {
    await rail();
    const header = nav().querySelector("input[aria-label='Notebook title']")!.parentElement!;
    const add = [...header.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add")!;
    expect(add.querySelector("svg.lucide-plus")).toBeTruthy();
    expect(add.querySelector(".sr-only")?.textContent).toBe("Add");
    expect(header.querySelector("[aria-label='Notebook options']")).toBeTruthy();
    expect(header.querySelector("[aria-label='Hide tabs']")).toBeTruthy();
  });
});

describe("NotebookRail Move to notebook", () => {
  const openMenu = async (label: string) => {
    await click(byLabel(label)!);
    return [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());
  };
  const picker = () => document.body.querySelector('[role="dialog"]');

  beforeEach(() => {
    vi.mocked(fetch).mockImplementation((async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ ok: true }));
      }
      if (url.startsWith("/api/notebooks")) {
        return new Response(
          JSON.stringify({
            notebooks: [
              { id: "nb1", title: "Weekly sync", path: "Lab", workspaceType: "Lab", workspaceId: null, parentPageId: null, tabCount: 3, lastNoteAt: null, suggested: false },
              { id: "nb2", title: "Retro", path: "Lab", workspaceType: "Lab", workspaceId: null, parentPageId: null, tabCount: 1, lastNoteAt: null, suggested: false },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ templates: [], results: [] }));
    }) as never);
  });

  it("is offered to a manager, above Remove from notebook", async () => {
    await rail();
    const items = await openMenu("Options for Oct 6");
    expect(items).toEqual(["Rename…", "Detach from meeting", "Move to notebook…", "Remove from notebook"]);
  });

  it("is not offered to someone who cannot manage", async () => {
    await rail({ canManage: false });
    expect(byLabel("Options for Oct 6")).toBeNull();
  });

  it("opens a picker scoped to the notebook's space that leaves the current notebook out", async () => {
    await rail({ workspaceType: "Project", workspaceId: "p1" });
    await menuItem("Options for Oct 6", "Move to notebook");

    expect(picker()?.textContent).toContain("Move to notebook");
    const listing = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/notebooks"))!;
    const params = new URLSearchParams(listing.split("?")[1]);
    expect(params.get("workspaceType")).toBe("Project");
    expect(params.get("workspaceId")).toBe("p1");
    expect(picker()?.textContent).toContain("Retro");
    expect(picker()?.textContent).not.toContain("Weekly sync");
  });

  it("moves the note into the pick and says where it went", async () => {
    await rail();
    await menuItem("Options for Oct 13", "Move to notebook");
    const retro = [...picker()!.querySelectorAll("button")].find((b) => b.textContent?.includes("Retro"))!;
    await click(retro);

    expect(posts).toEqual([{ url: "/api/notebooks/nb2", body: { intent: "add-page", pageId: "p2" } }]);
    expect(document.body.textContent).toContain("Moved to Retro");
    expect(picker()).toBeNull();
  });
});

describe("NotebookRail Rename", () => {
  const promptInput = () => document.body.querySelector('[role="dialog"] input') as HTMLInputElement;
  const confirmButton = () =>
    [...document.body.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Rename")!;

  beforeEach(() => {
    vi.mocked(fetch).mockImplementation((async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push({ url, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ ok: true }));
    }) as never);
  });

  it("is offered on plain documents too, not just meeting notes", async () => {
    await rail();
    await click(byLabel("Options for Agenda")!);
    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());
    expect(items[0]).toBe("Rename…");
  });

  it("prefills the current label and saves the trimmed title to that tab", async () => {
    await rail();
    await menuItem("Options for Oct 13", "Rename");
    expect(promptInput().value).toBe("Oct 13");

    await type(promptInput(), "  Kickoff  ");
    await click(confirmButton());

    expect(posts).toEqual([{ url: "/api/documents/p2", body: { title: "Kickoff" } }]);
  });

  it("sends nothing when the title is unchanged", async () => {
    await rail();
    await menuItem("Options for Oct 13", "Rename");
    await click(confirmButton());
    expect(posts).toEqual([]);
  });

  it("sends nothing when cancelled", async () => {
    await rail();
    await menuItem("Options for Oct 13", "Rename");
    await type(promptInput(), "Kickoff");
    await click([...document.body.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Cancel")!);
    expect(posts).toEqual([]);
  });

  it("will not save a blank title", async () => {
    await rail();
    await menuItem("Options for Oct 13", "Rename");
    await type(promptInput(), "   ");
    await click(confirmButton());
    expect(posts).toEqual([]);
    expect(document.body.textContent).toContain("Enter a title.");
  });
});

describe("NotebookRail blank note", () => {
  const addItems = async () => {
    await click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add")!);
    return [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim());
  };

  it("is the first item of the Add menu, even for a notebook with no series", async () => {
    await rail();
    expect(await addItems()).toEqual(["Blank note", "Existing document…"]);
  });

  it("is listed before the next-meeting notes", async () => {
    await rail({
      nextNotes: [{ meetingId: "m1", meetingTitle: "Weekly sync", occurrenceStart: "2026-10-21T15:00:00.000Z" }],
    });
    expect((await addItems())[0]).toBe("Blank note");
  });

  it("is offered to an editor who cannot manage", async () => {
    await rail({ canManage: false });
    expect(await addItems()).toContain("Blank note");
  });

  it("is not offered to someone who cannot edit", async () => {
    await rail({ canEdit: false });
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Add")).toBe(false);
  });

  it("posts the new-note intent and opens the note it made", async () => {
    await rail();
    await menuItem("Add", "Blank note");

    expect(posts).toEqual([{ url: "/api/notebooks/nb1", body: { intent: "new-note" } }]);
    expect(container.textContent).toContain("opened");
  });
});

describe("NotebookRail next notes", () => {
  const noteItems = async () => {
    await click([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add")!);
    return [...document.body.querySelectorAll('[role="menuitem"]')].filter((el) => el.textContent?.includes("Note for"));
  };

  it("shows nothing for a notebook with no series to continue", async () => {
    await rail();
    expect(await noteItems()).toHaveLength(0);
  });

  it("keeps the single item for one target and posts its occurrence", async () => {
    await rail({ nextNotes: [{ meetingId: "m1", meetingTitle: "Weekly sync", occurrenceStart: "2026-10-21T15:00:00.000Z" }] });
    const items = await noteItems();
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Note for the next meeting"]);

    await click(items[0]);
    expect(calendarPosts).toEqual([
      { intent: "add-meeting-note", meetingId: "m1", occurrence: "2026-10-21T15:00:00.000Z" },
    ]);
  });

  it("lists one labelled item per series, each posting its own meeting and occurrence", async () => {
    await rail({
      nextNotes: [
        { meetingId: "m1", meetingTitle: "Weekly sync", occurrenceStart: "2026-10-21T15:00:00.000Z" },
        { meetingId: "m2", meetingTitle: "Retro", occurrenceStart: "2026-10-23T15:00:00.000Z" },
      ],
    });

    const items = await noteItems();
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      "Note for Weekly sync · Oct 21, 2026",
      "Note for Retro · Oct 23, 2026",
    ]);

    await click(items[1]);
    expect(calendarPosts).toEqual([
      { intent: "add-meeting-note", meetingId: "m2", occurrence: "2026-10-23T15:00:00.000Z" },
    ]);
  });
});

describe("NoteLocationLine", () => {
  const line = (over: Partial<Parameters<typeof NoteLocationLine>[0]> = {}) =>
    mount(() =>
      createElement(NoteLocationLine, {
        notebook,
        editViaMeeting: false,
        showControls: true,
        ...over,
      }),
    );
  const el = () => container.querySelector('[data-testid="note-location"]');

  it("carries no trail of its own: the shell's breadcrumb row names the note's place", async () => {
    await line();
    expect(el()!.querySelector("a")).toBeNull();
    expect(el()!.textContent).not.toContain("Weekly sync");
  });

  it("explains an edit that comes from the meeting", async () => {
    await line({ editViaMeeting: true });
    expect(byLabel("More information")).toBeTruthy();
  });

  it("says nothing extra for an edit that comes from base access", async () => {
    await line();
    expect(byLabel("More information")).toBeNull();
  });

  it("carries the Add menu only when it stands in for the hidden rail", async () => {
    await line();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Add")).toBe(true);
    act(() => root.unmount());
    container.remove();
    await line({ showControls: false });
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Add")).toBe(false);
  });

  it("renders nothing when there is neither a tip nor a menu to show", async () => {
    await line({ showControls: false });
    expect(el()).toBeNull();
    act(() => root.unmount());
    container.remove();
    await line({ notebook: { ...notebook, canEdit: false } });
    expect(el()).toBeNull();
  });
});
