// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

vi.mock("~/components/doc", () => ({ DocEditor: () => null, appendBlocks: () => {}, stripBlockIds: () => {}, IMAGE_UPLOAD_ACCEPT: "image/*" }));
vi.mock("~/components/doc/comments", () => ({ DocCommentsPanel: () => null, useDocThreadCount: () => 0 }));
vi.mock("~/components/doc/find", () => ({ FindReplaceBar: () => null }));
vi.mock("~/components/drive/use-drive-destinations", () => ({
  useDriveDestinations: () => ({ rows: [] }),
}));
vi.mock("~/components/drive/use-move-page", () => ({ useMovePage: () => ({}) }));
vi.mock("~/components/drive/FolderPicker", () => ({ FolderPicker: () => null }));
vi.mock("~/components/sharing/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("~/components/collab/VersionHistoryPanel", () => ({ VersionHistoryPanel: () => createElement("div", { "data-testid": "history" }) }));

const { VERSION_HISTORY_SHORTCUT } = await import("~/lib/shortcuts");
const { DocumentEditor, FIND_SHORTCUT } = await import("~/components/DocumentEditor");
const { PageBarSlotProvider, usePageBarTargetSetters } = await import("~/components/shell/page-bar-slot");
const { OverflowMenu } = await import("~/components/shell/OverflowMenu");
const { FeatureFlagsProvider } = await import("~/components/FeatureFlags");
const { ToastProvider } = await import("~/components/ui/toast");
const { DialogProvider } = await import("~/components/ui/dialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);

let container: HTMLDivElement;
let root: Root;

function Header() {
  const { actionsRef } = usePageBarTargetSetters();
  return (
    <header>
      <div data-testid="actions" ref={actionsRef} />
      <OverflowMenu />
    </header>
  );
}

async function mount(chrome: "pageBar" | "panel" | "inline", extra: Record<string, unknown> = {}) {
  const editor = createElement(DocumentEditor, {
    pageId: "p1",
    initialTitle: "Notes",
    collabToken: null,
    userName: "Ada",
    currentUserId: "u1",
    canEdit: true,
    canComment: true,
    canManageAccess: true,
    workspaceType: "Member",
    tags: [],
    allTags: [],
    updatedAt: new Date().toISOString(),
    chrome,
    ...extra,
  } as never);
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(DialogProvider, null, createElement(FeatureFlagsProvider, {
            flags: {},
            children: createElement(PageBarSlotProvider, { children: createElement("div", null, createElement(Header), editor as ReactNode) }),
          })),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/documents/p1"] }));
  });
}

const actions = () => [...container.querySelectorAll<HTMLElement>("[data-testid=actions] button")].map((b) => b.getAttribute("aria-label"));
const openMenu = () =>
  act(async () => {
    container.querySelector<HTMLElement>("[aria-label='More actions']")!.click();
  });
const items = () => [...document.body.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe.each(["pageBar", "panel"] as const)("DocumentEditor in the %s", (chrome) => {
  it("keeps Share as a button and has no Download or own more button", async () => {
    await mount(chrome);
    expect(actions()).toEqual(["Share"]);
    expect(container.querySelector("[aria-label='Download']")).toBeNull();
    expect(container.querySelector("[aria-label='More options']")).toBeNull();
    expect(container.querySelectorAll("[aria-label='More actions']")).toHaveLength(1);
  });

  it("offers Download as menu items and shows the find shortcut", async () => {
    await mount(chrome);
    await openMenu();
    const labels = items();
    expect(labels).toEqual(expect.arrayContaining(["Download PDF", "Download Word", "Download Markdown", "Duplicate"]));
    expect(labels.find((l) => l?.startsWith("Find"))).toContain(FIND_SHORTCUT);
  });
});

describe("DocumentEditor panel", () => {
  it("renders flat with no sticky toolbar of its own", async () => {
    await mount("panel");
    expect(container.querySelector(".doc-topbar")).toBeNull();
    expect(container.querySelector(".doc-canvas")!.className).not.toContain("bg-card");
    expect(container.querySelector(".sticky")).toBeNull();
  });
});

describe("DocumentEditor inline", () => {
  it("keeps its own toolbar with Download and More options buttons", async () => {
    await mount("inline");
    expect(container.querySelector(".doc-topbar")).not.toBeNull();
    expect(container.querySelector("[aria-label='Download']")).not.toBeNull();
    expect(container.querySelector("[aria-label='More options']")).not.toBeNull();
  });
});

describe("DocumentEditor save status", () => {
  const status = () => container.querySelector("[data-testid=doc-sync-status]");

  it.each(["pageBar", "panel"] as const)("is icon-only in the %s with the words in a tooltip", async (chrome) => {
    await mount(chrome, { collabToken: "t" });
    const el = status();
    if (!el) return;
    expect(el.className).not.toContain("inline-grid");
    expect(el.querySelector("[class*='grid-area']")).toBeNull();
    expect(el.querySelector(":scope > span.sr-only")).not.toBeNull();
    await act(async () => {
      el.dispatchEvent(new FocusEvent("focus"));
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toMatch(/Saving…|Saved|Offline/);
  });

  it("keeps the stacked labels inline", async () => {
    await mount("inline", { collabToken: "t" });
    const el = status();
    if (!el) return;
    expect(el.className).toContain("inline-grid");
  });
});

describe.each(["pageBar", "panel"] as const)("Version history shortcut in the %s", (chrome) => {
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };
  const combo = { key: "˙", code: "KeyH", metaKey: true, altKey: true, shiftKey: true };

  it("opens on the combo only", async () => {
    await mount(chrome, { collabToken: "t" });
    press({ ...combo, shiftKey: false });
    press({ ...combo, altKey: false });
    press({ ...combo, metaKey: false });
    expect(document.querySelector("[data-testid=history]")).toBeNull();
    expect(press(combo).defaultPrevented).toBe(true);
    expect(document.querySelector("[data-testid=history]")).not.toBeNull();
  });

  it("skips an event another handler already claimed", async () => {
    await mount(chrome, { collabToken: "t" });
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", claim, true);
    press(combo);
    window.removeEventListener("keydown", claim, true);
    expect(document.querySelector("[data-testid=history]")).toBeNull();
  });

  it("hints the shortcut on the menu item", async () => {
    await mount(chrome, { collabToken: "t" });
    await openMenu();
    expect(items().find((l) => l?.startsWith("Version history"))).toContain(VERSION_HISTORY_SHORTCUT);
  });
});
