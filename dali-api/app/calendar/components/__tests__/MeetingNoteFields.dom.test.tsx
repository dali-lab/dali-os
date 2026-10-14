// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PickerRows } from "~/components/drive/picker-rows";
import type { GroupOption } from "~/calendar/lib/types";
import type { PickedNotebook } from "~/components/notebooks/notebook-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows: PickerRows = {
  drives: [
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
    { id: "projects", label: "Projects" },
  ],
  folders: [
    { id: "lab-m", driveId: "lab", parentId: null, title: "Meeting assets", folderType: "Meetings" },
    { id: "core-m", driveId: "core", parentId: null, title: "Meetings", folderType: "Meetings" },
    { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
    { id: "p1-m", driveId: "projects", parentId: "p1", title: "Meetings", folderType: "Meetings" },
  ],
};

vi.mock("~/components/drive/use-drive-destinations", () => ({
  useDriveDestinations: () => ({ rows, status: "ready", load: async () => true }),
}));
vi.mock("~/components/notebooks/use-note-templates", () => ({ useNoteTemplates: () => ({ templates: [] }) }));
const notebookPickerProps = vi.fn();
vi.mock("~/components/notebooks/NotebookPicker", () => ({
  NotebookPicker: (props: Record<string, unknown>) => {
    notebookPickerProps(props);
    return null;
  },
}));
const notebookListArgs = vi.fn();
vi.mock("~/components/notebooks/use-notebook-list", () => ({
  useNotebookList: (args: Record<string, unknown>) => {
    notebookListArgs(args);
    return { rows: [], status: "ready" };
  },
}));

const pickerProps = vi.fn();
vi.mock("~/components/drive/FolderPicker", async (importActual) => {
  const actual = await importActual<typeof import("~/components/drive/FolderPicker")>();
  return {
    ...actual,
    FolderPicker: (props: Record<string, unknown>) => {
      pickerProps(props);
      return createElement("div", { "data-testid": "folder-picker" });
    },
  };
});

const { MeetingNoteFields, useMeetingNote, meetingNotePayload } = await import(
  "~/calendar/components/MeetingNoteFields"
);
type Controller = ReturnType<typeof useMeetingNote>;

const group = (over: Partial<GroupOption> & { id: string; name: string }): GroupOption => ({
  memberIds: [],
  projectId: null,
  systemKey: null,
  ...over,
});
const coreGroup = group({ id: "g-core", name: "Core", systemKey: "core", memberIds: ["a", "b", "c"] });
const atlasGroup = group({ id: "g-atlas", name: "Atlas", projectId: "p1", memberIds: ["a", "b", "c", "d"] });

let container: HTMLDivElement;
let root: Root;
let controller: Controller;

function Harness({
  surface = "create",
  prefillProject,
  suggest,
  meetingTitle = "Weekly sync",
}: {
  surface?: "create" | "note" | "whiteboard";
  prefillProject?: string;
  suggest?: { attendeeIds: string[]; groups: GroupOption[] };
  meetingTitle?: string;
}): ReactNode {
  const note = useMeetingNote();
  controller = note;
  return createElement(MeetingNoteFields, {
    note,
    surface,
    prefillProjectId: prefillProject,
    fieldClass: "",
    labelClass: "",
    meetingTitle,
    suggest,
  });
}

function mount(props: Parameters<typeof Harness>[0] = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness, props)));
}

