import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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
    domains: [{ id: "d1", name: "Mobile", expectedMembers: 0 }],
    targetTerms: [{ id: "t1", code: "26F" }],
    nextStep: null,
    nextStepDueAt: null,
    feeCents: null,
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
    createElement(
      MemoryRouter,
      null,
      createElement(PartnerCard, {
        card: c,
        accentEdge: "#ff0000",
        staleDays,
        isDragging: false,
        onOpen: () => {},
      }),
    ),
  );
}

/** The visible text of each labeled row, as "Label: value". */
function fields(html: string): string[] {
  return [...html.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(
    ([, dt, dd]) => `${dt}: ${dd.split(/<[^>]*>/).join("")}`,
  );
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe("PartnerCard", () => {
  it("renders title, contact and org", () => {
    const html = render(card());
    expect(html).toContain('data-testid="partner-card"');
    expect(html).toContain("Gallery kiosk");
    expect(html).toContain("Ada Lovelace · Acme Co");
  });

  it("labels the source, term and domain instead of chips", () => {
    expect(fields(render(card()))).toEqual(["Source: Application form", "Term: 26F", "Domain: Mobile"]);
  });

  it("names every source in words", () => {
    expect(fields(render(card({ source: "Email" })))[0]).toBe("Source: Email");
    expect(fields(render(card({ source: "Referral" })))[0]).toBe("Source: Referral");
    expect(fields(render(card({ source: "Manual" })))[0]).toBe("Source: Added by Core");
    expect(fields(render(card({ source: "Renewal" })))[0]).toBe("Source: Renewal");
  });

  it("renders no icon for the source", () => {
    expect(render(card())).not.toContain("<svg");
  });

  it("pluralizes and joins several terms and domains", () => {
    const f = fields(
      render(
        card({
          targetTerms: [{ id: "t1", code: "26F" }, { id: "t2", code: "27W" }],
          domains: [{ id: "d1", name: "Design", expectedMembers: 0 }, { id: "d2", name: "Engineering", expectedMembers: 0 }],
        }),
      ),
    );
    expect(f).toContain("Terms: 26F, 27W");
    expect(f).toContain("Domains: Design, Engineering");
  });

  it("labels the headcount row Spots and spells domains out", () => {
    const f = fields(
      render(
        card({
          domains: [
            { id: "d1", name: "Engineering", expectedMembers: 2 },
            { id: "d2", name: "Design", expectedMembers: 1 },
          ],
        }),
      ),
    );
    expect(f).toContain("Spots: Engineering 2, Design 1");
    expect(f.some((x) => x.startsWith("Domain"))).toBe(false);
  });

  it("leaves out term and domain rows when there are none", () => {
    expect(fields(render(card({ targetTerms: [], domains: [] })))).toEqual(["Source: Application form"]);
  });

  it("renders the next step with its due date, adding the year only when it differs", () => {
    const year = new Date().getUTCFullYear();
    const thisYear = render(card({ nextStep: "Send contract", nextStepDueAt: `${year}-03-01T00:00:00.000Z` }));
    const nextYear = render(card({ nextStep: "Send contract", nextStepDueAt: `${year + 1}-03-01T00:00:00.000Z` }));
    expect(fields(thisYear)).toContain("Next step: Send contract, Mar 1");
    expect(fields(nextYear)).toContain(`Next step: Send contract, Mar 1, ${year + 1}`);
  });

  it("warns on an overdue next step only", () => {
    const overdue = render(card({ nextStep: "Send contract", nextStepDueAt: days(-3) }));
    const upcoming = render(card({ nextStep: "Send contract", nextStepDueAt: days(3) }));
    expect(overdue).toContain("text-os-amber");
    expect(upcoming).not.toContain("text-os-amber");
  });

  it("counts held and requested meetings", () => {
    expect(fields(render(card({ meetingCount: 2, pendingRequestCount: 1 })))).toContain("Meetings: 2 held, 1 requested");
    expect(fields(render(card({ pendingRequestCount: 1 })))).toContain("Meetings: 1 requested");
    expect(fields(render(card({ meetingCount: 1 })))).toContain("Meetings: 1 held");
    expect(fields(render(card())).some((f) => f.startsWith("Meetings"))).toBe(false);
  });

  it("shows last activity once it passes the stale threshold", () => {
    const html = render(card({ lastActivityAt: days(-20) }), 14);
    expect(fields(html)).toContain("Last activity: 20 days ago");
    expect(html).toContain("text-os-amber");
  });

  it("does not show last activity within the threshold", () => {
    expect(render(card({ lastActivityAt: days(-2) }), 14)).not.toContain("Last activity");
  });

  it("shows when a paused application resumes", () => {
    const until = days(5);
    const label = new Date(until).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
    expect(fields(render(card({ holdUntil: until })))).toContain(`Paused: Until ${label}`);
  });

  it("does not show Paused once the hold has lifted", () => {
    expect(render(card({ holdUntil: days(-1) }))).not.toContain("Paused");
  });

  it("links the resulting project", () => {
    const html = render(card({ resultingProjectId: "proj-1" }));
    expect(fields(html)).toContain("Project: Open");
    expect(html).toContain('href="/projects/proj-1"');
  });
});
