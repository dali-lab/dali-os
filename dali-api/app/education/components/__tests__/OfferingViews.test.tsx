import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "America/New_York" }));
vi.mock("~/education/components/OfferingApplyForm", () => ({ OfferingApplyForm: () => createElement("div", null, "apply-form") }));
vi.mock("~/education/components/OfferingCard", () => ({
  TypeBadge: () => createElement("span", null, "type"),
  MyStatusChip: () => createElement("span", null, "status"),
}));
vi.mock("~/education/components/AssignmentWorkArea", () => ({ AssignmentWorkArea: () => createElement("div", null, "work") }));
vi.mock("~/education/components/MaterialPageBody", () => ({ MaterialPageBody: () => createElement("div", null, "body") }));
vi.mock("~/education/components/CourseHub", () => ({
  CourseHub: ({ basePath }: { basePath: string }) => createElement("div", null, `hub:${basePath}`),
}));

import { MEMBER_SURFACE, PORTAL_SURFACE } from "~/education/lib/offering-surface";
import { ApplyView } from "../ApplyView";
import { AssignmentView } from "../AssignmentView";
import { OfferingPageView } from "../OfferingPageView";
import { OfferingHubView } from "../OfferingHubView";

const html = (el: React.ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el));

const offering = { id: "o1", title: "Intro", type: "Course" as never, requiresReview: true };

describe("ApplyView", () => {
  const base = { offering, open: false, myStatus: null, questions: [], description: null };

  it("keeps the member frame and has no back link", () => {
    const out = html(createElement(ApplyView, { ...base, surface: MEMBER_SURFACE }));
    expect(out).toContain("max-w-2xl");
    expect(out).toContain("text-2xl font-bold");
    expect(out).toContain("bg-card border border-border");
    expect(out).not.toContain("Back to offering");
  });

  it("keeps the portal frame and links back under the portal base", () => {
    const out = html(createElement(ApplyView, { ...base, surface: PORTAL_SURFACE }));
    expect(out).toContain("text-4xl font-medium");
    expect(out).toContain("bg-os-card rounded-os-card");
    expect(out).toContain('href="/portal/education/o1"');
  });

  it("shows the form when open", () => {
    expect(html(createElement(ApplyView, { ...base, open: true, surface: MEMBER_SURFACE }))).toContain("apply-form");
  });
});

describe("AssignmentView", () => {
  const props = {
    offeringId: "o1",
    assignment: { title: "Essay", dueAt: null } as never,
    submission: null,
    canSubmit: true,
    collabToken: null,
    userName: "Ada",
  };

  it("links back under the portal base only on the portal", () => {
    expect(html(createElement(AssignmentView, { ...props, surface: PORTAL_SURFACE }))).toContain(
      'href="/portal/education/o1/hub?tab=assignments"',
    );
    const member = html(createElement(AssignmentView, { ...props, surface: MEMBER_SURFACE }));
    expect(member).not.toContain("← Assignments");
    expect(member).toContain("text-2xl font-bold");
    expect(member).toContain("No due date");
  });
});

describe("OfferingPageView", () => {
  const props = {
    offeringId: "o1",
    page: { id: "p1", title: "Notes", studentEditable: false, content: null },
    collabToken: null,
    userName: "Ada",
  };

  it("shows the editor link only to managers on the member surface", () => {
    const manager = html(createElement(OfferingPageView, { ...props, surface: MEMBER_SURFACE, isManager: true }));
    expect(manager).toContain("Open in editor");
    expect(html(createElement(OfferingPageView, { ...props, surface: MEMBER_SURFACE, isManager: false }))).not.toContain("Open in editor");
  });

  it("shows the portal timeline link", () => {
    const out = html(createElement(OfferingPageView, { ...props, surface: PORTAL_SURFACE, isManager: false }));
    expect(out).toContain('href="/portal/education/o1/hub?tab=sessions"');
    expect(out).toContain("← Timeline");
  });
});

describe("OfferingHubView", () => {
  const hub = { offering: { id: "o1", title: "Intro" }, isManager: true } as never;

  it("passes each surface's base path to the hub", () => {
    expect(html(createElement(OfferingHubView, { surface: MEMBER_SURFACE, hub, collabToken: null, previewAsStudent: false }))).toContain("hub:/education/o1");
    expect(html(createElement(OfferingHubView, { surface: PORTAL_SURFACE, hub, collabToken: null, previewAsStudent: false }))).toContain("hub:/portal/education/o1");
  });

  it("gives managers the member-only controls and the preview exit pill", () => {
    const member = html(createElement(OfferingHubView, { surface: MEMBER_SURFACE, hub, collabToken: null, previewAsStudent: true }));
    expect(member).toContain("Student view");
    expect(member).toContain('href="/education/manage/o1"');
    expect(member).toContain("Viewing as a student");
    const portal = html(createElement(OfferingHubView, { surface: PORTAL_SURFACE, hub, collabToken: null, previewAsStudent: true }));
    expect(portal).not.toContain("Student view");
    expect(portal).toContain("← Offering details");
  });
});
