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

const DEST_ROWS = {
  drives: [
    { id: "projects", label: "Projects" },
    { id: "lab", label: "Lab" },
    { id: "core", label: "Core", rootFolderId: "core-root" },
    { id: "mine", label: "My Drive" },
  ],
  folders: [
    { id: "p1", driveId: "projects", parentId: null, title: "Atlas" },
    { id: "p1-meetings", driveId: "projects", parentId: "p1", title: "Meetings" },
    { id: "core-f", driveId: "core", parentId: null, title: "Retros" },
    { id: "lab-f", driveId: "lab", parentId: null, title: "Design" },
  ],
};
vi.mock("~/components/drive/use-drive-destinations", () => ({
  useDriveDestinations: ({ enabled }: { enabled?: boolean }) => ({
    rows: DEST_ROWS,
    status: enabled ? "ready" : "idle",
    load: vi.fn(),
  }),
}));

type FolderPickerProps = {
  drives: { id: string }[];
  initial?: { driveId: string; folderId: string | null };
  onConfirm: (dest: { driveId: string; folderId: string | null }) => void;
  onClose: () => void;
};
let folderPickerProps: FolderPickerProps | null = null;
vi.mock("~/components/drive/FolderPicker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/components/drive/FolderPicker")>()),
  FolderPicker: (props: FolderPickerProps) => {
    folderPickerProps = props;
    return createElement("div", { "data-testid": "folder-picker" });
  },
}));

type PickerProps = {
  preloaded?: { rows: { id: string }[]; status: string };
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
let listRows: { id: string }[] = [];
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
  folderPickerProps = null;
  defaultResult = NEW_DEFAULT;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith("/api/notebooks/default") ? defaultResult : { notebooks: listRows }),
  }));
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
const removeButton = () => container.querySelector("[aria-label='Remove notebook']");
const defaultCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/notebooks/default"));
const listCalls = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/notebooks?"));

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
    expect(button("New notebook")).toBeTruthy();
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

  it("open the Core space for Core, not every Lab notebook", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Core"));
    expect(pickerProps!.space).toMatchObject({ workspaceType: "Core", workspaceId: null });
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

describe("a new notebook from the Core chip", () => {
  it("files in Core and makes the meeting Core, though the Core group is not invited", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [] }) });
    await enable();
    await click(button("Core"));
    await act(async () => pickerProps!.newRow!.onNew());
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({
      isCoreMeeting: true,
      notebook: { title: "Weekly sync", space: { kind: "core" } },
    });
  });

  it("reads General, not Lab, as the space of a plain invite", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [] }) });
    await enable();
    await click(button("New notebook"));
    expect(text()).toContain("New notebook “Weekly sync” · General");
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({ notebook: { space: { kind: "lab" } } });
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
    await click(button("New notebook"));
    const input = container.querySelector<HTMLInputElement>("#meeting-notebook-name")!;
    expect(input.value).toBe("Weekly sync");
    expect(text()).toContain("Template");
    expect(text()).toContain("Default template");
  });

  it.each([
    ["a single project group", [atlasGroup], "Atlas"],
    ["the Core group", [coreGroup], "Core"],
    ["several groups", [atlasGroup, coreGroup], "Core"],
    ["no group", [], "General"],
  ])("files in the space of %s", async (_name, invitedGroups, label) => {
    await mount({ suggest: suggestOf({ invitedGroups }) });
    await enable();
    await click(button("New notebook"));
    expect(text()).toContain(`New notebook “Weekly sync” · ${label}`);
  });

  it("files in the Lab for two project groups", async () => {
    const other = group({ id: "g-b", name: "Beta", projectId: "p2", memberIds: ["a"] });
    await mount({ suggest: suggestOf({ invitedGroups: [atlasGroup, other] }) });
    await enable();
    await click(button("New notebook"));
    expect(text()).toContain("· General");
  });

  it("follows the meeting title until the organizer edits the name", async () => {
    await mount();
    await enable();
    await click(button("New notebook"));
    await act(async () => root.render(createElement(Harness, { meetingTitle: "Weekly sync 2" })));
    expect(container.querySelector<HTMLInputElement>("#meeting-notebook-name")!.value).toBe("Weekly sync 2");
    await act(async () => controller.setTitle("Mine"));
    await act(async () => root.render(createElement(Harness, { meetingTitle: "Other" })));
    expect(container.querySelector<HTMLInputElement>("#meeting-notebook-name")!.value).toBe("Mine");
  });
});

