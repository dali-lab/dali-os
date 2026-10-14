// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GroupOption } from "~/calendar/lib/types";
import type { DefaultNotebookResult } from "~/calendar/components/meeting-note";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/notebooks/use-note-templates", () => ({
  useNoteTemplates: () => ({ templates: [{ id: "t1", title: "Retro" }] }),
}));

type PickerProps = {
  space?: { workspaceType: string; workspaceId: string | null; label: string } | null;
  meetingId?: string | null;
  newRow?: { label: string; onNew: () => void };
  onPick: (nb: Record<string, unknown>) => void;
  onClose: () => void;
};
let pickerProps: PickerProps | null = null;
vi.mock("~/components/notebooks/NotebookPicker", () => ({
  NotebookPicker: (props: PickerProps) => {
    pickerProps = props;
    return createElement("div", { "data-testid": "notebook-picker" });
  },
}));

const { MeetingNoteFields, useMeetingNote, meetingNotePayload, meetingNoteValid, inviteOf } = await import(
  "~/calendar/components/MeetingNoteFields"
);
type Controller = ReturnType<typeof useMeetingNote>;
type Suggest = NonNullable<Parameters<typeof MeetingNoteFields>[0]["suggest"]>;

const group = (over: Partial<GroupOption> & { id: string; name: string }): GroupOption => ({
  memberIds: [],
  projectId: null,
  systemKey: null,
  ...over,
});
const coreGroup = group({ id: "g-core", name: "Core", systemKey: "core", memberIds: ["a", "b", "c", "x", "y", "z", "w", "v"] });
const atlasGroup = group({ id: "g-atlas", name: "Atlas", projectId: "p1", memberIds: ["a", "b", "c", "d"] });
const attendeeIds = ["a", "b", "c", "d", "e", "f"];

const suggestOf = (over: Partial<Suggest> = {}): Suggest => ({
  attendeeIds,
  groups: [coreGroup, atlasGroup],
  invitedGroups: [],
  scopeGroupId: null,
  ...over,
});

const NEW_DEFAULT: DefaultNotebookResult = { kind: "new", notebook: null, newPath: "General" };
const seriesDefault: DefaultNotebookResult = {
  kind: "series",
  notebook: { id: "nb1", title: "Weekly", path: "Projects ▸ Atlas ▸ Meetings" },
  newPath: "x",
};

let container: HTMLDivElement;
let root: Root;
let controller: Controller;
let defaultResult: DefaultNotebookResult;
const fetchMock = vi.fn();

function Harness({
  surface = "create",
  suggest,
  meetingTitle = "Weekly sync",
  meetingId,
  onDefaultLoaded,
}: {
  surface?: "create" | "note" | "edit";
  suggest?: Suggest;
  meetingTitle?: string;
  meetingId?: string;
  onDefaultLoaded?: (d: DefaultNotebookResult) => void;
}): ReactNode {
  const note = useMeetingNote();
  controller = note;
  return createElement(MeetingNoteFields, {
    note,
    surface,
    fieldClass: "",
    labelClass: "",
    meetingTitle,
    meetingId,
    suggest,
    onDefaultLoaded,
  });
}

async function mount(props: Parameters<typeof Harness>[0] = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness, props)));
}

