// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const confirm = vi.fn();
const apply = vi.fn();
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate: vi.fn() }) }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/calendar/lib/useSeriesNotebook", () => ({ useSeriesNotebook: () => ({ apply }) }));
vi.mock("~/calendar/components/scheduling", () => ({
  ScheduleWeekGrid: () => null,
  ParticipantPicker: () => null,
  OptimalTimePills: () => null,
}));
vi.mock("~/rooms/components/RoomLocationField", () => ({ RoomLocationField: () => null }));
vi.mock("~/components/notebooks/use-note-templates", () => ({ useNoteTemplates: () => ({ templates: [] }) }));

type PickerProps = { newRow?: unknown; onPick: (nb: Record<string, unknown>) => void };
let pickerProps: PickerProps | null = null;
vi.mock("~/components/notebooks/NotebookPicker", () => ({
  NotebookPicker: (props: PickerProps) => {
    pickerProps = props;
    return null;
  },
}));

const { EditMeetingModal } = await import("~/calendar/components/EditMeetingModal");

const editContext = {
  viewer: { userId: "me", timezone: "America/New_York", workingHours: [], workingHoursEnabled: false },
  meeting: {
    id: "m1",
    title: "Weekly sync",
    startTime: "2026-10-20T14:00:00.000Z",
    durationMinutes: 60,
    recurrenceRule: "FREQ=WEEKLY",
    location: null,
    roomIds: [],
    description: null,
    scopeType: "Group",
    groupId: "g-atlas",
    participantUserIds: ["u1"],
    guestEmails: [],
    googleSynced: false,
    organizerId: "me",
    upcoming: true,
  },
  options: {
    users: [],
    groups: [{ id: "g-atlas", name: "Atlas", memberIds: ["u1"], projectId: "p1", systemKey: null }],
  },
};

const SERIES = {
  kind: "series",
  notebook: { id: "nb1", title: "Weekly", path: "Projects ▸ Atlas ▸ Meetings" },
  newPath: "x",
};

let container: HTMLDivElement;
let root: Root;
let defaultResult: unknown;
const fetchMock = vi.fn();

const updateCall = () => fetchMock.mock.calls.find((c) => String(c[0]) === "/api/scheduled-meetings/m1/update");
const button = (text: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const removeNotebook = () => click(document.body.querySelector("[aria-label='Remove notebook']")!);
const pickNotebook = (id: string) =>
  act(async () =>
    pickerProps!.onPick({ id, title: id, path: "General", workspaceType: "Lab", workspaceId: null, parentPageId: null }),
  );

beforeEach(async () => {
  pickerProps = null;
  defaultResult = SERIES;
  confirm.mockReset().mockResolvedValue(true);
  apply.mockReset().mockResolvedValue(true);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/edit-context")) return { ok: true, json: async () => editContext };
    if (u.startsWith("/api/notebooks/default")) return { ok: true, json: async () => defaultResult };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(EditMeetingModal, { meetingId: "m1", onClose: vi.fn() })));
  await act(async () => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EditMeetingModal notebook", () => {
  it("shows the current notebook with its reason", () => {
    expect(document.body.textContent).toContain("Meeting notes");
    expect(document.body.textContent).toContain("Weekly · Projects ▸ Atlas ▸ Meetings");
    expect(document.body.textContent).toContain("this meeting's notebook");
  });

  it("offers only Remove on the notebook, then Search without a new-notebook row", async () => {
    expect(button("Change")).toBeUndefined();
    await removeNotebook();
    await click(button("Search notebooks"));
    expect(pickerProps!.newRow).toBeUndefined();
  });

  it("saves without a question or a notebook call when the notebook is untouched", async () => {
    await click(button("Save changes"));
    expect(confirm).not.toHaveBeenCalled();
    expect(updateCall()).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("confirms, saves the meeting, then points future meetings at the new notebook", async () => {
    await removeNotebook();
    await click(button("Search notebooks"));
    await pickNotebook("nb2");
    await click(button("Save changes"));
    expect(confirm).toHaveBeenCalledWith({
      title: "Change this meeting's notebook?",
      description: "Notes already taken stay where they are.",
      confirmLabel: "Change",
    });
    expect(updateCall()).toBeTruthy();
    expect(apply).toHaveBeenCalledWith("m1", "nb2", "future");
    expect(fetchMock.mock.invocationCallOrder[fetchMock.mock.calls.indexOf(updateCall()!)]).toBeLessThan(
      apply.mock.invocationCallOrder[0]!,
    );
  });

  it("changes nothing when the question is declined", async () => {
    confirm.mockResolvedValue(false);
    await removeNotebook();
    await click(button("Search notebooks"));
    await pickNotebook("nb2");
    await click(button("Save changes"));
    expect(updateCall()).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not ask when the pick is the series' own notebook", async () => {
    await removeNotebook();
    await click(button("Search notebooks"));
    await pickNotebook("nb1");
    await click(button("Save changes"));
    expect(confirm).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("sets the notebook for a meeting that had none", async () => {
    act(() => root.unmount());
    container.remove();
    defaultResult = { kind: "new", notebook: null, newPath: "General" };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(EditMeetingModal, { meetingId: "m1", onClose: vi.fn() })));
    await act(async () => {});
    expect(document.body.textContent).toContain("Pick where the notes go");
    await click(button("Search notebooks"));
    await pickNotebook("nb3");
    await click(button("Save changes"));
    expect(apply).toHaveBeenCalledWith("m1", "nb3", "future");
  });
});
