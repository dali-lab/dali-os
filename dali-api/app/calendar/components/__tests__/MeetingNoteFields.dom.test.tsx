// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PickerRows } from "~/components/drive/picker-rows";
import type { GroupOption } from "~/calendar/lib/types";

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

const radio = (label: string) =>
  Array.from(container.querySelectorAll("label"))
    .find((l) => l.textContent === label)
    ?.querySelector("input") as HTMLInputElement | undefined;
const choose = (label: string) => act(() => radio(label)!.click());
const chipText = () =>
  Array.from(container.querySelectorAll("[data-testid='filed-in-chip']")).map((c) => c.textContent);
const checkbox = (label: string) =>
  Array.from(container.querySelectorAll("label"))
    .find((l) => l.textContent === label)
    ?.querySelector("input") as HTMLInputElement | undefined;
const click = (el: Element | undefined | null) => act(() => (el as HTMLElement).click());
const button = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

describe("MeetingNoteFields in the create modal", () => {
  it("offers No note, New notebook and Add to existing notebook, with no note chosen", () => {
    mount();
    const labels = Array.from(container.querySelectorAll("input[type='radio']")).map((i) => i.closest("label")?.textContent);
    expect(labels).toEqual(["No note", "New notebook", "Add to existing notebook"]);
    expect(radio("No note")!.checked).toBe(true);
    expect(container.textContent).not.toContain("Filed in");
    expect(container.textContent).not.toContain("About");
  });

  it("titles the section Meeting assets with a Notes row and, under it, a Whiteboard row", () => {
    mount();
    const text = container.textContent!;
    expect(text.indexOf("Meeting assets")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Notes")).toBeLessThan(text.indexOf("Whiteboard"));
    expect(text).toContain("Start a whiteboard");
    expect(text).not.toContain("Also start a whiteboard");
    expect(container.querySelector("[role='radiogroup'][aria-label='Notes']")).toBeTruthy();
  });

  it("shows the name and Filed in once a note is chosen, with no About select", () => {
    mount();
    choose("New notebook");
    expect(container.querySelector("#meeting-notebook-name")).toBeTruthy();
    expect(container.textContent).toContain("Filed in");
    expect(container.textContent).not.toContain("About");
  });

  it("offers the whiteboard without a note", () => {
    mount();
    click(checkbox("Start a whiteboard"));
    expect(controller.state).toMatchObject({ enabled: false, whiteboard: true });
    expect(container.querySelector("#meeting-notebook-name")).toBeNull();
  });

  it("seeds the invited project's Meetings receiver as the primary chip", () => {
    mount({ prefillProject: "p1" });
    choose("New notebook");
    expect(chipText()).toEqual(["Projects / Atlas / MeetingsPrimary"]);
  });

  it("leaves Filed in empty with no invited project", () => {
    mount();
    choose("New notebook");
    expect(chipText()).toEqual([]);
    expect(controller.state.places).toEqual([]);
  });

  it("stops following the invited project once the organizer removes the chip", () => {
    mount({ prefillProject: "p1" });
    choose("New notebook");
    click(container.querySelector("button[aria-label='Remove Projects / Atlas / Meetings']"));
    expect(chipText()).toEqual([]);
    expect(controller.state.placesTouched).toBe(true);
  });

  it("keeps the whiteboard when the note is dropped", () => {
    mount();
    choose("New notebook");
    act(() => controller.setWhiteboard(true));
    choose("No note");
    expect(controller.state.whiteboard).toBe(true);
    expect(controller.state.enabled).toBe(false);
  });

  it("derives the project from the primary place", () => {
    mount({ prefillProject: "p1" });
    choose("New notebook");
    expect(meetingNotePayload(controller.state)).toMatchObject({ projectId: "p1" });
  });

  it("sends the primary and links in the payload", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    click(button("Suggested: Core"));
    expect(chipText()).toEqual(["Projects / Atlas / MeetingsPrimary", "Core / MeetingsLink"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      note: true,
      projectId: "p1",
      notebook: {
        title: "Weekly sync",
        location: { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m" },
        links: [{ workspaceType: "Lab", workspaceId: null, parentPageId: "core-m" }],
      },
    });
  });

  it("promotes a link when its badge is clicked", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    click(button("Suggested: Core"));
    click(container.querySelector("button[aria-label='Make Core / Meetings primary']"));
    expect(chipText()).toEqual(["Core / MeetingsPrimary", "Projects / Atlas / MeetingsLink"]);
  });

  it("opens the multi picker seeded with the current places, primary first", () => {
    mount({ prefillProject: "p1" });
    choose("New notebook");
    click(button("Add a place"));
    const props = pickerProps.mock.lastCall![0];
    expect(props).toMatchObject({
      mode: "multi",
      preferFolderType: "Meetings",
      initialDestinations: [{ driveId: "projects", folderId: "p1-m" }],
    });
    expect(props.drives.map((d: { id: string }) => d.id)).toEqual(["lab", "core", "projects"]);
  });

  it("takes the picker's result as the new places", () => {
    mount({ prefillProject: "p1" });
    choose("New notebook");
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
    expect(chipText()).toEqual([
      "Lab / Meeting assetsPrimary",
      "Projects / Atlas / MeetingsLink",
      "Core / MeetingsLink",
    ]);
    expect(container.querySelector("[data-testid='folder-picker']")).toBeNull();
  });

  it("treats every chip as a link for an existing notebook", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("Add to existing notebook");
    expect(chipText()).toEqual([]);
    click(button("Suggested: Core"));
    expect(chipText()).toEqual(["Core / MeetingsLink"]);
    expect(container.querySelector("button[aria-label^='Make']")).toBeNull();
  });
});

