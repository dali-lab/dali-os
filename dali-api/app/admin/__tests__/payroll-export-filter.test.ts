import { describe, it, expect, vi } from "vitest";

// payrollAssignmentWhere is pure, but it lives alongside prisma-using helpers in
// payroll-export.ts, so importing the module loads ~/lib/db. Use the shared
// manual db mock (app/lib/__mocks__/db.ts) so the test doesn't need a generated
// Prisma client — matching every other db-touching test in the suite.
vi.mock("~/lib/db");

import { payrollAssignmentWhere } from "~/admin/lib/payroll-export";

describe("payrollAssignmentWhere", () => {
  it("returns just the term when no filter is given", () => {
    expect(payrollAssignmentWhere("term_1")).toEqual({ termId: "term_1" });
    expect(payrollAssignmentWhere("term_1", {})).toEqual({ termId: "term_1" });
  });

  it("treats empty filter arrays as no narrowing", () => {
    expect(
      payrollAssignmentWhere("term_1", { domainIds: [], levels: [] }),
    ).toEqual({ termId: "term_1" });
  });

  it("narrows by domain only", () => {
    expect(
      payrollAssignmentWhere("term_1", { domainIds: ["dom_pm", "dom_ux"] }),
    ).toEqual({
      termId: "term_1",
      domainId: { in: ["dom_pm", "dom_ux"] },
    });
  });

  it("narrows by level only", () => {
    expect(payrollAssignmentWhere("term_1", { levels: ["P1"] })).toEqual({
      termId: "term_1",
      level: { in: ["P1"] },
    });
  });

  it("narrows by both domain and level", () => {
    expect(
      payrollAssignmentWhere("term_1", {
        domainIds: ["dom_pm"],
        levels: ["P2", "P3"],
      }),
    ).toEqual({
      termId: "term_1",
      domainId: { in: ["dom_pm"] },
      level: { in: ["P2", "P3"] },
    });
  });
});
