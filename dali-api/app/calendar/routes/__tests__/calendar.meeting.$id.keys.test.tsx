// @vitest-environment jsdom
//
// The check-in card and the attendance roster are siblings in the Attendance
// section, and both are keyed by the occurrence so their state doesn't carry
// across occurrences. While those two keys were identical, every re-render
// re-created the check-in card and left the node it replaced behind: React
// indexes existing keyed children by key, so the duplicate hid the card's own
// fiber from both the match and the cleanup. The card and its QR piled up down
// the page as attendance came in — in production one meeting reached nine
// copies. This drives the page through real re-renders and asserts one of each
// survives.
import { describe, it, expect, afterEach, vi } from "vitest";

// The route module pulls the whole server stack in at import time; the
// component under test needs none of it.
vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectApplicantToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/wallet-token", () => ({ walletTokensConfigured: vi.fn() }));
vi.mock("~/lib/display-scan.server", () => ({
  getActiveDisplayScan: vi.fn(),
  startDisplayScan: vi.fn(),
  stopDisplayScan: vi.fn(),
}));
vi.mock("~/rooms/lib/access.server", () => ({ isRoomBookingEnabled: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toString: vi.fn() } }));

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import CalendarMeetingPage from "../calendar.meeting.$id";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OCCURRENCE = "2026-09-30T13:00:00.000Z";

let container: HTMLDivElement;
let root: Root;

const LOADER_DATA = {
  meetingId: "meeting-1",
  meetingLabel: "AI Learning Platform — 26F Project Check-in",
  typeLabel: "Team",
  isCoreMeeting: false,
  organizerName: "Madison Dunaway",
  selectedAtIso: OCCURRENCE,
  occurrenceStart: OCCURRENCE,
  prevOccurrence: null,
  nextOccurrence: null,
  location: null,
  description: null,
  notePageId: "note-1",
  canOpenNote: true,
  whiteboardPageId: null,
  canAddWhiteboard: false,
  hasType: true,
  canAddNote: false,
  canSetProject: false,
  projectId: null,
  projectName: null,
  meetingType: "Team",
  meetingUrl: null,
  canManage: true,
  canInvite: false,
  // `busyWith: null` leaves that banner's slot empty, which is what sends this
  // section's children down React's keyed-map path. `on: true` gives the test a
  // button that re-renders the page without opening a dialog or a modal.
  ipadScan: { on: true, busyWith: null, ended: false },
  selfCheckIn: true,
  canEnableSelfCheckIn: false,
  rows: [{ userId: "u1", name: "Stephanie Xu", present: true, absenceNote: null }],
  viewerInvited: true,
  viewerPresent: true,
  checkInUrl: "https://os.test/calendar/check-in/meeting-1",
  checkInQrSvg: "<svg></svg>",
  walletConfigured: false,
  proposals: [],
};

async function mount() {
  const Stub = createRoutesStub([
    {
      path: "/calendar/meeting/:id",
      loader: () => LOADER_DATA,
      action: () => ({ ok: true }),
      Component: CalendarMeetingPage,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        DialogProvider,
        null,
        createElement(Stub, { initialEntries: ["/calendar/meeting/meeting-1"] }),
      ),
    );
  });
}

/** One per rendered CheckInPanel. */
function checkInCards() {
  return [...container.querySelectorAll("h3")].filter(
    (h) => h.textContent?.trim() === "Self check-in",
  ).length;
}

/** One per rendered AttendanceChecklist. */
function rosterNames() {
  return [...container.querySelectorAll("*")].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === "Stephanie Xu",
  ).length;
}

function ipadButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("attendance tracking from iPad"),
  );
  if (!btn) throw new Error("iPad tracking button not rendered");
  return btn as HTMLButtonElement;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("meeting page attendance section", () => {
  it("keeps one check-in card and one roster across re-renders", async () => {
    await mount();
    expect(checkInCards()).toBe(1);
    expect(rosterNames()).toBe(1);

    // A fetcher round-trip re-renders the page the way marking attendance does.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        ipadButton().click();
      });
    }

    expect(checkInCards()).toBe(1);
    expect(rosterNames()).toBe(1);
  });
});
