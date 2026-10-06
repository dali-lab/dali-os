import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PartnerCard } from "../PartnerCard";
import type { PartnerCardModel } from "../../lib/partner-board";

function card(overrides: Partial<PartnerCardModel> = {}): PartnerCardModel {
  return {
    id: "a",
    title: "Gallery kiosk",
    stage: "New",
    status: "New",
    position: 0,
    contactName: "Ada Lovelace",
    orgName: "Acme Co",
    domains: [{ id: "d1", name: "Mobile" }],
    targetTerms: [{ id: "t1", code: "26F" }],
    nextStep: null,
    nextStepDueAt: null,
    lastActivityAt: new Date().toISOString(),
    holdUntil: null,
    resultingProjectId: null,
    meetingRequestedAt: null,
    pendingRequestCount: 0,
    meetingCount: 0,
    source: "Form",
    hasUnreadEmail: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function render(c: PartnerCardModel, staleDays = 14) {
  return renderToStaticMarkup(
    createElement(PartnerCard, {
      card: c,
      accentEdge: "#ff0000",
      staleDays,
      isDragging: false,
      onOpen: () => {},
    }),
  );
}

describe("PartnerCard", () => {
  it("renders title, contact, org, domain and term chips", () => {
    const html = render(card());
    expect(html).toContain('data-testid="partner-card"');
    expect(html).toContain("Gallery kiosk");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Acme Co");
    expect(html).toContain("Mobile");
    expect(html).toContain("26F");
  });

  it("shows a Stale chip once lastActivityAt passes the threshold", () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    const html = render(card({ lastActivityAt: old }), 14);
    expect(html).toContain("Stale 20d");
  });

  it("does not show Stale when within the threshold", () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const html = render(card({ lastActivityAt: recent }), 14);
    expect(html).not.toContain("Stale");
  });

  it("shows Paused when holdUntil is in the future", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const html = render(card({ holdUntil: future }));
    expect(html).toContain("Paused");
  });

  it("shows a Project chip when resultingProjectId is set", () => {
    const html = render(card({ resultingProjectId: "proj-1" }));
    expect(html).toContain("Project");
  });

  it('shows "Meeting requested" when pendingRequestCount > 0', () => {
    const html = render(card({ pendingRequestCount: 1 }));
    expect(html).toContain("Meeting requested");
  });

  it("renders the next step with its due date", () => {
    const html = render(
      card({ nextStep: "Send contract", nextStepDueAt: "2026-03-01T00:00:00.000Z" }),
    );
    expect(html).toContain("Send contract");
    expect(html).toContain("Mar 1");
  });
});
