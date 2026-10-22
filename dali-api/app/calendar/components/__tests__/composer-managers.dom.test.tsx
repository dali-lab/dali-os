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

async function mount(Component: () => React.ReactElement, action: (args: { request: Request }) => unknown) {
  const Stub = createRoutesStub([{ path: "/", Component, loader: () => null, action: action as never }]);
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