beforeEach(() => {
  pickerProps.mockClear();
  notebookPickerProps.mockClear();
  notebookListArgs.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const checkbox = (label: string) =>
  Array.from(container.querySelectorAll("label"))
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector("input") as HTMLInputElement | undefined;
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const addNotebook = () => click(checkbox("Notebook"));
const segment = (label: string) =>
  Array.from(container.querySelectorAll("[role='radiogroup'][aria-label='Notebook'] [role='radio']")).find(
    (b) => b.textContent === label,
  );
const choose = (label: "New" | "Existing") => click(segment(label));
const chipText = () =>
  Array.from(container.querySelectorAll("[data-testid='filed-in-chip']")).map((c) => c.textContent);
const locationText = () =>
  Array.from(container.querySelectorAll("ul[aria-label='Location'] [data-testid='filed-in-chip']")).map((c) => c.textContent);
const shortcutText = () =>
  Array.from(container.querySelectorAll("ul[aria-label='Shortcuts'] [data-testid='filed-in-chip']")).map((c) => c.textContent);
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

describe("MeetingNoteFields in the create modal", () => {
  it("offers a Notebook and a Whiteboard checkbox, both unchecked, each with a description", () => {
    mount();
    expect(checkbox("Notebook")!.checked).toBe(false);
    expect(checkbox("Whiteboard")!.checked).toBe(false);
    expect(container.textContent).toContain("Shared meeting notes, one tab per meeting.");
    expect(container.textContent).toContain("A shared whiteboard, filed with the notebook.");
  });

  it("uses square default-size checkboxes, not radios or the large round ones", () => {
    mount();
    expect(container.querySelector("input[type='radio']")).toBeNull();
    expect(container.querySelectorAll(".rounded-full.h-5")).toHaveLength(0);
    expect(container.querySelectorAll("input[type='checkbox']")).toHaveLength(2);
  });

  it("drops the old Meeting assets, Notes and Filed in labels", () => {
    mount();
    addNotebook();
    const text = container.textContent!;
    for (const gone of ["Meeting assets", "Filed in", "No note", "New notebook", "Add to existing notebook", "Start a whiteboard", "About"]) {
      expect(text).not.toContain(gone);
    }
  });

  it("shows nothing about the notebook until it is checked", () => {
    mount();
    expect(container.querySelector("[role='radiogroup']")).toBeNull();
    expect(container.querySelector("#meeting-notebook-name")).toBeNull();
    expect(container.textContent).not.toContain("Location");
  });

  it("shows New and Existing, the name and the places once the notebook is checked", () => {
    mount();
    addNotebook();
    expect(Array.from(container.querySelectorAll("[role='radiogroup'] [role='radio']")).map((r) => r.textContent)).toEqual([
      "New",
      "Existing",
    ]);
    expect(segment("New")!.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("#meeting-notebook-name")).toBeTruthy();
    expect(container.textContent).toContain("Location");
    expect(container.textContent).toContain("Shortcuts");
  });

  it("indents the details under the checkbox", () => {
    mount();
    addNotebook();
    expect(container.querySelector("[role='radiogroup']")!.closest(".pl-6")).toBeTruthy();
  });

  it("offers the whiteboard without a notebook", () => {
    mount();
    click(checkbox("Whiteboard"));
    expect(controller.state).toMatchObject({ enabled: false, whiteboard: true });
    expect(container.querySelector("#meeting-notebook-name")).toBeNull();
  });

  it("seeds the invited project's Meetings receiver as the location", () => {
    mount({ prefillProject: "p1" });
    addNotebook();
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(shortcutText()).toEqual([]);
  });

  it("leaves Location empty with no invited project", () => {
    mount();
    addNotebook();
    expect(chipText()).toEqual([]);
    expect(controller.state.places).toEqual([]);
    expect(container.textContent).toContain("Goes in the default Meetings folder.");
    expect(container.textContent).toContain("No shortcuts. Add places where this notebook should also appear.");
  });

  it("stops following the invited project once the organizer removes the row", () => {
    mount({ prefillProject: "p1" });
    addNotebook();
    click(container.querySelector("button[aria-label='Remove Projects / Atlas / Meetings']"));
    expect(chipText()).toEqual([]);
    expect(controller.state.placesTouched).toBe(true);
  });

  it("keeps the whiteboard when the notebook is unchecked", () => {
    mount();
    addNotebook();
    act(() => controller.setWhiteboard(true));
    addNotebook();
    expect(controller.state.whiteboard).toBe(true);
    expect(controller.state.enabled).toBe(false);
  });

  it("derives the project from the location", () => {
    mount({ prefillProject: "p1" });
    addNotebook();
    expect(meetingNotePayload(controller.state)).toMatchObject({ projectId: "p1" });
  });

  it("sends the project and the notebook name, not the places", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(shortcutText()).toEqual(["Core / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      note: true,
      projectId: "p1",
      notebook: { title: "Weekly sync" },
    });
    expect(meetingNotePayload(controller.state).notebook).not.toHaveProperty("location");
    expect(meetingNotePayload(controller.state).notebook).not.toHaveProperty("links");
  });

  it("makes a shortcut the location with Make location", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    click(container.querySelector("ul[aria-label='Shortcuts'] button[aria-label='Make location']"));
    expect(locationText()).toEqual(["Core / Meetings"]);
    expect(shortcutText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(controller.state.placesTouched).toBe(true);
  });

  it("reorders places through the controller, the top one being the location", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    act(() => controller.reorderPlaces(1, 0));
    expect(locationText()).toEqual(["Core / Meetings"]);
    expect(shortcutText()).toEqual(["Projects / Atlas / Meetings"]);
  });

  it("gives each row a keyboard-reachable drag handle", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    const handles = Array.from(container.querySelectorAll("button[aria-label^='Reorder ']"));
    expect(handles.map((h) => h.getAttribute("aria-label"))).toEqual([
      "Reorder Projects / Atlas / Meetings",
      "Reorder Core / Meetings",
    ]);
  });

  it("opens the multi picker seeded with the current places, location first", () => {
    mount({ prefillProject: "p1" });
    addNotebook();
    click(button("Add a place"));
    const props = pickerProps.mock.lastCall![0];
    expect(props).toMatchObject({
      mode: "multi",
      heading: "File the notebook in",
      preferFolderType: "Meetings",
      initialDestinations: [{ driveId: "projects", folderId: "p1-m" }],
    });
    expect(props.drives.map((d: { id: string }) => d.id)).toEqual(["lab", "core", "projects"]);
  });

  it("takes the picker's result as the new places", () => {
    mount({ prefillProject: "p1" });
    addNotebook();
    click(button("Add a place"));
    const { onConfirm } = pickerProps.mock.lastCall![0];
    act(() =>
      onConfirm({
        destinations: [
          { driveId: "projects", folderId: "p1-m" },
          { driveId: "core", folderId: "core-m" },
          { driveId: "lab", folderId: "lab-m" },
        ],
        primaryIndex: 2,
      }),
    );
    expect(locationText()).toEqual(["Lab / Meeting assets"]);
    expect(shortcutText()).toEqual(["Projects / Atlas / Meetings", "Core / Meetings"]);
    expect(container.querySelector("[data-testid='folder-picker']")).toBeNull();
  });

  it("switches to Existing with the places held as shortcuts until a notebook is picked", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    choose("Existing");
    expect(controller.state.notebookMode).toBe("existing");
    expect(locationText()).toEqual([]);
    click(button("Suggested: Core"));
    expect(shortcutText()).toEqual(["Core / Meetings"]);
    expect(container.querySelector("button[aria-label='Make location']")).toBeNull();
  });

  it("opens the notebook picker when Existing is chosen with none picked", () => {
    mount();
    addNotebook();
    choose("Existing");
    expect(notebookPickerProps.mock.lastCall![0]).toMatchObject({ open: true });
  });

  it("does not open the notebook picker for New", () => {
    mount();
    addNotebook();
    expect(notebookPickerProps).not.toHaveBeenCalled();
  });
});

