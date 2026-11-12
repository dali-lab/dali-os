// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDom } from "~/test-utils/render";
import { DecisionPillBadge, PrePipelinePillBadge, DECISION_TOOLTIPS } from "../DecisionPills";

describe("DecisionPills", () => {
  it.each([
    ["Draft", "Draft Accept — not yet finalized. Click Finalize to lock in."],
    ["Final", "Final Accept — decision locked. Will be released to the applicant by the hiring lead."],
    ["Released", "Released Accept — applicant has been notified."],
  ] as const)("describes a %s decision in its tooltip", (stage, text) => {
    expect(DECISION_TOOLTIPS[stage]("Accept")).toBe(text);
    const { container } = renderDom(
      <DecisionPillBadge pill={{ type: "Accepted", stage, waitlistRank: null, createdAt: new Date() }} />,
    );
    expect(container.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(text);
    expect(container.textContent).toContain(`(${stage.toLowerCase()})`);
  });

  it("shows a waitlist rank", () => {
    const { container } = renderDom(
      <DecisionPillBadge pill={{ type: "Waitlisted", stage: "Final", waitlistRank: 3, createdAt: new Date() }} />,
    );
    expect(container.textContent).toContain("#3");
  });

  it("explains the pre-pipeline pills", () => {
    const { container } = renderDom(<PrePipelinePillBadge pill="PostInterview" />);
    expect(container.textContent).toContain("Post-interview");
    expect(container.querySelector("[aria-label]")?.getAttribute("aria-label")).toContain("Waiting on final delibs");
  });
});