describe("filing suggestions", () => {
  const suggestionButtons = () =>
    Array.from(container.querySelectorAll("ul[aria-label='Suggested places'] button")).map((b) => b.textContent);

  it("shows none until a note is chosen", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    expect(suggestionButtons()).toEqual([]);
  });

  it("names the group and why", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup, coreGroup] } });
    choose("New notebook");
    expect(suggestionButtons()).toEqual([
      "Suggested: Atlas · 4 of 4 attendees",
      "Suggested: Core · 3 of 4 attendees",
    ]);
  });

  it("makes the first click primary when nothing is chosen", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    click(button("Suggested: Core"));
    expect(chipText()).toEqual(["Core / MeetingsPrimary"]);
  });

  it("makes a picked suggestion the primary with no project chosen first", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c", "d"], groups: [atlasGroup] } });
    choose("New notebook");
    expect(controller.state.places).toEqual([]);
    click(button("Suggested: Atlas"));
    expect(chipText()).toEqual(["Projects / Atlas / MeetingsPrimary"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      projectId: "p1",
      notebook: { location: { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m" } },
    });
  });

  it("hides a suggestion once its place is selected", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    click(button("Suggested: Core"));
    expect(suggestionButtons()).toEqual([]);
  });

  it("is never applied on its own", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    expect(controller.state.places).toEqual([]);
  });

  it("skips groups with nowhere a note can be filed", () => {
    const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b", "c"] });
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [offering] } });
    choose("New notebook");
    expect(suggestionButtons()).toEqual([]);
  });

  it("suggests the next group when the best one is unfilable", () => {
    const offering = group({ id: "g-off", name: "Intro to Design", systemKey: "offering:o1", memberIds: ["a", "b", "c"] });
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [offering, coreGroup] } });
    choose("New notebook");
    expect(suggestionButtons()).toEqual(["Suggested: Core · 3 of 3 attendees"]);
  });

  it("follows the meeting title", () => {
    mount({ suggest: { attendeeIds: [], groups: [atlasGroup] }, meetingTitle: "Atlas kickoff" });
    choose("New notebook");
    expect(suggestionButtons()).toEqual(["Suggested: Atlas · named in the title"]);
  });
});

describe("choosing an existing notebook", () => {
  const picked = {
    id: "nb1",
    title: "Weekly sync",
    path: "Projects ▸ Atlas",
    workspaceType: "Project",
    workspaceId: "p1",
  };
  const removeButton = () => container.querySelector("button[aria-label='Remove notebook']");

  it("has no remove button until a notebook is chosen", () => {
    mount();
    choose("Add to existing notebook");
    expect(container.textContent).toContain("No notebook chosen");
    expect(removeButton()).toBeNull();
  });

  it("removes the chosen notebook but keeps the links", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("Add to existing notebook");
    click(button("Suggested: Core"));
    act(() => controller.setExisting(picked));
    expect(container.textContent).toContain("Weekly sync");
    expect(button("Change")).toBeTruthy();

    click(removeButton());

    expect(controller.state.existing).toBeNull();
    expect(container.textContent).toContain("No notebook chosen");
    expect(button("Choose")).toBeTruthy();
    expect(removeButton()).toBeNull();
    expect(chipText()).toEqual(["Core / MeetingsLink"]);
  });

  it("sends the chosen notebook's project, and none once it is removed", () => {
    mount();
    choose("Add to existing notebook");
    act(() => controller.setExisting(picked));
    expect(meetingNotePayload(controller.state)).toMatchObject({ projectId: "p1", notebook: { existingId: "nb1" } });
    click(removeButton());
    expect(meetingNotePayload(controller.state)).not.toHaveProperty("projectId");
  });

  it("orders the notebook list by the project it is derived from, falling back to the invited project", () => {
    mount({ prefillProject: "p1" });
    choose("Add to existing notebook");
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: true, projectId: "p1" });
    expect(notebookPickerProps.mock.lastCall![0]).toMatchObject({ projectId: "p1" });
  });

  it("loads the notebook list as soon as a note is chosen, and not before", () => {
    mount();
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: false });
    choose("New notebook");
    expect(notebookListArgs.mock.lastCall![0]).toMatchObject({ enabled: true });
  });

  it("hands the picker the preloaded list", () => {
    mount();
    choose("Add to existing notebook");
    expect(notebookPickerProps.mock.lastCall![0].preloaded).toEqual({ rows: [], status: "ready" });
  });
});