beforeEach(() => {
  pickerProps = null;
  defaultResult = NEW_DEFAULT;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ ok: true, json: async () => defaultResult }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const checkbox = (label: string) =>
  Array.from(container.querySelectorAll("label"))
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector("input") as HTMLInputElement | undefined;
const click = (el: Element | undefined | null) => act(async () => (el as HTMLElement).click());
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
const chips = () => Array.from(container.querySelectorAll("ul[aria-label='Suggested notebooks'] button")).map((b) => b.textContent);
const enable = () => click(checkbox("Meeting notes"));
const text = () => container.textContent ?? "";

describe("the create surface", () => {
  it("offers Meeting notes and Whiteboard checkboxes, both off", async () => {
    await mount();
    expect(checkbox("Meeting notes")!.checked).toBe(false);
    expect(checkbox("Whiteboard")!.checked).toBe(false);
    expect(text()).toContain("One shared note per meeting, kept in a notebook.");
    expect(text()).not.toContain("Notebook / Shared meeting notes");
  });

  it("renders nothing below the checkbox while it is off and fetches nothing", async () => {
    await mount({ suggest: suggestOf() });
    expect(text()).not.toContain("Pick where the notes go");
    expect(container.querySelector("ul[aria-label='Suggested notebooks']")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks where the notes go, with chips, search and create-new, once checked", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    expect(text()).toContain("Pick where the notes go");
    expect(button("Search notebooks")).toBeTruthy();
    expect(button("Or create a new notebook for this meeting's notes")).toBeTruthy();
    expect(meetingNoteValid(controller.state)).toBe(false);
  });

  it("clears the place when the checkbox is unchecked", async () => {
    defaultResult = seriesDefault;
    await mount();
    await enable();
    expect(controller.state.place).not.toBeNull();
    await enable();
    expect(controller.state).toMatchObject({ enabled: false, place: null, reason: null });
  });

  it("keeps the whiteboard when the notes are unchecked", async () => {
    await mount();
    await enable();
    await click(checkbox("Whiteboard"));
    await enable();
    expect(controller.state).toMatchObject({ enabled: false, whiteboard: true });
  });
});

describe("suggestion chips", () => {
  it("name each group's space with its attendee count, best coverage first", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    expect(chips()).toEqual(["Atlas4 of 6 attendees", "Core3 of 6 attendees"]);
  });

  it("show at most three", async () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      group({ id: `g${i}`, name: `Project ${i}`, projectId: `p${i}`, memberIds: ["a", "b"] }),
    );
    await mount({ suggest: suggestOf({ groups: many }) });
    await enable();
    expect(chips()).toHaveLength(3);
  });

  it("show none without a suggestion input", async () => {
    await mount();
    await enable();
    expect(chips()).toEqual([]);
  });

  it("open the picker scoped to the project with New notebook in it first", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Atlas"));
    expect(pickerProps!.space).toMatchObject({ workspaceType: "Project", workspaceId: "p1" });
    expect(pickerProps!.newRow!.label).toBe("New notebook in Atlas");
  });

  it("open the Lab space for Core", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Core"));
    expect(pickerProps!.space).toMatchObject({ workspaceType: "Lab", workspaceId: null });
    expect(pickerProps!.newRow!.label).toBe("New notebook in Core");
  });

  it("fill the place when a notebook is picked", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Atlas"));
    await act(async () =>
      pickerProps!.onPick({
        id: "nb9",
        title: "Roadmap",
        path: "Projects ▸ Atlas ▸ Meetings",
        workspaceType: "Project",
        workspaceId: "p1",
        parentPageId: "f1",
      }),
    );
    expect(text()).toContain("Roadmap · Projects ▸ Atlas ▸ Meetings");
    expect(text()).not.toContain("Pick where the notes go");
    expect(controller.state.auto).toBe(false);
    expect(meetingNoteValid(controller.state)).toBe(true);
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({
      note: true,
      projectId: "p1",
      notebook: { existingId: "nb9" },
    });
  });

  it("start a new notebook in the project from the first row", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Atlas"));
    await act(async () => pickerProps!.newRow!.onNew());
    expect(text()).toContain("New notebook “Weekly sync” · Atlas");
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({
      projectId: "p1",
      notebook: { title: "Weekly sync", templatePageId: null },
    });
  });
});

describe("search", () => {
  it("opens the picker across every space with New notebook first", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Search notebooks"));
    expect(pickerProps!.space).toBeNull();
    expect(pickerProps!.newRow!.label).toBe("New notebook…");
  });

  it("starts the new notebook in the invited space", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [atlasGroup] }) });
    await enable();
    await click(button("Search notebooks"));
    await act(async () => pickerProps!.newRow!.onNew());
    expect(text()).toContain("New notebook “Weekly sync” · Atlas");
  });
});

describe("create a new notebook", () => {
  it("shows the title input prefilled from the meeting title and the template select", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Or create a new notebook for this meeting's notes"));
    const input = container.querySelector<HTMLInputElement>("#meeting-notebook-name")!;
    expect(input.value).toBe("Weekly sync");
    expect(text()).toContain("Template");
    expect(text()).toContain("Default template");
  });

  it.each([
    ["a single project group", [atlasGroup], "Atlas"],
    ["the Core group", [coreGroup], "Core"],
    ["several groups", [atlasGroup, coreGroup], "Core"],
    ["no group", [], "Lab"],
  ])("files in the space of %s", async (_name, invitedGroups, label) => {
    await mount({ suggest: suggestOf({ invitedGroups }) });
    await enable();
    await click(button("Or create a new notebook for this meeting's notes"));
    expect(text()).toContain(`New notebook “Weekly sync” · ${label}`);
  });

  it("files in the Lab for two project groups", async () => {
    const other = group({ id: "g-b", name: "Beta", projectId: "p2", memberIds: ["a"] });
    await mount({ suggest: suggestOf({ invitedGroups: [atlasGroup, other] }) });
    await enable();
    await click(button("Or create a new notebook for this meeting's notes"));
    expect(text()).toContain("· Lab");
  });

  it("follows the meeting title until the organizer edits the name", async () => {
    await mount();
    await enable();
    await click(button("Or create a new notebook for this meeting's notes"));
    await act(async () => root.render(createElement(Harness, { meetingTitle: "Weekly sync 2" })));
    expect(container.querySelector<HTMLInputElement>("#meeting-notebook-name")!.value).toBe("Weekly sync 2");
    await act(async () => controller.setTitle("Mine"));
    await act(async () => root.render(createElement(Harness, { meetingTitle: "Other" })));
    expect(container.querySelector<HTMLInputElement>("#meeting-notebook-name")!.value).toBe("Mine");
  });
});

