// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { FolderSettingsModal } from "~/components/drive/FolderSettingsModal";
import type { MeetingsOption } from "~/components/drive/receiver-options";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const core: MeetingsOption = { slot: { processType: "Core", processId: null, folderType: "Meetings" }, space: "Core" };
const project: MeetingsOption = {
  slot: { processType: "Project", processId: "p1", folderType: "Meetings" },
  space: "Atlas",
};
const lab: MeetingsOption = { slot: { processType: "Lab", processId: null, folderType: "Meetings" }, space: "General" };

const folder = { id: "f1", title: "Notes" };
const holding = (id: string | null) => ({
  slots: [
    {
      folderType: "Meetings",
      label: "Meeting notebooks",
      folder: id ? { id, title: id, path: [{ id: "core", title: "Core" }, { id, title: id }] } : null,
    },
  ],
});

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onClose.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function respond(slots: unknown, post: { ok: boolean; error?: string } = { ok: true }) {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? { ok: post.ok, json: () => Promise.resolve(post.ok ? {} : { error: post.error }) }
        : { ok: true, json: () => Promise.resolve(slots) },
    ),
  );
}

async function mount(meetings: MeetingsOption) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(ToastProvider, null, createElement(FolderSettingsModal, { open: true, onClose, folder, meetings })),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const save = () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Save")!;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));

describe("FolderSettingsModal", () => {
  it.each([
    [lab, "New meeting notebooks for General file here"],
    [core, "New meeting notebooks for Core file here"],
    [project, "New meeting notebooks for Atlas file here"],
  ])("offers one checkbox naming the space", async (meetings, label) => {
    respond(holding(null));
    await mount(meetings);
    expect(document.body.textContent).toContain(label);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(document.querySelector("select, [role=combobox]")).toBeNull();
  });

  it("never says receiver", async () => {
    respond(holding(null));
    await mount(core);
    expect(document.body.textContent?.toLowerCase()).not.toContain("receive");
  });

  it("loads the holder of the space's slot", async () => {
    respond(holding(null));
    await mount(project);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/folder-receivers?processType=Project&processId=p1");
  });

  it("is checked when this folder already receives, and saving is off until something changes", async () => {
    respond(holding("f1"));
    await mount(core);
    expect(checkbox().checked).toBe(true);
    expect(save().disabled).toBe(true);
  });

  it("is unchecked when nothing or another folder holds the slot", async () => {
    respond(holding("other"));
    await mount(core);
    expect(checkbox().checked).toBe(false);
  });

  it("sets the slot to this folder when checked", async () => {
    respond(holding(null));
    await mount(project);
    await click(checkbox());
    await click(save());
    expect(posts()).toEqual([
      { intent: "set", processType: "Project", processId: "p1", folderType: "Meetings", folderId: "f1" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the slot when unchecked", async () => {
    respond(holding("f1"));
    await mount(lab);
    await click(checkbox());
    await click(save());
    expect(posts()).toEqual([{ intent: "clear", processType: "Lab", folderType: "Meetings" }]);
  });

  it("warns that checking moves filing off the folder that holds it now", async () => {
    respond(holding("other"));
    await mount(core);
    expect(document.querySelector('[data-testid="receiver-current"]')).toBeNull();
    await click(checkbox());
    expect(document.querySelector('[data-testid="receiver-current"]')!.textContent).toContain("Core / other");
  });

  it("stays open when the write fails", async () => {
    respond(holding(null), { ok: false, error: "No access" });
    await mount(core);
    await click(checkbox());
    await click(save());
    expect(onClose).not.toHaveBeenCalled();
  });
});