describe("a whiteboard with no note in the create modal", () => {
  const startBoard = () => click(checkbox("Start a whiteboard"));

  it("shows Filed in with the whiteboard hint and no notebook fields", () => {
    mount();
    startBoard();
    expect(container.textContent).toContain("Filed in");
    expect(container.textContent).toContain("Nothing chosen. The whiteboard goes in the default Meeting assets folder.");
    expect(container.querySelector("#meeting-notebook-name")).toBeNull();
  });

  it("seeds the invited project's folder as the only place, without a Primary or Link badge", () => {
    mount({ prefillProject: "p1" });
    startBoard();
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      note: false,
      whiteboard: true,
      projectId: "p1",
      noteLocation: { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m" },
    });
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
    expect(meetingNotePayload(controller.state).noteLocation).toEqual({
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "core-m",
    });
  });

  it("shows no suggestions", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    startBoard();
    expect(container.querySelector("ul[aria-label='Suggested places']")).toBeNull();
  });

  it("keeps only the first place when the note is dropped", () => {
    mount({ prefillProject: "p1", suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("New notebook");
    click(button("Suggested: Core"));
    startBoard();
    choose("No note");
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(controller.state.places).toHaveLength(1);
  });

  it("drops the places of an existing notebook, which were only links", () => {
    mount({ suggest: { attendeeIds: ["a", "b", "c"], groups: [coreGroup] } });
    choose("Add to existing notebook");
    click(button("Suggested: Core"));
    startBoard();
    choose("No note");
    expect(controller.state.places).toEqual([]);
    expect(meetingNotePayload(controller.state)).toEqual({ note: false, whiteboard: true });
  });

  it("goes back to ranked places once a note is chosen again", () => {
    mount({ prefillProject: "p1" });
    startBoard();
    choose("New notebook");
    expect(chipText()).toEqual(["Projects / Atlas / MeetingsPrimary"]);
  });
});

describe("MeetingNoteFields in the add-note modal", () => {
  it("has no No note option and no whiteboard checkbox", () => {
    mount({ surface: "note" });
    act(() => controller.setEnabled(true));
    expect(radio("No note")).toBeUndefined();
    expect(container.textContent).not.toContain("Start a whiteboard");
    expect(container.textContent).not.toContain("About");
    expect(container.textContent).toContain("Filed in");
  });
});

describe("MeetingNoteFields in the add-whiteboard modal", () => {
  it("shows only where the board is filed, as a single place", () => {
    mount({ surface: "whiteboard" });
    act(() => controller.setWhiteboard(true));
    expect(container.textContent).toContain("Filed in");
    expect(container.textContent).not.toContain("About");
    expect(container.textContent).not.toContain("Save whiteboard to");
    expect(container.querySelector("input[type='radio']")).toBeNull();
  });

  it("picks the place with the single-place picker and sends the project it is in", () => {
    mount({ surface: "whiteboard" });
    act(() => controller.setWhiteboard(true));
    click(button("Add a place"));
    act(() => pickerProps.mock.lastCall![0].onConfirm({ driveId: "projects", folderId: "p1-m" }));
    expect(chipText()).toEqual(["Projects / Atlas / Meetings"]);
    expect(meetingNotePayload(controller.state)).toMatchObject({
      projectId: "p1",
      noteLocation: { workspaceType: "Project", workspaceId: "p1", parentPageId: "p1-m" },
    });
  });
});
