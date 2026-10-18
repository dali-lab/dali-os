// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GroupOption, LoaderData } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const showFiledNote = vi.fn();
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), Form: "form" }),
  useRevalidator: () => ({ revalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/calendar/lib/useFiledNoteToast", () => ({ useFiledNoteToast: () => showFiledNote }));
vi.mock("~/calendar/components/scheduling", () => ({
  ScheduleWeekGrid: () => null,
  ParticipantPicker: () => null,
  OptimalTimePills: () => null,
}));
vi.mock("~/rooms/components/RoomLocationField", () => ({ RoomLocationField: () => null }));
vi.mock("~/components/notebooks/use-note-templates", () => ({ useNoteTemplates: () => ({ templates: [] }) }));
vi.mock("~/components/notebooks/NotebookPicker", () => ({ NotebookPicker: () => null }));

const { CreateEventModal } = await import("~/calendar/components/CreateEventModal");

const group = (over: Partial<GroupOption> & { id: string; name: string }): GroupOption => ({
  memberIds: ["u1", "u2"],
  projectId: null,
  systemKey: null,
  ...over,
});
const atlas = group({ id: "g-atlas", name: "Atlas", projectId: "p1" });
const core = group({ id: "g-core", name: "Core", systemKey: "core" });

const loaderData = (groups: GroupOption[]) =>
  ({
    groups,
    mentorPairs: [],
    users: [],
    calendarLinks: [],
    myRoles: [],
    currentUserId: "me",
    defaultEventDest: null,
    timezone: "America/New_York",
    workingHours: [],
    hasPersistedWorkingHours: false,
    weekStartIso: "2026-10-19T04:00:00.000Z",
  }) as unknown as LoaderData;

const SERIES = {
  kind: "series",
  notebook: { id: "nb1", title: "Weekly", path: "Projects ▸ Atlas ▸ Meetings" },
  newPath: "x",
};
const NEW_DEFAULT = { kind: "new", notebook: null, newPath: "General" };

let container: HTMLDivElement;
let root: Root;
let defaultResult: unknown;
let createResponse: Record<string, unknown>;
const fetchMock = vi.fn();

const createBody = () => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/scheduled-meetings");
  return call ? JSON.parse(call[1].body as string) : null;
};

async function mount(props: { groups: GroupOption[]; initialGroupIds?: string[]; initialUserIds?: string[] }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(CreateEventModal, {
        data: loaderData(props.groups),
        startLocal: "2026-10-20T10:00",
        endLocal: "2026-10-20T11:00",
        initialGroupIds: props.initialGroupIds,
        initialUserIds: props.initialUserIds,
        onClose: () => {},
      }),
    ),
  );
}

const checkbox = (label: string) =>
  Array.from(container.querySelectorAll("label"))
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector("input") as HTMLInputElement;
const submitButton = () =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Create meeting") as HTMLButtonElement;
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(() => {
  defaultResult = NEW_DEFAULT;
  createResponse = { ok: true, meeting: { id: "m1" }, notifiedCount: 3 };
  showFiledNote.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).startsWith("/api/notebooks/default")
      ? { ok: true, json: async () => defaultResult }
      : { ok: true, status: 201, json: async () => createResponse },
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CreateEventModal meeting notes", () => {
  it("sends the invited project and the series notebook", async () => {
    defaultResult = SERIES;
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(checkbox("Meeting notes"));
    await click(submitButton());
    expect(createBody()).toMatchObject({
      scopeType: "Group",
      groupId: "g-atlas",
      note: true,
      whiteboard: false,
      projectId: "p1",
      notebook: { existingId: "nb1" },
    });
    expect(createBody()).not.toHaveProperty("isCoreMeeting");
  });

  it("sends isCoreMeeting when the Core group is invited", async () => {
    defaultResult = SERIES;
    await mount({ groups: [core], initialGroupIds: ["g-core"] });
    await click(checkbox("Meeting notes"));
    await click(submitButton());
    expect(createBody()).toMatchObject({ isCoreMeeting: true, notebook: { existingId: "nb1" } });
    expect(createBody()).not.toHaveProperty("projectId");
  });

  it("asks the default endpoint about the invited group", async () => {
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(checkbox("Meeting notes"));
    const url = String(fetchMock.mock.calls.find((c) => String(c[0]).startsWith("/api/notebooks/default"))![0]);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("groupId")).toBe("g-atlas");
    expect(params.get("projectId")).toBe("p1");
  });

  it("keeps Create meeting disabled until a place is picked", async () => {
    await mount({ groups: [], initialUserIds: ["u1"] });
    await click(checkbox("Meeting notes"));
    expect(submitButton().disabled).toBe(true);
    expect(container.textContent).toContain("Pick where the notes go");
  });

  it("sends a new notebook's name in the invited project", async () => {
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(checkbox("Meeting notes"));
    const create = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("New notebook"),
    )!;
    await click(create);
    expect(submitButton().disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>("#meeting-notebook-name")!, "Atlas sync");
    expect(submitButton().disabled).toBe(false);
    await click(submitButton());
    expect(createBody()).toMatchObject({
      projectId: "p1",
      notebook: { title: "Atlas sync", templatePageId: null, space: { kind: "project", projectId: "p1" } },
    });
  });

  it("sends nothing about notes when they are off", async () => {
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(submitButton());
    const body = createBody();
    expect(body).not.toHaveProperty("note");
    expect(body).not.toHaveProperty("projectId");
    expect(body).not.toHaveProperty("notebook");
  });
});

describe("CreateEventModal status line", () => {
  const filedResponse = {
    ok: true,
    meeting: { id: "m1" },
    notifiedCount: 3,
    notePageId: "n1",
    notebookId: "nb1",
    createdNotebook: false,
    notePath: { label: "Projects ▸ Atlas ▸ Meetings ▸ Weekly", href: "/documents/n1" },
  };

  async function createWithNote() {
    defaultResult = SERIES;
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(checkbox("Meeting notes"));
    await click(submitButton());
  }

  it("names the notebook and space with an Open link, then the participants", async () => {
    createResponse = filedResponse;
    await createWithNote();
    const status = container.querySelector("p.text-os-green")!;
    expect(status.textContent).toBe("Meeting created. Note in Weekly (Atlas). Open. Notified 3 participants.");
    expect(status.querySelector("a")!.getAttribute("href")).toBe("/documents/n1");
  });

  it("offers Undo on the toast", async () => {
    createResponse = filedResponse;
    await createWithNote();
    expect(showFiledNote).toHaveBeenCalledWith(expect.objectContaining({ notePageId: "n1" }), { undo: true });
  });

  it("keeps the plain line when no note was filed", async () => {
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(submitButton());
    expect(container.querySelector("p.text-os-green")!.textContent).toBe("Meeting created. Notified 3 participants.");
  });

  it("uses the singular for one participant", async () => {
    createResponse = { ok: true, meeting: { id: "m1" }, notifiedCount: 1 };
    await mount({ groups: [atlas], initialGroupIds: ["g-atlas"] });
    await click(submitButton());
    expect(container.querySelector("p.text-os-green")!.textContent).toBe("Meeting created. Notified 1 participant.");
  });
});