describe("the place row", () => {
  it("shows the series notebook with its reason and a Remove button", async () => {
    defaultResult = seriesDefault;
    await mount({ suggest: suggestOf() });
    await enable();
    expect(text()).toContain("Weekly · Projects ▸ Atlas ▸ Meetings");
    expect(text()).toContain("this meeting's notebook");
    expect(text()).not.toContain("Pick where the notes go");
    expect(removeButton()).toBeTruthy();
  });

  it("hides the suggestion chips, Search and New while a notebook is chosen", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf() });
    await enable();
    expect(text()).toContain("last used by this group");
    expect(chips()).toEqual([]);
    expect(button("Search notebooks")).toBeUndefined();
    expect(button("New notebook")).toBeUndefined();
    expect(button("Change")).toBeUndefined();
  });

  it("clears an existing notebook with the X and brings the options back", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf() });
    await enable();
    await click(removeButton());
    expect(controller.state.place).toBeNull();
    expect(text()).toContain("Pick where the notes go");
    expect(chips()).toEqual(["Atlas4 of 6 attendees", "Core3 of 6 attendees"]);
    expect(button("Search notebooks")).toBeTruthy();
    expect(button("New notebook")).toBeTruthy();
  });

  it("does not fill a removed notebook back in from the default", async () => {
    defaultResult = seriesDefault;
    await mount({ suggest: suggestOf() });
    await enable();
    await click(removeButton());
    await act(async () => root.render(createElement(Harness, { suggest: suggestOf({ invitedGroups: [atlasGroup] }) })));
    expect(controller.state.place).toBeNull();
  });

  it("clears a picked notebook with the X without refetching the default", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await act(async () => controller.pickNotebook({ id: "mine", title: "Mine", path: "General", workspaceType: "Lab", workspaceId: null }));
    const before = defaultCalls().length;
    await click(removeButton());
    expect(controller.state.place).toBeNull();
    expect(defaultCalls()).toHaveLength(before);
  });

  it("opens the picker from a chip after the X and replaces nothing on cancel", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf() });
    await enable();
    await click(removeButton());
    await click(button("Atlas"));
    expect(pickerProps!.space).toMatchObject({ workspaceType: "Project", workspaceId: "p1" });
    await act(async () =>
      pickerProps!.onPick({ id: "nb9", title: "Roadmap", path: "Projects ▸ Atlas", workspaceType: "Project", workspaceId: "p1", parentPageId: null }),
    );
    expect(text()).toContain("Roadmap · Projects ▸ Atlas");
    expect(controller.state.auto).toBe(false);
  });

  it("opens the picker from Search after the X", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf() });
    await enable();
    await click(removeButton());
    await click(button("Search notebooks"));
    expect(pickerProps!.space).toBeNull();
  });

  it("starts a new notebook from New after the X", async () => {
    defaultResult = { ...seriesDefault, kind: "history" };
    await mount({ suggest: suggestOf({ invitedGroups: [coreGroup] }) });
    await enable();
    await click(removeButton());
    await click(button("New notebook"));
    expect(text()).toContain("New notebook “Weekly sync” · Core");
    expect(controller.state.place).toMatchObject({ kind: "new", space: { core: true } });
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
    expect(defaultCalls()).toHaveLength(1);
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
    expect(button("New notebook")).toBeUndefined();
    await click(button("Search notebooks"));
    expect(pickerProps!.newRow).toBeUndefined();
  });

  it("leaves Search without a new-notebook row once the notebook is removed", async () => {
    defaultResult = seriesDefault;
    await mount({ surface: "edit", meetingId: "m1" });
    await act(async () => controller.setEnabled(true));
    await click(removeButton());
    await click(button("Search notebooks"));
    expect(pickerProps!.newRow).toBeUndefined();
  });
});

