// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

// The hub route module pulls the server stack in at import time; the component
// under test needs none of it.
vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMentor: vi.fn(),
  currentTermPhase: vi.fn(),
}));

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import MentorshipHub from "../mentorship";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function mount(data: {
  isCore: boolean;
  phase: "in-term" | "break" | "no-terms";
  termId: string | null;
  behindCount: number;
}) {
  const Stub = createRoutesStub([
    {
      path: "/mentorship",
      loader: () => ({
        termCode: "26F",
        grid: { weeks: [], currentWeek: null, mentors: [], termSelected: true },
        breakLabel: null,
        nextTermCode: null,
        nextTermStartIso: null,
        ...data,
      }),
      Component: MentorshipHub,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(createElement(Stub, { initialEntries: ["/mentorship"] })),
  );
}

function notesLink(): HTMLAnchorElement | null {
  return container.querySelector('a[href^="/mentorship/browse"]');
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("mentorship hub notes link", () => {
  // The link into the lab-wide notes view used to ride on Core's missing-note
  // warning, so a plain mentor had no entry point to it from the hub.
  it("points a plain mentor at all notes, with no warning", async () => {
    mount({ isCore: false, phase: "in-term", termId: "t1", behindCount: 0 });
    await act(async () => {});

    expect(notesLink()?.getAttribute("href")).toBe(
      "/mentorship/browse?termId=t1",
    );
    expect(container.textContent).not.toContain("missing a note this week");
  });

  it("keeps the warning for Core when mentors are behind", async () => {
    mount({ isCore: true, phase: "in-term", termId: "t1", behindCount: 31 });
    await act(async () => {});

    expect(notesLink()?.getAttribute("href")).toBe(
      "/mentorship/browse?termId=t1",
    );
    expect(container.textContent).toContain("31");
    expect(container.textContent).toContain("missing a note this week");
  });

  // Core with everyone caught up gets the same plain link as any other mentor.
  it("drops the warning for Core when nobody is behind", async () => {
    mount({ isCore: true, phase: "in-term", termId: "t1", behindCount: 0 });
    await act(async () => {});

    expect(notesLink()).not.toBeNull();
    expect(container.textContent).not.toContain("missing a note this week");
  });

  it("offers no link when there is no term to browse", async () => {
    mount({ isCore: false, phase: "no-terms", termId: null, behindCount: 0 });
    await act(async () => {});

    expect(notesLink()).toBeNull();
  });
});
