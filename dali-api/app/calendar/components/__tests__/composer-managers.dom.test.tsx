// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import type { LoaderData } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/calendar/components/scheduling", () => ({ ParticipantPicker: () => null }));

const { CalendarManagerModal, ClassesManagerBody } = await import("~/calendar/components/composer");

let container: HTMLDivElement;
let root: Root;

async function mount(
  Component: () => React.ReactElement,
  action: (args: { request: Request }) => unknown,
  extraRoutes: Parameters<typeof createRoutesStub>[0] = [],
) {
  const Stub = createRoutesStub([{ path: "/", Component, loader: () => null, action: action as never }, ...extraRoutes]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/"] })),
      ),
    ),
  );
  await act(async () => {});
}

let release: () => void;
const gated = (result: unknown = null) => async () => {
  await new Promise<void>((r) => (release = r));
  return result;
};
const submitForm = (selector: string) =>
  act(async () => container.querySelector<HTMLFormElement>(selector)!.requestSubmit());
const confirmDialog = (label: string) =>
  act(async () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label)!.click(),
  );

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CalendarManagerModal", () => {
  const data = {
    calendarLinks: [
      {
        id: "l1",
        provider: "Google",
        externalEmail: "a@x.edu",
        displayName: null,
        subCalendars: [
          { id: "c1", summary: "Work", primary: false, color: null, enabled: true, writable: true },
          { id: "c2", summary: "Home", primary: false, color: null, enabled: true, writable: true },
        ],
      },
    ],
  } as unknown as LoaderData;

  it("shows a rename failure on that calendar, not in the new calendar form", async () => {
    await mount(
      () => createElement(CalendarManagerModal, { data, onClose: () => {} }),
      async () => ({ error: "Google refused the rename" }),
    );
    await act(async () => byLabel("Rename Work").click());
    await act(async () =>
      container.querySelector<HTMLFormElement>("form:has(input[value='cal-rename'])")!.requestSubmit(),
    );
    await sleep(50);

    const message = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Google refused the rename"),
    )!;
    expect(message).toBeTruthy();
    expect(message.closest("form:has(input[value='cal-create'])")).toBeNull();
  });
});

describe("ManagedCalendarRow while a write is in flight", () => {
  const data = {
    calendarLinks: [
      {
        id: "l1",
        provider: "Google",
        externalEmail: "a@x.edu",
        displayName: null,
        subCalendars: [
          { id: "c1", summary: "Work", primary: false, color: null, enabled: true, writable: true },
          { id: "c2", summary: "Home", primary: false, color: null, enabled: true, writable: true },
        ],
      },
    ],
  } as unknown as LoaderData;
  const modal = () => createElement(CalendarManagerModal, { data, onClose: () => {} });

  it("shows the new name and closes the field the moment rename is saved", async () => {
    await mount(modal, gated());
    await act(async () => byLabel("Rename Work").click());
    const input = container.querySelector<HTMLInputElement>("input[name='summary']")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Office");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submitForm("form:has(input[value='cal-rename'])");

    expect(container.querySelector("form:has(input[value='cal-rename'])")).toBeNull();
    expect(container.textContent).toContain("Office");
    await act(async () => release());
  });

  it("opens the field again with the error when the rename fails", async () => {
    await mount(modal, gated({ error: "Google refused the rename" }));
    await act(async () => byLabel("Rename Work").click());
    await submitForm("form:has(input[value='cal-rename'])");
    await act(async () => release());
    await sleep(20);

    expect(container.querySelector("form:has(input[value='cal-rename'])")).not.toBeNull();
    expect(container.textContent).toContain("Google refused the rename");
  });

  it("hides a calendar being deleted and brings it back if the delete fails", async () => {
    await mount(modal, gated({ error: "Google refused the delete" }));
    await act(async () => byLabel("Delete Work").click());
    await confirmDialog("Delete calendar");

    expect(byLabel("Delete Work")).toBeNull();
    expect(byLabel("Delete Home")).not.toBeNull();
    await act(async () => release());
    await sleep(20);
    expect(byLabel("Delete Work")).not.toBeNull();
    expect(container.textContent).toContain("Google refused the delete");
  });
});

describe("ClassesManagerBody", () => {
  const cls = (id: string) => ({
    id,
    title: `Class ${id}`,
    periodCode: null,
    meetings: [],
    location: null,
    storage: "Local",
    linkId: null,
    calendarId: null,
    destinationLabel: "In DALI only",
    termId: "t1",
    offeringCrn: `crn-${id}`,
    subject: null,
    courseNumber: null,
    section: null,
  });
  const data = {
    classTerm: { id: "t1", code: "26F" },
    classTerms: [{ id: "t1", code: "26F" }],
    classDestinations: [],
    memberClasses: [cls("a"), cls("b")],
  } as unknown as LoaderData;

  it("disables only the refresh button of the class being refreshed", async () => {
    await mount(
      () => createElement(ClassesManagerBody, { data }),
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        return null;
      },
    );
    await act(async () => byLabel("Update Class a from the timetable").click());
    expect(byLabel("Update Class a from the timetable").disabled).toBe(true);
    expect(byLabel("Update Class b from the timetable").disabled).toBe(false);
    await sleep(300);
  });
});

describe("ClassesManagerBody while a write is in flight", () => {
  const cls = (id: string) => ({
    id,
    title: `Class ${id}`,
    periodCode: null,
    meetings: [],
    location: null,
    storage: "Local",
    linkId: null,
    calendarId: null,
    destinationLabel: "In DALI only",
    termId: "t1",
    offeringCrn: null,
    subject: null,
    courseNumber: null,
    section: null,
  });
  const data = {
    classTerm: { id: "t1", code: "26F" },
    classTerms: [{ id: "t1", code: "26F" }],
    classDestinations: [{ kind: "local", label: "In DALI only" }],
    memberClasses: [cls("a"), cls("b")],
  } as unknown as LoaderData;
  const hit = (crn: string) => ({
    crn,
    subject: "COSC",
    number: "052",
    section: "01",
    title: `Course ${crn}`,
    periodCode: "10",
    periodText: null,
    building: null,
    room: null,
    instructor: null,
    crosslist: null,
    distributive: null,
    enrollLimit: null,
    enrollCurrent: null,
  });

  it("hides a class being removed and brings it back if the removal fails", async () => {
    await mount(() => createElement(ClassesManagerBody, { data }), gated({ error: "Google refused" }));
    await act(async () => byLabel("Remove Class a").click());
    await confirmDialog("Remove class");

    expect(byLabel("Remove Class a")).toBeNull();
    expect(byLabel("Remove Class b")).not.toBeNull();
    await act(async () => release());
    await sleep(20);
    expect(byLabel("Remove Class a")).not.toBeNull();
  });

  it("marks several quick-added sections as Added while their requests are still out", async () => {
    await mount(
      () => createElement(ClassesManagerBody, { data }),
      gated(),
      [{ path: "/api/timetable/courses", loader: () => ({ courses: [hit("1"), hit("2")] }) }],
    );
    const search = container.querySelector<HTMLInputElement>("input[placeholder^='Search the timetable']")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(search, "COSC");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(400);

    const addButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button[title='Add this class now']"));
    expect(addButtons()).toHaveLength(2);
    await act(async () => addButtons()[0]!.click());
    expect(addButtons()).toHaveLength(1);
    await act(async () => addButtons()[0]!.click());
    expect(addButtons()).toHaveLength(0);
    expect(container.textContent?.match(/Added/g)).toHaveLength(2);
    await act(async () => release());
  });
});