describe("filing suggestions", () => {
  const suggestionButtons = () =>
    Array.from(container.querySelectorAll("ul[aria-label='Suggested places'] button")).map((b) => b.textContent);

  it("shows none until a notebook is chosen", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    expect(suggestionButtons()).toEqual([]);
  });

  it("names the group and why", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup, coreGroup] } });
    addNotebook();
    expect(suggestionButtons()).toEqual([
      "Suggested: Atlas · 4 of 4 attendees",
      "Suggested: Core · 3 of 4 attendees",
    ]);
  });

  it("makes the first click the location when nothing is chosen", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    expect(locationText()).toEqual(["Core / Meetings"]);
  });

  it("adds a later click as a shortcut", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup, coreGroup] } });
    addNotebook();
    click(button("Suggested: Atlas"));
    click(button("Suggested: Core"));
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(shortcutText()).toEqual(["Core / Meetings"]);
  });

  it("sends the project of a picked suggestion with no project chosen first", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup] } });
    addNotebook();
    expect(controller.state.places).toEqual([]);
    click(button("Suggested: Atlas"));
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      projectId: "p1",
    });
    expect(meetingNotePayload(controller.state).notebook).not.toHaveProperty("location");
  });

  it("hides a suggestion once its place is selected", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    expect(suggestionButtons()).toEqual([]);
  });

  it("is never applied on its own", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    expect(controller.state.places).toEqual([]);
  });

  it("skips groups with nowhere a note can be filed", () => {
    const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b", "c"] });
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [offering] } });
    addNotebook();
    expect(suggestionButtons()).toEqual([]);
  });

  it("suggests the next group when the best one is unfilable", () => {
    const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b", "c"] });
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [offering, coreGroup] } });
    addNotebook();
    expect(suggestionButtons()).toEqual(["Suggested: Core · 3 of 3 attendees"]);
  });

  it("follows the meeting title", () => {
    mount({ suggest: { attendeeIds: [], groups: [atlasGroup] }, meetingTitle: "Atlas kickoff" });
    addNotebook();
    expect(suggestionButtons()).toEqual(["Suggested: Atlas · named in the title"]);
  });
});

