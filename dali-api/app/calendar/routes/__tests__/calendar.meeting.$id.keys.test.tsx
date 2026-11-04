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
vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn(async () => null) }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/wallet-token", () => ({ walletTokensConfigured: vi.fn() }));
vi.mock("~/lib/display-scan.server", () => ({
  getActiveDisplayScan: vi.fn(),
  startDisplayScan: vi.fn(),
  stopDisplayScan: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toString: vi.fn() } }));

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
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
  proposals: [] as { id: string; proposedStartIso: string; proposerName: string }[],
};

async function mount(
  overrides: Partial<typeof LOADER_DATA> = {},
  proposalAction: (args: { request: Request }) => unknown = () => ({ ok: true }),
) {
  const Stub = createRoutesStub([
    {
      path: "/calendar/meeting/:id",
      loader: () => ({ ...LOADER_DATA, ...overrides }),
      action: () => ({ ok: true }),
      Component: CalendarMeetingPage,
    },
    { path: "/api/scheduled-meetings/:id/proposal", action: proposalAction },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(
          DialogProvider,
          null,
          createElement(Stub, { initialEntries: ["/calendar/meeting/meeting-1"] }),
        ),
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

  it("counts people checked off on the roster in the present tally", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })));
    await mount({ rows: [{ userId: "u1", name: "Stephanie Xu", present: false, absenceNote: null }] });
    expect(container.textContent).toContain("0 of 1 present");

    const checkbox = container.querySelector<HTMLInputElement>("input[type='checkbox']")!;
    await act(async () => {
      checkbox.click();
    });

    expect(container.textContent).toContain("1 of 1 present");
    vi.unstubAllGlobals();
  });
});

describe("proposed times", () => {
  const proposals = [
    { id: "p1", proposedStartIso: "2026-10-01T14:00:00.000Z", proposerName: "Ada" },
    { id: "p2", proposedStartIso: "2026-10-02T14:00:00.000Z", proposerName: "Grace" },
  ];
  const button = (label: string, index: number) =>
    [...container.querySelectorAll("button")].filter((b) => b.textContent === label)[index]!;

  it("answering one proposal does not abort another's answer still going out", async () => {
    const signals: AbortSignal[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await mount({ proposals }, async ({ request }) => {
      signals.push(request.signal);
      await gate;
      return { ok: true };
    });

    await act(async () => button("Accept", 0).click());
    await act(async () => button("Accept", 0).click());

    expect(signals).toHaveLength(2);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    release();
    await act(async () => {});
  });

  it("brings a proposal back and says why when the answer fails", async () => {
    await mount({ proposals }, () => Response.json({ error: "Already answered" }, { status: 409 }));

    await act(async () => button("Decline", 0).click());
    await act(async () => new Promise((r) => setTimeout(r, 20)));

    expect(container.textContent).toContain("Already answered");
    expect(container.textContent).toContain("Ada");
  });
});