describe("a 1:1 with the viewer's mentee", () => {
  const pairNotebook = {
    id: "pair-nb",
    title: "Mia Chen with Me (F26)",
    path: "Mentorship ▸ Mentor notebooks",
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: "f-mentor",
  };
  const oneOnOne = (over: Partial<Suggest> = {}) =>
    suggestOf({
      attendeeIds: ["mia"],
      groups: [],
      viewerId: "me",
      mentorPairs: [{ menteeId: "mia", menteeName: "Mia Chen" }],
      ...over,
    });

  function postReturns(res: { ok: boolean; body?: unknown }) {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) =>
      init?.method === "POST" ? { ok: res.ok, json: async () => res.body } : { ok: true, json: async () => defaultResult },
    );
  }

  it("puts the pair chip first with its reason", async () => {
    await mount({ suggest: oneOnOne({ attendeeIds: ["a"], groups: [atlasGroup], mentorPairs: [{ menteeId: "a", menteeName: "Ann Lee" }] }) });
    await enable();
    expect(chips()).toEqual(["Mentorship · Ann Leeyour mentee", "Atlas1 of 1 attendee"]);
  });

  it("shows no pair chip for anyone but the mentee, or once a group is invited", async () => {
    await mount({ suggest: oneOnOne({ attendeeIds: ["zed"] }) });
    await enable();
    expect(chips()).toEqual([]);
    await act(async () => root.render(createElement(Harness, { suggest: oneOnOne({ invitedGroups: [atlasGroup] }) })));
    expect(chips()).toEqual([]);
  });

  it("files into the pair notebook on a click, asking the server to make it", async () => {
    await mount({ suggest: oneOnOne() });
    await enable();
    postReturns({ ok: true, body: pairNotebook });
    await click(button("Mentorship · Mia Chen"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/notebooks/mentorship-pair");
    expect(JSON.parse(post[1].body)).toEqual({ menteeId: "mia" });
    expect(controller.state.place).toMatchObject({ kind: "existing", notebook: { id: "pair-nb" } });
    expect(controller.state.auto).toBe(false);
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({ notebook: { existingId: "pair-nb" } });
  });

  it("says so when the pair notebook cannot be opened and leaves the place empty", async () => {
    await mount({ suggest: oneOnOne() });
    await enable();
    postReturns({ ok: false });
    await click(button("Mentorship · Mia Chen"));
    expect(text()).toContain("Couldn't open that notebook");
    expect(controller.state.place).toBeNull();
  });

  it("asks the default endpoint about the mentee", async () => {
    await mount({ suggest: oneOnOne() });
    await enable();
    expect(new URL(String(fetchMock.mock.calls[0]![0]), "http://x").searchParams.get("pairMenteeId")).toBe("mia");
  });

  it("does not name a mentee to the default endpoint on any other invite", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    expect(new URL(String(fetchMock.mock.calls[0]![0]), "http://x").searchParams.has("pairMenteeId")).toBe(false);
  });

  it("starts on the pair notebook when it already exists", async () => {
    defaultResult = { kind: "pair", notebook: pairNotebook, newPath: "General" };
    await mount({ suggest: oneOnOne() });
    await enable();
    expect(text()).toContain("Mia Chen with Me (F26) · Mentorship ▸ Mentor notebooks");
    expect(text()).toContain("your mentee");
    expect(controller.state.auto).toBe(true);
  });

  it("drops that default when the invite stops being the 1:1", async () => {
    defaultResult = { kind: "pair", notebook: pairNotebook, newPath: "General" };
    await mount({ suggest: oneOnOne() });
    await enable();
    defaultResult = NEW_DEFAULT;
    await act(async () => root.render(createElement(Harness, { suggest: oneOnOne({ attendeeIds: ["mia", "zed"] }) })));
    expect(controller.state.place).toBeNull();
  });
});