describe("choosing an existing notebook", () => {
  const inCore: PickedNotebook = {
    id: "nb1",
    title: "Weekly sync",
    path: "Core ▸ Meetings",
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: "core-m",
  };
  const inAtlas: PickedNotebook = {
    id: "nb2",
    title: "Atlas sync",
    path: "Projects ▸ Atlas ▸ Meetings",
    workspaceType: "Project",
    workspaceId: "p1",
    parentPageId: "p1-m",
  };
  const hidden = { ...inCore, id: "nb3", path: "Somewhere ▸ Private", parentPageId: "not-in-rows" };
  const removeButton = () => container.querySelector("button[aria-label='Remove notebook']");
  const pick = (nb: PickedNotebook) => act(() => notebookPickerProps.mock.lastCall![0].onPick(nb));
  const openExisting = (props: Parameters<typeof mount>[0] = {}) => {
    mount(props);
    addNotebook();
    choose("Existing");
  };

  it("has no remove button until a notebook is chosen", () => {
    openExisting();
    expect(container.textContent).toContain("No notebook chosen");
    expect(removeButton()).toBeNull();
  });

  it("seeds its own place as the location when it is picked", () => {
    openExisting();
    pick(inCore);
    expect(locationText()).toEqual(["Core / Meetings"]);
    expect(shortcutText()).toEqual([]);
    expect(container.textContent).toContain("Weekly sync");
    expect(button("Change")).toBeTruthy();
  });

  it("sends no location while the notebook stays at its own place", () => {
    openExisting();
    pick(inCore);
    expect(meetingNotePayload(controller.state)).toMatchObject({ note: true, notebook: { existingId: "nb1" } });
    expect(meetingNotePayload(controller.state).notebook).not.toHaveProperty("location");
  });

  it("can't remove the notebook's own place from the top, only drag another above it", () => {
    openExisting({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup, atlasGroup] } });
    pick(inCore);
    expect(container.querySelector("button[aria-label='Remove Core / Meetings']")).toBeNull();
    click(button("Suggested: Atlas"));
    expect(container.querySelector("button[aria-label='Remove Projects / Atlas / Meetings']")).toBeTruthy();
  });

  it("follows the place put on top for the project, and sends only the notebook id", () => {
    openExisting({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup] } });
    pick(inCore);
    click(button("Suggested: Atlas"));
    expect(shortcutText()).toEqual(["Projects / Atlas / Meetings"]);
    click(container.querySelector("ul[aria-label='Shortcuts'] button[aria-label='Make location']"));
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(shortcutText()).toEqual(["Core / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      projectId: "p1",
      notebook: { existingId: "nb1" },
    });
  });

  it("sends no move when the place is dragged away and back", () => {
    openExisting({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup] } });
    pick(inCore);
    click(button("Suggested: Atlas"));
    act(() => controller.reorderPlaces(1, 0));
    act(() => controller.reorderPlaces(1, 0));
    expect(locationText()).toEqual(["Core / Meetings"]);
    expect(meetingNotePayload(controller.state).notebook).toEqual({ existingId: "nb1" });
  });

  it("shows a notebook whose folder can't be picked as a fixed location that is never moved", () => {
    openExisting({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    pick(hidden);
    expect(locationText()).toEqual(["Somewhere ▸ Private"]);
    expect(container.querySelector("ul[aria-label='Location'] button")).toBeNull();
    click(button("Suggested: Core"));
    expect(shortcutText()).toEqual(["Core / Meetings"]);
    expect(container.querySelector("button[aria-label='Make location']")).toBeNull();
    expect(meetingNotePayload(controller.state).notebook).toEqual({ existingId: "nb3" });
  });

  it("opens the picker with the notebook's place and shortcuts and a title that says so", () => {
    openExisting();
    pick(inCore);
    click(button("Add a place"));
    expect(pickerProps.mock.lastCall![0]).toMatchObject({
      heading: "Notebook location and shortcuts",
      initialDestinations: [{ driveId: "core", folderId: "core-m" }],
    });
  });

  it("removes the chosen notebook with its place but keeps the shortcuts", () => {
    openExisting({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup] } });
    pick(inCore);
    click(button("Suggested: Atlas"));
    click(removeButton());
    expect(controller.state.existing).toBeNull();
    expect(container.textContent).toContain("No notebook chosen");
    expect(button("Choose")).toBeTruthy();
    expect(removeButton()).toBeNull();
    expect(locationText()).toEqual([]);
    expect(shortcutText()).toEqual(["Projects / Atlas / Meetings"]);
  });

  it("swaps the old notebook's place for the new one's when another notebook is picked", () => {
    openExisting();
    pick(inCore);
    pick(inAtlas);
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(shortcutText()).toEqual([]);
  });

  it("takes the place off when switching back to New, and puts it back on switching to Existing", () => {
    openExisting();
    pick(inCore);
    choose("New");
    expect(controller.state.places).toEqual([]);
    expect(controller.state.existing).toMatchObject({ id: "nb1" });
    choose("Existing");
    expect(locationText()).toEqual(["Core / Meetings"]);
  });

  it("drops the notebook's place when the notebook is unchecked, and restores it when checked again", () => {
    openExisting();
    pick(inCore);
    addNotebook();
    expect(controller.state.places).toEqual([]);
    addNotebook();
    expect(locationText()).toEqual(["Core / Meetings"]);
  });

  it("sends the chosen notebook's project, and none once it is removed", () => {
    openExisting();
    pick(inAtlas);
    expect(meetingNotePayload(controller.state)).toMatchObject({ projectId: "p1", notebook: { existingId: "nb2" } });
    click(removeButton());
    expect(meetingNotePayload(controller.state)).not.toHaveProperty("projectId");
  });

  it("orders the notebook list by the project it is derived from, falling back to the invited project", () => {
    openExisting({ prefillProject: "p1" });
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: true, projectId: "p1" });
    expect(notebookPickerProps.mock.lastCall![0]).toMatchObject({ projectId: "p1" });
  });

  it("loads the notebook list as soon as the notebook is checked, and not before", () => {
    mount();
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: false });
    addNotebook();
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: true });
  });

  it("hands the picker the preloaded list", () => {
    openExisting();
    expect(notebookPickerProps.mock.lastCall![0].preloaded).toEqual({ rows: [], status: "ready" });
  });

  it("goes back to New from the picker's New notebook instead", () => {
    openExisting();
    act(() => notebookPickerProps.mock.lastCall![0].onNewInstead());
    expect(controller.state.notebookMode).toBe("new");
  });
});

