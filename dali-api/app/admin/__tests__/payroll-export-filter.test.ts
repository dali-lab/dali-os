import { describe, it, expect } from "vitest";
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
