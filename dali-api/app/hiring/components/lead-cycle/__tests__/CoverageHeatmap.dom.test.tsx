// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDom } from "~/test-utils/render";
import { CoverageHeatmap } from "../InterviewCoverage";

describe("CoverageHeatmap", () => {
  it("shows a loading state before coverage arrives", () => {
    const { container } = renderDom(<CoverageHeatmap coverage={null} />);
    expect(container.textContent).toContain("Availability coverage");
    expect(container.textContent).toContain("Loading…");
  });

  it("says there are no future slots when the window is empty", () => {
    const { container } = renderDom(
      <CoverageHeatmap coverage={{ configured: true, slots: [], timezone: "America/New_York" } as never} />,
    );
    expect(container.textContent).toContain("No future slots in the interview window.");
  });

  it("renders nothing when interviews are not configured", () => {
    const { container } = renderDom(<CoverageHeatmap coverage={{ configured: false, slots: [] } as never} />);
    expect(container.textContent).toBe("");
  });
});