describe("a whiteboard with no note in the create modal", () => {
  const startBoard = () => click(checkbox("Whiteboard"));

  it("shows Location with the whiteboard hint and no notebook fields or shortcuts", () => {
    mount();
    startBoard();
    expect(container.textContent).toContain("Location");
    expect(container.textContent).toContain("Goes in the default Meeting assets folder.");
    expect(container.textContent).not.toContain("Shortcuts");
    expect(container.querySelector("#meeting-notebook-name")).toBeNull();
  });

  it("seeds the invited project's folder as the only place, with no handle or ranking", () => {
    mount({ prefillProject: "p1" });
    startBoard();
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(container.querySelector("button[aria-label^='Reorder']")).toBeNull();
    expect(meetingNotePayload(controller.state)).toMatchObject({
      note: false,
      whiteboard: true,
      projectId: "p1",
    });
    expect(meetingNotePayload(controller.state)).not.toHaveProperty("noteLocation");
  });

  it("opens a single-place picker, not the multi picker", () => {
    mount();
    startBoard();
    click(button("Add a place"));
    const props = pickerProps.mock.lastCall![0];
    expect(props.mode).toBeUndefined();
    expect(props).toMatchObject({ heading: "Save whiteboard to", initial: { driveId: "lab", folderId: null } });
  });

  it("files the board at the picked place", () => {
    mount();
    startBoard();
    click(button("Add a place"));
    act(() => pickerProps.mock.lastCall![0].onConfirm({ driveId: "core", folderId: "core-m" }));
    expect(chipText()).toEqual(["Core / Meetings"]);
    expect(button("Change place")).toBeTruthy();
    expect(container.querySelector("[data-testid='folder-picker']")).toBeNull();
    expect(meetingNotePayload(controller.state)).not.toHaveProperty("noteLocation");
  });

  it("shows no suggestions", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    startBoard();
    expect(container.querySelector("ul[aria-label='Suggested places']")).toBeNull();
  });

  it("keeps only the first place when the notebook is dropped", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    click(button("Suggested: Core"));
    startBoard();
    addNotebook();
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(controller.state.places).toHaveLength(1);
  });

  it("drops the places of an existing notebook, which were only shortcuts", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    addNotebook();
    choose("Existing");
    click(button("Suggested: Core"));
    startBoard();
    addNotebook();
    expect(controller.state.places).toEqual([]);
    expect(meetingNotePayload(controller.state)).toEqual({ note: false, whiteboard: true });
  });

  it("goes back to the notebook's places once the notebook is checked again", () => {
    mount({ prefillProject: "p1" });
    startBoard();
    addNotebook();
    expect(locationText()).toEqual(["Projects / Atlas / Meetings"]);
  });

  it("shows the places once, under the notebook, when both are checked", () => {
    mount({ prefillProject: "p1" });
    startBoard();
    addNotebook();
    expect(container.querySelectorAll("[data-testid='filed-in-chip']")).toHaveLength(1);
    expect(container.querySelectorAll("ul[aria-label='Location']")).toHaveLength(1);
  });
});