describe("Change folder on a new notebook", () => {
  async function newNotebook(invitedGroups: GroupOption[] = []) {
    await mount({ suggest: suggestOf({ invitedGroups }) });
    await enable();
    await click(button("New notebook"));
  }
  const folderPick = (driveId: string, folderId: string | null) =>
    act(async () => folderPickerProps!.onConfirm({ driveId, folderId }));

  it("offers Change folder and the X, not the notebook search", async () => {
    await newNotebook();
    expect(button("Change folder")).toBeTruthy();
    expect(button("Change")?.textContent).toBe("Change folder");
    expect(removeButton()).toBeTruthy();
    expect(folderPickerProps).toBeNull();
  });

  it("opens the folder picker without My Drive, starting where the notebook already sits", async () => {
    await newNotebook();
    await click(button("Change folder"));
    expect(container.querySelector("[data-testid='folder-picker']")).not.toBeNull();
    expect(folderPickerProps!.drives.map((d) => d.id)).toEqual(["projects", "lab", "core"]);
    expect(pickerProps).toBeNull();
  });

  it("reads the picked path on the row and sends the folder", async () => {
    await newNotebook();
    await click(button("Change folder"));
    await folderPick("projects", "p1-meetings");
    expect(text()).toContain("New notebook “Weekly sync” · Projects ▸ Atlas ▸ Meetings");
    expect(container.querySelector("[data-testid='folder-picker']")).toBeNull();
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({
      projectId: "p1",
      notebook: { title: "Weekly sync", folderPageId: "p1-meetings", space: { kind: "project", projectId: "p1" } },
    });
  });

  it("makes a Core folder a Core notebook", async () => {
    await newNotebook();
    await click(button("Change folder"));
    await folderPick("core", "core-f");
    expect(text()).toContain("· Core ▸ Retros");
    expect(meetingNotePayload(controller.state, inviteOf([]))).toMatchObject({
      isCoreMeeting: true,
      notebook: { folderPageId: "core-f", space: { kind: "core" } },
    });
  });

  it("files a project's top level by space alone, with no folder id", async () => {
    await newNotebook();
    await click(button("Change folder"));
    await folderPick("projects", "p1");
    expect(text()).toContain("· Projects ▸ Atlas");
    const payload = meetingNotePayload(controller.state, inviteOf([])) as { notebook: Record<string, unknown> };
    expect(payload.notebook).not.toHaveProperty("folderPageId");
    expect(payload.notebook.space).toEqual({ kind: "project", projectId: "p1" });
  });

  it("keeps the space label until a folder is picked", async () => {
    await newNotebook([atlasGroup]);
    expect(text()).toContain("New notebook “Weekly sync” · Atlas");
    expect(meetingNotePayload(controller.state, inviteOf([])).notebook).not.toHaveProperty("folderPageId");
  });

  it("refuses the bare Lab drive, which is no folder, and keeps the picker open", async () => {
    await newNotebook();
    await click(button("Change folder"));
    await folderPick("lab", null);
    expect(text()).toContain("Pick a folder to file the notebook in.");
    expect(container.querySelector("[data-testid='folder-picker']")).not.toBeNull();
    expect(controller.state.place).toMatchObject({ kind: "new", space: { label: "General" } });
  });

  it("drops a template that belongs to the space the folder leaves", async () => {
    await newNotebook([atlasGroup]);
    await act(async () => controller.setTemplatePageId("t1"));
    await click(button("Change folder"));
    await folderPick("lab", "lab-f");
    expect(controller.state.place).toMatchObject({ templatePageId: null });
  });

  it("goes away with the X, which also drops the chosen folder", async () => {
    await newNotebook();
    await click(button("Change folder"));
    await folderPick("projects", "p1-meetings");
    await click(removeButton());
    expect(controller.state.place).toBeNull();
    await click(button("New notebook"));
    expect(text()).not.toContain("Atlas ▸ Meetings");
  });
});

