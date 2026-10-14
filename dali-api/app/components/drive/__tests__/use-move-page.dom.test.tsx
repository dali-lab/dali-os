// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import { useMovePage } from "~/components/drive/use-move-page";
import type { PickerRows } from "~/components/drive/picker-rows";
import { renderHook } from "./render-hook";

const rows: PickerRows = {
  drives: [
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
    { id: "projects", label: "Projects" },
  ],
  folders: [
    { id: "ops", driveId: "lab", parentId: null, title: "Ops" },
    { id: "design", driveId: "lab", parentId: null, title: "Design" },
    { id: "meetings", driveId: "core", parentId: null, title: "Meetings" },
    { id: "atlas", driveId: "projects", parentId: null, title: "Atlas" },
    { id: "atlas-docs", driveId: "projects", parentId: "atlas", title: "Docs" },
  ],
};

const wrapper = (children: ReactNode) => createElement(DialogProvider, null, createElement(ToastProvider, null, children));
const reply = (body: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status });

let calls: Array<{ url: string; method: string; body: unknown }>;
let moveReply: Response;
const unmounts: Array<() => void> = [];

beforeEach(() => {
  calls = [];
  moveReply = reply({ ok: true, from: { workspaceType: "Lab", workspaceId: null, parentPageId: "ops" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null });
      return moveReply.clone();
    }),
  );
});
afterEach(() => {
  unmounts.splice(0).forEach((u) => u());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function mount(current = { type: "Lab", id: null as string | null }) {
  const onMoved = vi.fn();
  const hook = renderHook(
    () => useMovePage({ pageId: "p1", title: "Kickoff", current, rows, onMoved }),
    { initialProps: undefined, wrapper },
  );
  unmounts.push(hook.unmount);
  return { hook, onMoved };
}

const text = () => document.body.textContent ?? "";
const undoButton = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Undo");

describe("useMovePage", () => {
  it("names the page and the full destination path in the toast", async () => {
    const { hook, onMoved } = mount({ type: "Project", id: "atlas" });
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "projects", folderId: "atlas-docs" }));
    expect(text()).toContain("Moved “Kickoff” to Projects ▸ Atlas ▸ Docs");
    expect(onMoved).toHaveBeenCalledTimes(1);
  });

  it("makes a single request to move the page", async () => {
    const { hook } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "ops" }));
    expect(calls.map((c) => c.url)).toEqual(["/api/pages/p1/move"]);
  });

  it("offers an Undo that moves the page back to where it was", async () => {
    const { hook, onMoved } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    calls.length = 0;
    await act(async () => undoButton()!.click());
    expect(calls).toEqual([
      { url: "/api/pages/p1/move", method: "POST", body: { parentPageId: "ops", workspaceType: "Lab", workspaceId: null } },
    ]);
    expect(text()).toContain("Move undone");
    expect(onMoved).toHaveBeenCalledTimes(2);
  });

  it("the undone toast carries no Undo of its own", async () => {
    const { hook } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    await act(async () => undoButton()!.click());
    expect(undoButton()).toBeUndefined();
  });

  it("says why when the page can't be moved back", async () => {
    const { hook } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    moveReply = reply({ error: "Not allowed" }, 403);
    await act(async () => undoButton()!.click());
    expect(text()).toContain("Not allowed");
  });

  it("moves without an Undo when the server did not say where the page was", async () => {
    moveReply = reply({ ok: true });
    const { hook, onMoved } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    expect(text()).toContain("Moved “Kickoff” to Lab ▸ Design");
    expect(undoButton()).toBeUndefined();
    expect(onMoved).toHaveBeenCalledTimes(1);
  });

  it("moves without an Undo when the page came out of My Drive, which cannot be a destination", async () => {
    moveReply = reply({ ok: true, from: { workspaceType: "Member", workspaceId: "u1", parentPageId: null } });
    const { hook } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    expect(undoButton()).toBeUndefined();
  });

  it("shows the server's reason and keeps the picker when the move is refused", async () => {
    moveReply = reply({ error: "You can't move that there" }, 403);
    const { hook, onMoved } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "lab", folderId: "design" }));
    expect(text()).toContain("You can't move that there");
    expect(onMoved).not.toHaveBeenCalled();
    expect(undoButton()).toBeUndefined();
  });

  it("asks before moving to a place with a different audience, and moves nothing if declined", async () => {
    const { hook, onMoved } = mount();
    const pending = hook.result.current.pickerProps.onConfirm({ driveId: "core", folderId: "meetings" });
    await act(async () => {});
    expect(document.body.textContent).toContain("Move “Kickoff” to Core?");
    const cancel = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Cancel");
    await act(async () => cancel!.click());
    await act(async () => void (await pending));
    expect(calls).toEqual([]);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("asks for a project or offering when the pick is the bare Projects list", async () => {
    const { hook, onMoved } = mount();
    await act(async () => hook.result.current.pickerProps.onConfirm({ driveId: "projects", folderId: null }));
    expect(text()).toContain("Select a project or offering to move into");
    expect(calls).toEqual([]);
    expect(onMoved).not.toHaveBeenCalled();
  });
});