describe("MeetingNoteFields in the add-note modal", () => {
  it("has no Notebook or Whiteboard checkbox, and shows New and Existing once the note is on", () => {
    mount({ surface: "note" });
    act(() => controller.setEnabled(true));
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(container.textContent).not.toContain("Start a whiteboard");
    expect(container.textContent).not.toContain("About");
    expect(Array.from(container.querySelectorAll("[role='radio']")).map((r) => r.textContent)).toEqual(["New", "Existing"]);
    expect(container.textContent).toContain("Location");
    expect(container.textContent).toContain("Shortcuts");
  });

  it("sends an existing notebook as its id, like the create modal", () => {
    mount({ surface: "note", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    act(() => controller.setEnabled(true));
    choose("Existing");
    act(() =>
      notebookPickerProps.mock.lastCall![0].onPick({
        id: "nb9",
        title: "Atlas",
        path: "Projects ▸ Atlas ▸ Meetings",
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: "p1-m",
      }),
    );
    click(button("Suggested: Core"));
    click(container.querySelector("button[aria-label='Make location']"));
    expect(meetingNotePayload(controller.state).notebook).toEqual({ existingId: "nb9" });
  });
});

describe("MeetingNoteFields in the add-whiteboard modal", () => {
  it("shows only where the board is filed, as a single place", () => {
    mount({ surface: "whiteboard" });
    act(() => controller.setWhiteboard(true));
    expect(container.textContent).toContain("Location");
    expect(container.textContent).not.toContain("Shortcuts");
    expect(container.textContent).not.toContain("About");
    expect(container.textContent).not.toContain("Save whiteboard to");
    expect(container.querySelector("input")).toBeNull();
  });

  it("picks the place with the single-place picker and sends the project it is in", () => {
    mount({ surface: "whiteboard" });
    act(() => controller.setWhiteboard(true));
    click(button("Add a place"));
    act(() => pickerProps.mock.lastCall![0].onConfirm({ driveId: "projects", folderId: "p1-m" }));
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      projectId: "p1",
    });
    expect(meetingNotePayload(controller.state)).not.toHaveProperty("noteLocation");
  });
});
