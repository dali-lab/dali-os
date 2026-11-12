// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createRoutesStub } from "react-router";
import { renderDom } from "~/test-utils/render";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { ReviewerAssignmentCell } from "../ReviewerAssignmentCell";
import type { CycleReviewerRow } from "../table-shared";

const now = new Date("2026-11-01T00:00:00.000Z");
const cycleReviewers: CycleReviewerRow[] = [
  {
    id: "cr1",
    createdAt: now,
    updatedAt: now,
    userId: "u9",
    applicationCycleId: "c1",
    domainId: "d1",
    user: { id: "u9", daliEmail: null, firstName: "Grace", lastName: "Hopper" },
  },
];

function mount(editable: boolean) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ReviewerAssignmentCell domainApplicationId="da1" reviews={[]} cycleReviewers={cycleReviewers} editable={editable} />
      ),
    },
  ]);
  return renderDom(
    <ToastProvider>
      <DialogProvider>
        <Stub />
      </DialogProvider>
    </ToastProvider>,
  );
}

describe("ReviewerAssignmentCell", () => {
  it("offers an add control when editable", () => {
    const { container } = mount(true);
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("has no controls when read-only", () => {
    const { container } = mount(false);
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});
