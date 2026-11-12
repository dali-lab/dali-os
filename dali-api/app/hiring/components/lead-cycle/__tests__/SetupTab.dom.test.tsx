// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => <div data-testid={name} /> }));
vi.mock("~/hiring/components/cycle-setup/TermDatesCard", () => ({ TermDatesCard: stub("term-dates") }));
vi.mock("~/hiring/components/cycle-setup/AudienceCard", () => ({ AudienceCard: stub("audience") }));
vi.mock("~/hiring/components/cycle-setup/ApplicationEventsCard", () => ({ ApplicationEventsCard: stub("events") }));
vi.mock("~/hiring/components/cycle-setup/TimelineCard", () => ({ TimelineCard: stub("timeline") }));
vi.mock("~/hiring/components/cycle-setup/TargetDomainsCard", () => ({ TargetDomainsCard: stub("target-domains") }));
vi.mock("~/hiring/components/ConfidentialityAgreementPicker", () => ({ ConfidentialityAgreementPicker: stub("confidentiality") }));
vi.mock("~/hiring/components/lead-cycle/CloseDateCard", () => ({ CloseDateCard: stub("extension") }));
vi.mock("~/hiring/components/lead-cycle/DomainOverridePanel", () => ({ DomainOverridePanel: ({ domain }: { domain: { domainId: string } }) => <div data-testid={`domain-${domain.domainId}`} /> }));
vi.mock("~/hiring/components/lead-cycle/CycleFormSettings", () => ({
  BlindReviewToggle: stub("blind"),
  CycleFormRow: stub("form-row"),
  GeneralApplicationSection: stub("general"),
}));
vi.mock("~/hiring/components/lead-cycle/EmailStatusSection", () => ({
  DECISION_EMAIL_SLOTS: [],
  NOTIFICATION_EMAIL_SLOTS: [],
  LATER_INTERVIEW_INVITE_EMAIL_SLOT: {},
  CONTINUED_INTEREST_EMAIL_SLOT: {},
  EmailStatusSection: ({ title }: { title: string }) => <div data-testid={`emails-${title}`} />,
}));

import { createMemoryRouter, RouterProvider } from "react-router";
import { renderDom } from "~/test-utils/render";
import { SetupTab } from "../SetupTab";

type Props = Parameters<typeof SetupTab>[0];

function data(overrides: { applicants: string; closeDate: Date | null; memberSetup: object | null; domains?: { domainId: string }[] }): Props["data"] {
  return {
    cycle: {
      id: "c1",
      applicants: overrides.applicants,
      closeDate: overrides.closeDate,
      hasChallenges: false,
      domains: overrides.domains ?? [],
      domainChallengeForms: [],
      statusUpdates: [],
    },
    memberSetup: overrides.memberSetup,
    allForms: [],
    allDomains: [],
    termOptions: [],
    hiringEvents: [],
  } as unknown as Props["data"];
}

function mount(d: Props["data"]) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: <SetupTab data={d} cycleStatus="Draft" timeline={{ blocks: [] } as unknown as Props["timeline"]} hasInterviews={false} hasLaterInterviewRounds={false} />,
    },
  ]);
  return renderDom(<RouterProvider router={router} />);
}

describe("SetupTab", () => {
  it("shows the extension card only once a close date is set", () => {
    const without = mount(data({ applicants: "Students", closeDate: null, memberSetup: null }));
    expect(without.container.querySelector('[data-testid="extension"]')).toBeNull();
    without.unmount();

    const withDate = mount(data({ applicants: "Students", closeDate: new Date("2026-12-01"), memberSetup: null }));
    expect(withDate.container.querySelector('[data-testid="extension"]')).not.toBeNull();
  });

  it("lists each domain with an add-domain control on a Students cycle", () => {
    const { container } = mount(data({ applicants: "Students", closeDate: null, memberSetup: null, domains: [{ domainId: "d1" }, { domainId: "d2" }] }));
    expect(container.querySelector('[data-testid="domain-d1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="domain-d2"]')).not.toBeNull();
    expect(container.textContent).toContain("Add domain");
  });

  it("says there are no domains yet when a Students cycle has none", () => {
    const { container } = mount(data({ applicants: "Students", closeDate: null, memberSetup: null }));
    expect(container.textContent).toContain("No domains added yet.");
  });

  it("hides per-domain setup for a lab members cycle and shows the applicant pool", () => {
    const { container } = mount(data({ applicants: "LabMembers", closeDate: null, memberSetup: { eligibleDomains: [] }, domains: [{ domainId: "d1" }] }));
    expect(container.textContent).toContain("Applicant pool");
    expect(container.querySelector('[data-testid="domain-d1"]')).toBeNull();
    expect(container.textContent).not.toContain("Add domain");
  });

  it("uses the target domains card on an interns cycle", () => {
    const { container } = mount(data({ applicants: "Interns", closeDate: null, memberSetup: { eligibleDomains: [] } }));
    expect(container.querySelector('[data-testid="target-domains"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="domain-d1"]')).toBeNull();
  });

  it("offers the continued interest form only on Students cycles", () => {
    const students = mount(data({ applicants: "Students", closeDate: null, memberSetup: null }));
    expect(students.container.textContent).toContain("Continued interest");
    students.unmount();
    const interns = mount(data({ applicants: "Interns", closeDate: null, memberSetup: { eligibleDomains: [] } }));
    expect(interns.container.textContent).not.toContain("Continued interest");
  });
});
