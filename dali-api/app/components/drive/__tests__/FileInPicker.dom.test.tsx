// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileInPicker } from "~/components/drive/FileInPicker";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const destinations = {
  drives: [
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
  ],
  folders: [
    { id: "ops", driveId: "lab", parentId: null, title: "Ops" },
    { id: "design", driveId: "lab", parentId: null, title: "Design" },
    { id: "checkins", driveId: "core", parentId: null, title: "Check-ins" },
  ],
};

const placements = {
  ok: true,
  primary: { workspaceType: "Lab", workspaceId: null, folderId: "ops", path: [{ id: "ops", title: "Ops" }] },
  shortcuts: [
    {
      shortcutId: "s1",
      workspaceType: "Lab",
      workspaceId: null,
      folderId: "checkins",
      path: [{ id: "checkins", title: "Check-ins" }],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let posts: Array<{ url: string; body: unknown }>;
let placeReply: Response;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.clear();
  posts = [];
  placeReply = new Response(JSON.stringify({ ok: true, declined: 1 }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/drive/destinations") return new Response(JSON.stringify(destinations));
      if (url === "/api/pages/p1/shortcuts") return new Response(JSON.stringify(placements));
      posts.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return url.endsWith("/place") ? placeReply : new Response(JSON.stringify({ ok: true, created: true, grantDeclined: false }));
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(mode: "multi" | "single") {
  const onClose = vi.fn();
  const onDone = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(
          ToastProvider,
          null,
          createElement(FileInPicker, {
            target: { id: "p1", title: "Kickoff", isFolder: false },
            mode,
            onClose,
            onDone,
          }),
        ),
      ),
    );
  });
  await act(async () => {});
  return { onClose, onDone };
}

function search(text: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const optionNamed = (name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.includes(name))!;

const chips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="picker-chip"]'));
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;

describe("FileInPicker multi", () => {
  it("opens with the current location as primary and each existing shortcut locked", async () => {
    await mount("multi");
    expect(chips().map((c) => c.textContent)).toEqual([
      expect.stringContaining("Lab / Ops"),
      expect.stringContaining("Core / Check-ins"),
    ]);
    expect(chips()[0].textContent).toContain("Primary");
    expect(chips()[1].textContent).toContain("Shortcut");
    expect(document.querySelector('button[aria-label="Remove Core / Check-ins"]')).toBeNull();
  });

  it("does nothing when nothing changed", async () => {
    const { onClose, onDone } = await mount("multi");
    await act(async () => buttonByText("File").click());
    expect(posts).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("posts only the new locations, then reports the toast with the declined count", async () => {
    const { onClose, onDone } = await mount("multi");
    await search("Design");
    await act(async () => {
      optionNamed("Design").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await act(async () => buttonByText("File").click());

    expect(posts).toEqual([
      {
        url: "/api/pages/p1/place",
        body: {
          destinations: [
            { workspaceType: "Lab", workspaceId: null, parentPageId: "ops" },
            { workspaceType: "Lab", workspaceId: null, parentPageId: "design" },
          ],
          primaryIndex: 0,
        },
      },
    ]);
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 location added. Primary: Lab / Ops. 1 could not be shared; ask the owner.");
  });

  it("keeps the picker open and says why when the server refuses", async () => {
    placeReply = new Response(JSON.stringify({ error: "You can't put things in that folder" }), { status: 403 });
    const { onClose } = await mount("multi");
    await search("Design");
    await act(async () => {
      optionNamed("Design").querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await act(async () => buttonByText("File").click());
    expect(document.body.textContent).toContain("You can't put things in that folder");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("FileInPicker single", () => {
  it("adds one shortcut, naming the action in the picker", async () => {
    const { onClose, onDone } = await mount("single");
    expect(document.body.textContent).toContain('Add shortcut to "Ops"');
    await search("Design");
    await act(async () => optionNamed("Design").click());
    expect(document.body.textContent).toContain("Add to: Lab / Design");
    await act(async () => buttonByText("Add shortcut").click());
    expect(posts).toEqual([
      {
        url: "/api/shortcuts",
        body: { targetPageId: "p1", dest: { workspaceType: "Lab", workspaceId: null, parentPageId: "design" } },
      },
    ]);
    expect(onDone).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("won't put a shortcut next to the original", async () => {
    await mount("single");
    await search("Ops");
    expect(optionNamed("Ops").getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("Lab / Ops");
  });
});