describe("the Whiteboard description", () => {
  it("says it is saved next to the notes while Meeting notes is on", async () => {
    await mount({ suggest: suggestOf({ invitedGroups: [atlasGroup] }) });
    await enable();
    expect(text()).toContain("Saved next to the notes.");
    expect(text()).not.toContain("Meetings.");
  });

  it.each([
    ["no group", [], "General"],
    ["the Core group", [coreGroup], "Core"],
    ["one project group", [atlasGroup], "Atlas"],
  ])("names the invite space for %s while Meeting notes is off", async (_n, invitedGroups, label) => {
    await mount({ suggest: suggestOf({ invitedGroups }) });
    expect(text()).toContain(`Saved in ${label} ▸ Meetings.`);
    expect(text()).not.toContain("Saved next to the notes.");
  });
});

describe("prefetching notebook lists", () => {
  const listSpaces = () =>
    listCalls().map((u) => {
      const q = new URL(u, "http://x").searchParams;
      return `${q.get("workspaceType")}:${q.get("workspaceId") ?? ""}`;
    });

  it("fetches nothing until Meeting notes is on", async () => {
    await mount({ suggest: suggestOf() });
    expect(listCalls()).toEqual([]);
  });

  it("fetches General and each suggested chip space once, Core as workspaceType=Core", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    expect(listSpaces().sort()).toEqual(["Core:", "Lab:", "Project:p1"]);
    await act(async () => root.render(createElement(Harness, { suggest: suggestOf() })));
    expect(listCalls()).toHaveLength(3);
  });

  it("fetches only General without suggestions", async () => {
    await mount();
    await enable();
    expect(listSpaces()).toEqual(["Lab:"]);
  });

  it("hands the picker the chip space's rows the moment it opens", async () => {
    listRows = [{ id: "nb-a" }];
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Atlas"));
    expect(pickerProps!.preloaded).toEqual({ rows: [{ id: "nb-a" }], status: "ready" });
    expect(listCalls()).toHaveLength(3);
    listRows = [];
  });

  it("leaves a search across every space to the picker", async () => {
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Search notebooks"));
    expect(pickerProps!.preloaded).toBeUndefined();
  });

  it("leaves the picker to fetch when the prefetch failed", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("/api/notebooks/default")
        ? { ok: true, json: async () => defaultResult }
        : { ok: false, json: async () => ({}) },
    );
    await mount({ suggest: suggestOf() });
    await enable();
    await click(button("Atlas"));
    expect(pickerProps!.preloaded).toBeUndefined();
  });

  it("scopes the lists to the meeting being edited", async () => {
    await mount({ surface: "note", meetingId: "m9" });
    await act(async () => controller.setEnabled(true));
    expect(new URL(listCalls()[0]!, "http://x").searchParams.get("meetingId")).toBe("m9");
  });
});

describe("MeetingNoteFields when the default notebook cannot be fetched", () => {
  it("says so and leaves the picker buttons available", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    await mount({ surface: "note" });
    await act(async () => controller.setEnabled(true));
    expect(container.textContent).toContain("Couldn't pick a notebook automatically. Choose one below.");
    expect(container.textContent).toContain("Search notebooks");
  });

  it("shows no message when the fetch works", async () => {
    await mount({ surface: "note" });
    await act(async () => controller.setEnabled(true));
    expect(container.textContent).not.toContain("Couldn't pick a notebook automatically");
  });
});
