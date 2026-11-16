// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("~/hiring/components/cycle-setup/ReviewerPoolCard", () => ({ ReviewerPoolCard: () => <div data-testid="pool" /> }));
vi.mock("~/hiring/components/cycle-setup/DomainRosterCard", () => ({
  DomainRosterCard: ({ title, description, people }: { title: string; description: string; people: { name: string }[] }) => (
    <div data-testid={`roster-${title}`}>
      <p>{description}</p>
      {people.map((p) => (
        <span key={p.name}>{p.name}</span>
      ))}
    </div>
  ),
}));

import { renderDom } from "~/test-utils/render";
import { ReviewTab } from "../ReviewTab";

type Props = Parameters<typeof ReviewTab>[0];

const cycle = {
  applicants: "Students",
  domains: [
    { domainId: "d1", domain: { name: "Design", displayName: null } },
    { domainId: "d2", domain: { name: "Web", displayName: null } },
  ],
};

function mount(over: Partial<Props> & { memberSetup?: object | null } = {}) {
  const { memberSetup = null, ...rest } = over;
  const data = {
    cycle,
    memberSetup,
    phaseStatusByDomain: { d1: { reviews: { assigned: 3, submitted: 2 } }, d2: { reviews: { assigned: 0, submitted: 0 } } },
  } as unknown as Props["data"];
  return renderDom(
    <ReviewTab
      data={data}
      members={[]}
      reviewers={[]}
      interviewers={[]}
      interviewWindowSet={false}
      viewRoundId="interview-1"
      hasInterviews={false}
      onAddReviewer={vi.fn()}
      onRemoveReviewer={vi.fn()}
      onAddInterviewer={vi.fn()}
      onRemoveInterviewer={vi.fn()}
      {...rest}
    />,
  );
}

describe("ReviewTab", () => {
  it("lists reviewers by name with the per-domain review progress", () => {
    const { container } = mount({
      reviewers: [{ id: "r1", user: { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" }, domain: { id: "d1", name: "Design" } }],
    });
    expect(container.querySelector('[data-testid="roster-Reviewers"]')?.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("2 of 3 submitted");
    expect(container.textContent).toContain("No reviews assigned");
  });

  it("shows the reviewer pool instead of the roster on member cycles", () => {
    const { container } = mount({ memberSetup: { reviewerPool: [], members: [] } });
    expect(container.querySelector('[data-testid="pool"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="roster-Reviewers"]')).toBeNull();
  });

  it("shows the interviewer roster only when the cycle has interviews", () => {
    const without = mount();
    expect(without.container.querySelector('[data-testid="roster-Interviewers"]')).toBeNull();
    without.unmount();
    const withInterviews = mount({ hasInterviews: true });
    expect(withInterviews.container.querySelector('[data-testid="roster-Interviewers"]')?.textContent).toContain(
      "Free time shows once the interview window is set.",
    );
  });

  it("counts interviewers with free time once the window is set", () => {
    const interviewers = [
      { id: "i1", userId: "u1", domainId: "d1", user: { firstName: "Alan", lastName: "Turing", daliEmail: null }, domain: { id: "d1", name: "Design" }, availabilityHours: 4 },
      { id: "i2", userId: "u2", domainId: "d1", user: { firstName: "Edsger", lastName: "Dijkstra", daliEmail: null }, domain: { id: "d1", name: "Design" }, availabilityHours: 0 },
    ];
    const { container } = mount({ hasInterviews: true, interviewWindowSet: true, interviewers });
    expect(container.querySelector('[data-testid="roster-Interviewers"]')?.textContent).toContain("1 of 2 have free time on their calendar.");
  });
});
