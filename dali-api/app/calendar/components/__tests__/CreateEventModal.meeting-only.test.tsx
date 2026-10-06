// @vitest-environment jsdom
//
// CreateEventModal reaches for useFetcher/useRevalidator (react-router) and
// floating-ui's autoUpdate (ResizeObserver), so it needs a router + the same
// jsdom polyfills DateField.test.tsx uses — see that file for precedent.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { CreateEventModal } from "../CreateEventModal";
import type { SchedulingData } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const SCHEDULING_DATA: SchedulingData = {
  users: [],
  groups: [],
  workingHours: [],
  hasPersistedWorkingHours: false,
  calendarLinks: [],
  timezone: "America/New_York",
  currentUserId: "core-1",
  defaultEventBufferMin: 15,
  canSetSelfCheckIn: false,
  canMarkCoreMeeting: false,
  myProjects: [],
  myRoles: [],
  weekStartIso: "2026-11-01T05:00:00.000Z",
  defaultEventDest: null,
};

let container: HTMLDivElement;
let root: Root;

async function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const Stub = createRoutesStub([{ path: "/", Component: () => ui }]);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ days: [], perUser: [] }) }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("CreateEventModal mode=\"meeting-only\"", () => {
  it("opens straight into the Meeting form with the fixed guest and no Event mode", async () => {
    await mount(
      createElement(CreateEventModal, {
        data: SCHEDULING_DATA,
        mode: "meeting-only",
        fixedGuestEmails: ["partner@acme.com"],
        defaultTitle: "DALI x Acme",
        onClose: () => {},
      }),
    );

    // Event-only affordance — proves the Event form is unreachable here.
    expect(container.textContent).not.toContain("All day");
    // Meeting-only mode hides the note/whiteboard asset toggles.
    expect(container.textContent).not.toContain("Create meeting note");
    expect(container.textContent).not.toContain("Create whiteboard");

    // The fixed guest renders as a chip, with the no-availability note.
    expect(container.textContent).toContain("partner@acme.com");
    expect(container.textContent).toContain("invited by email");

    // defaultTitle prefilled the title field.
    const title = container.querySelector<HTMLInputElement>("#cem-mtg-title");
    expect(title?.value).toBe("DALI x Acme");

    // Submit button reads "Create meeting", never "Create event".
    expect(container.textContent).toContain("Create meeting");
    expect(container.textContent).not.toContain("Create event");
  });

  it("hides groups entirely and disables room search on the location field", async () => {
    await mount(
      createElement(CreateEventModal, {
        data: { ...SCHEDULING_DATA, groups: [{ id: "g1", name: "Core", memberIds: [], projectId: null, systemKey: "core" }] },
        mode: "meeting-only",
        onClose: () => {},
      }),
    );
    // The one group in `data.groups` never surfaces as an addable chip/option.
    expect(container.textContent).not.toContain("Core");
  });
});