describe("the place row", () => {
  it("shows the series notebook with its reason and a Change button", async () => {
    defaultResult = seriesDefault;
    await mount({ suggest: suggestOf() });
    await enable();
    expect(text()).toContain("Weekly · Projects ▸ Atlas ▸ Meetings");
    expect(text()).toContain("this meeting's notebook");
    expect(text()).not.toContain("Pick where the notes go");
    expect(chips()).toEqual([]);
  });

  it("shows the group's last notebook with its reason", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf() });
    await enable();
    expect(text()).toContain("last used by this group");
  });

  it("leaves the place empty when the default is a new notebook", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    expect(controller.state.place).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks the default endpoint about the meeting, the group and the project", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [atlasGroup], scopeGroupId: "g-atlas" }), meetingId: "m1" });
    await enable();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/notebooks/default?");
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("scopeType")).toBe("Group");
    expect(params.get("groupId")).toBe("g-atlas");
    expect(params.get("meetingId")).toBe("m1");
    expect(params.get("projectId")).toBe("p1");
    expect(params.get("isCoreMeeting")).toBeNull();
  });

  it("flags the Core group in the default request", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [coreGroup] }) });
    await enable();
    expect(new URL(String(fetchMock.mock.calls[0]![0]), "http://x").searchParams.get("isCoreMeeting")).toBe("1");
  });

  it("opens the picker across every space with New notebook first on Change", async () => {
    defaultResult = seriesDefault;
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Change"));
    expect(pickerProps!.space).toBeNull();
    expect(pickerProps!.newRow!.label).toBe("New notebook…");
  });

  it("replaces an auto-set place when the invited groups change, but not a picked one", async () => {
    defaultResult = seriesDefault;
    await mount({ suggest: suggestOf() });
    await enable();
    defaultResult = NEW_DEFAULT;
    await act(async () => root.render(createElement(Harness, { suggest: suggestOf({ invitedGroups: [atlasGroup] }) })));
    expect(controller.state.place).toBeNull();

    await act(async () => controller.pickNotebook({ id: "mine", title: "Mine", path: "General", workspaceType: "Lab", workspaceId: null }));
    defaultResult = seriesDefault;
    await act(async () => root.render(createElement(Harness, { suggest: suggestOf({ invitedGroups: [coreGroup] }) })));
    expect(controller.state.place).toMatchObject({ kind: "existing", notebook: { id: "mine" } });
  });

  it("reports the default to the caller", async () => {
    defaultResult = seriesDefault;
    const onDefaultLoaded = vi.fn();
    await mount({ onDefaultLoaded });
    await enable();
    expect(onDefaultLoaded).toHaveBeenCalledWith(seriesDefault);
  });

  it("ignores a failed default request", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await mount();
    await enable();
    expect(controller.state.place).toBeNull();
    expect(text()).toContain("Pick where the notes go");
  });
});

describe("the add-note surface", () => {
  it("has no checkboxes and starts from the meeting's notebook", async () => {
    defaultResult = seriesDefault;
    await mount({ surface: "note", meetingId: "m9" });
    await act(async () => controller.setEnabled(true));
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(text()).toContain("Weekly · Projects ▸ Atlas ▸ Meetings");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("meetingId=m9");
  });
});

describe("the edit surface", () => {
  it("offers search but neither new-notebook route", async () => {
    await mount({ surface: "edit", suggest: suggestOf(), meetingId: "m1" });
    await act(async () => controller.setEnabled(true));
    expect(text()).toContain("Meeting notes");
    expect(button("Or create a new notebook for this meeting's notes")).toBeUndefined();
    await click(button("Search notebooks"));
    expect(pickerProps!.newRow).toBeUndefined();
  });

  it("leaves Change without a new-notebook row", async () => {
    defaultResult = seriesDefault;
    await mount({ surface: "edit", meetingId: "m1" });
    await act(async () => controller.setEnabled(true));
    await click(button("Change"));
    expect(pickerProps!.newRow).toBeUndefined();
  });
});
