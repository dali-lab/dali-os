import { describe, it, expect } from "vitest";
import {
  collate,
  type CollationEntry,
  type CollationInput,
  type CollationLookup,
  type CollationUser,
  type CollationAssignment,
  type CollationProject,
} from "~/admin-console/lib/payroll-collation";

// Fully synthetic fixtures: famous computer scientists, f00fake* netids.
// The four jobCodes are the real DALI Dartmouth Job IDs (public identifiers);
// everything person-shaped is invented.

const LOOKUPS: CollationLookup[] = [
  // 4834 maps to BOTH P1 and P2 (real shape — no unique on jobCode).
  { jobCode: "4834", assignmentType: "Project", level: "P1", payRateUsdHour: 16.25 },
  { jobCode: "4834", assignmentType: "Project", level: "P2", payRateUsdHour: 17.0 },
  { jobCode: "4889", assignmentType: "Project", level: "P3", payRateUsdHour: 18.0 },
  { jobCode: "4890", assignmentType: "Core", level: null, payRateUsdHour: 20.0 },
  { jobCode: "7523", assignmentType: "Instructor", level: null, payRateUsdHour: 19.0 },
];

const USERS: CollationUser[] = [
  { netId: "f00fake1", firstName: "Ada", lastName: "Lovelace" },
  { netId: "f00fake2", firstName: "Grace", lastName: "Hopper" },
  { netId: "f00fake3", firstName: "Alan", lastName: "Turing" },
  { netId: "f00fake4", firstName: "Margaret", lastName: "Hamilton" },
];

const PROJ_A: CollationProject = {
  id: "proj-a",
  name: "Analytical Engine",
  chartString: "18.722.161028.128512.4000",
};
const PROJ_B: CollationProject = {
  id: "proj-b",
  name: "Compiler Corps",
  chartString: "18.722.161028.128512.5000",
};

const ASSIGN_ADA_A: CollationAssignment = {
  netId: "f00fake1",
  projectId: "proj-a",
  projectName: "Analytical Engine",
  projectChartString: PROJ_A.chartString,
};
const ASSIGN_GRACE_A: CollationAssignment = {
  netId: "f00fake2",
  projectId: "proj-a",
  projectName: "Analytical Engine",
  projectChartString: PROJ_A.chartString,
};
const ASSIGN_GRACE_B: CollationAssignment = {
  netId: "f00fake2",
  projectId: "proj-b",
  projectName: "Compiler Corps",
  projectChartString: PROJ_B.chartString,
};
const ASSIGN_MARGARET_B: CollationAssignment = {
  netId: "f00fake4",
  projectId: "proj-b",
  projectName: "Compiler Corps",
  projectChartString: PROJ_B.chartString,
};

function entry(o: Partial<CollationEntry> = {}): CollationEntry {
  return {
    employeeNetId: "f00fake1",
    employeeName: "Lovelace, Ada",
    jobId: "4834",
    jobTitle: "DALI Lab Student Employee",
    chartString: "18.722.161028.128512.4000",
    totalShiftTime: 2,
    hourlyPayRate: 16.25,
    totalEarnings: 32.5,
    ...o,
  };
}

function run(overrides: Partial<CollationInput> = {}) {
  return collate({
    entries: [],
    lookups: LOOKUPS,
    users: USERS,
    assignments: [ASSIGN_ADA_A],
    projects: [PROJ_A, PROJ_B],
    isActiveTerm: true,
    ...overrides,
  });
}

describe("jobId classification", () => {
  it("classifies the four real DALI job ids and routes unknown ids to External", () => {
    const result = run({
      entries: [
        entry({ jobId: "4834", totalShiftTime: 1, totalEarnings: 16.25 }),
        entry({ jobId: "4889", totalShiftTime: 1, totalEarnings: 18 }),
        entry({ jobId: "4890", totalShiftTime: 1, totalEarnings: 20 }),
        entry({ jobId: "7523", totalShiftTime: 1, totalEarnings: 19 }),
        // Unknown (Makerspace-style) id → External.
        entry({ jobId: "4762", totalShiftTime: 1, totalEarnings: 15 }),
      ],
    });

    // 4834 + 4889 are Project-category → attributed to ada's project.
    const projA = result.projects.find((p) => p.projectId === "proj-a")!;
    expect(projA.jobs.map((j) => j.jobId).sort()).toEqual(["4834", "4889"]);
    expect(result.core.jobs.map((j) => j.jobId)).toEqual(["4890"]);
    expect(result.instructor.jobs.map((j) => j.jobId)).toEqual(["7523"]);
    expect(result.external.jobs.map((j) => j.jobId)).toEqual(["4762"]);
  });

  it("collects ALL lookup rows for a jobCode (4834 → P1+P2 still classifies as Project)", () => {
    const result = run({
      entries: [entry({ jobId: "4834" })],
    });
    expect(result.projects).toHaveLength(1);
    expect(result.external.jobs).toHaveLength(0);
  });
});

describe("pay and hours math", () => {
  it("pay = Σ totalEarnings directly, NEVER wage × hours", () => {
    const result = run({
      entries: [
        // Earnings deliberately inconsistent with rate × hours.
        entry({ totalShiftTime: 2, hourlyPayRate: 16.25, totalEarnings: 40 }),
        entry({ totalShiftTime: 3, hourlyPayRate: 16.25, totalEarnings: 45 }),
      ],
    });
    const projA = result.projects[0];
    expect(projA.totalHours).toBe(5);
    expect(projA.totalPay).toBe(85); // 40 + 45, not 16.25 × 5 = 81.25
    expect(result.summary.daliPay).toBe(85);
    expect(result.summary.daliHours).toBe(5);
  });
});

describe("shared-hours fan-out", () => {
  it("fans a multi-project person's job out to every assigned project with sharedWith", () => {
    const result = run({
      assignments: [ASSIGN_GRACE_A, ASSIGN_GRACE_B],
      entries: [
        entry({
          employeeNetId: "f00fake2",
          employeeName: "Hopper, Grace",
          jobId: "4889",
          chartString: "", // no chart string → no tie-break, fan out
          totalShiftTime: 5,
          totalEarnings: 90,
        }),
      ],
    });

    expect(result.projects.map((p) => p.projectId).sort()).toEqual([
      "proj-a",
      "proj-b",
    ]);
    for (const p of result.projects) {
      expect(p.totalHours).toBe(5);
      expect(p.totalPay).toBe(90);
      expect(p.sharedHours).toBe(5);
      expect(p.jobs[0].sharedWith).toHaveLength(1);
    }
    const projA = result.projects.find((p) => p.projectId === "proj-a")!;
    expect(projA.jobs[0].sharedWith).toEqual(["Compiler Corps"]);
  });

  it("grand totals count each shift once (de-duplicated across the fan-out)", () => {
    const result = run({
      assignments: [ASSIGN_GRACE_A, ASSIGN_GRACE_B],
      entries: [
        entry({
          employeeNetId: "f00fake2",
          jobId: "4889",
          chartString: "",
          totalShiftTime: 5,
          totalEarnings: 90,
        }),
      ],
    });
    // Projects sum to 180 (fan-out), but the summary counts the shift once.
    expect(result.summary.daliHours).toBe(5);
    expect(result.summary.daliPay).toBe(90);
  });

  it("uses the chart string only as a suffix-normalized tie-break to narrow the fan-out", () => {
    const result = run({
      assignments: [ASSIGN_GRACE_A, ASSIGN_GRACE_B],
      entries: [
        entry({
          employeeNetId: "f00fake2",
          jobId: "4889",
          // Charged with a drifted prefix (20. instead of 18.) but proj-b's suffix.
          chartString: "20.722.161028.128512.5000",
          totalShiftTime: 5,
          totalEarnings: 90,
        }),
      ],
    });
    expect(result.projects.map((p) => p.projectId)).toEqual(["proj-b"]);
    expect(result.projects[0].sharedHours).toBe(0);
    expect(result.projects[0].jobs[0].sharedWith).toEqual([]);
  });

  it("never lets the chart string override the assignment join", () => {
    const result = run({
      // ada assigned ONLY to proj-a, but charged proj-b's chart string.
      assignments: [ASSIGN_ADA_A],
      entries: [entry({ chartString: PROJ_B.chartString! })],
    });
    expect(result.projects.map((p) => p.projectId)).toEqual(["proj-a"]);
    expect(result.discrepancies.unassignedJobs).toHaveLength(0);
  });

  it("keeps the full fan-out when the charged chart string matches no assigned project", () => {
    const result = run({
      assignments: [ASSIGN_GRACE_A, ASSIGN_GRACE_B],
      entries: [
        entry({
          employeeNetId: "f00fake2",
          jobId: "4889",
          chartString: "99.999.999999.999999.9999",
          totalShiftTime: 4,
          totalEarnings: 72,
        }),
      ],
    });
    expect(result.projects.map((p) => p.projectId).sort()).toEqual([
      "proj-a",
      "proj-b",
    ]);
  });
});

describe("DALI vs External partition", () => {
  it("keeps External money separate and reconciling: DALI + External = CSV total", () => {
    const result = run({
      entries: [
        entry({ totalShiftTime: 2, totalEarnings: 32.5 }),
        entry({ jobId: "4762", jobTitle: "Makerspace Trainee", totalShiftTime: 3, totalEarnings: 45 }),
      ],
    });
    expect(result.summary.daliHours).toBe(2);
    expect(result.summary.daliPay).toBe(32.5);
    expect(result.summary.externalHours).toBe(3);
    expect(result.summary.externalPay).toBe(45);
    expect(result.summary.totalHours).toBe(5);
    expect(result.summary.totalPay).toBe(77.5);
  });

  it("never flags External jobs as discrepancies", () => {
    const result = run({
      entries: [
        // Alan has NO assignment and works an unknown job id.
        entry({
          employeeNetId: "f00fake3",
          employeeName: "Turing, Alan",
          jobId: "4762",
          totalShiftTime: 3,
          totalEarnings: 45,
        }),
      ],
    });
    expect(result.external.jobs).toHaveLength(1);
    expect(result.discrepancies.unassignedJobs).toHaveLength(0);
    expect(result.discrepancies.unknownPersons).toHaveLength(0);
    expect(result.discrepancies.rateMismatches).toHaveLength(0);
  });

  it("excludes External from the DALI student count and median", () => {
    const result = run({
      entries: [
        entry({ totalShiftTime: 1, totalEarnings: 100 }),
        entry({
          employeeNetId: "f00fake3",
          jobId: "4762",
          totalShiftTime: 1,
          totalEarnings: 999,
        }),
      ],
    });
    expect(result.summary.daliStudentCount).toBe(1);
    expect(result.summary.medianPay).toBe(100);
  });
});

describe("discrepancies", () => {
  it("flags assigned-but-0-hours people per project", () => {
    const result = run({
      assignments: [ASSIGN_ADA_A, ASSIGN_MARGARET_B],
      entries: [entry()], // only ada logged hours
    });
    expect(result.discrepancies.assignedNoHours).toHaveLength(1);
    expect(result.discrepancies.assignedNoHours[0]).toMatchObject({
      netId: "f00fake4",
      name: "Margaret Hamilton",
      projectId: "proj-b",
    });
  });

  it("flags a DALI project jobId with no matching assignment, inferring project via chart string", () => {
    const result = run({
      assignments: [], // nobody assigned
      entries: [
        entry({
          employeeNetId: "f00fake3",
          employeeName: "Turing, Alan",
          jobId: "4834",
          chartString: PROJ_A.chartString!,
          totalShiftTime: 4,
          totalEarnings: 65,
        }),
      ],
    });
    expect(result.discrepancies.unassignedJobs).toHaveLength(1);
    expect(result.discrepancies.unassignedJobs[0]).toMatchObject({
      netId: "f00fake3",
      name: "Alan Turing",
      jobId: "4834",
      hours: 4,
      pay: 65,
      inferredProjectId: "proj-a",
      inferredProjectName: "Analytical Engine",
    });
    // Unassigned hours still count in DALI totals.
    expect(result.summary.daliHours).toBe(4);
    expect(result.summary.daliPay).toBe(65);
  });

  it("infers the project via another assigned holder when the chart string matches nothing", () => {
    const result = run({
      assignments: [ASSIGN_ADA_A],
      entries: [
        // ada (assigned to proj-a) works 4834.
        entry({ totalShiftTime: 2, totalEarnings: 32.5 }),
        // alan works the same jobId, unassigned, unmatched chart string.
        entry({
          employeeNetId: "f00fake3",
          employeeName: "Turing, Alan",
          jobId: "4834",
          chartString: "99.999.999999.999999.9999",
          totalShiftTime: 3,
          totalEarnings: 48.75,
        }),
      ],
    });
    expect(result.discrepancies.unassignedJobs).toHaveLength(1);
    expect(result.discrepancies.unassignedJobs[0].inferredProjectId).toBe("proj-a");
  });

  it("leaves the inferred project null when nothing points anywhere", () => {
    const result = run({
      assignments: [],
      entries: [
        entry({
          employeeNetId: "f00fake3",
          jobId: "4834",
          chartString: "99.999.999999.999999.9999",
        }),
      ],
    });
    expect(result.discrepancies.unassignedJobs[0].inferredProjectId).toBeNull();
    expect(result.discrepancies.unassignedJobs[0].inferredProjectName).toBeNull();
  });

  it("flags unknown persons (netId not in User) and still counts their money", () => {
    const result = run({
      entries: [
        entry({
          employeeNetId: "f00ghost",
          employeeName: "Ghost, Casper",
          jobId: "4890", // Core — no assignment needed
          totalShiftTime: 2,
          totalEarnings: 40,
        }),
      ],
    });
    expect(result.discrepancies.unknownPersons).toHaveLength(1);
    expect(result.discrepancies.unknownPersons[0]).toMatchObject({
      netId: "f00ghost",
      hours: 2,
      pay: 40,
    });
    expect(result.summary.daliPay).toBe(40);
    expect(result.core.totalPay).toBe(40);
  });

  describe("rate mismatch", () => {
    it("computes Σearnings − lookupRate×Σhours per job for the active term", () => {
      const result = run({
        assignments: [ASSIGN_GRACE_A],
        entries: [
          entry({
            employeeNetId: "f00fake2",
            jobId: "4889", // unambiguous lookup rate 18.00
            totalShiftTime: 5,
            totalEarnings: 100, // expected 90
          }),
        ],
      });
      expect(result.discrepancies.rateMismatches).toHaveLength(1);
      expect(result.discrepancies.rateMismatches[0]).toMatchObject({
        netId: "f00fake2",
        jobId: "4889",
        hours: 5,
        actualPay: 100,
        expectedPay: 90,
        difference: 10,
        lookupRate: 18,
      });
    });

    it("is suppressed entirely for non-active terms", () => {
      const result = run({
        isActiveTerm: false,
        assignments: [ASSIGN_GRACE_A],
        entries: [
          entry({
            employeeNetId: "f00fake2",
            jobId: "4889",
            totalShiftTime: 5,
            totalEarnings: 100,
          }),
        ],
      });
      expect(result.discrepancies.rateMismatches).toHaveLength(0);
    });

    it("skips jobs whose lookup rate is ambiguous (4834 → P1+P2)", () => {
      const result = run({
        entries: [
          entry({ jobId: "4834", totalShiftTime: 5, totalEarnings: 999 }),
        ],
      });
      expect(result.discrepancies.rateMismatches).toHaveLength(0);
    });

    it("skips jobs whose lookup payRateUsdHour is null", () => {
      const result = run({
        lookups: [
          ...LOOKUPS,
          { jobCode: "5001", assignmentType: "Project", level: null, payRateUsdHour: null },
        ],
        entries: [
          entry({ jobId: "5001", totalShiftTime: 5, totalEarnings: 999 }),
        ],
      });
      expect(result.discrepancies.rateMismatches).toHaveLength(0);
    });

    it("does not flag jobs whose earnings match the lookup rate", () => {
      const result = run({
        entries: [
          entry({ jobId: "4889", totalShiftTime: 5, totalEarnings: 90 }),
        ],
      });
      expect(result.discrepancies.rateMismatches).toHaveLength(0);
    });
  });
});

describe("chart-string aggregation", () => {
  it("groups by the charged chart string with per-student rollups", () => {
    const cs = "18.722.161028.128512.4000";
    const result = run({
      entries: [
        entry({ chartString: cs, totalShiftTime: 2, totalEarnings: 30 }),
        entry({
          employeeNetId: "f00fake2",
          employeeName: "Hopper, Grace",
          jobId: "4889",
          chartString: cs,
          totalShiftTime: 3,
          totalEarnings: 54,
        }),
      ],
      assignments: [ASSIGN_ADA_A, ASSIGN_GRACE_A],
    });
    const summary = result.chartStrings.find((c) => c.chartString === cs)!;
    expect(summary.totalHours).toBe(5);
    expect(summary.totalPay).toBe(84);
    expect(summary.students).toHaveLength(2);
    // Sorted by pay descending.
    expect(summary.students[0]).toMatchObject({ netId: "f00fake2", pay: 54 });
    expect(summary.students[1]).toMatchObject({ netId: "f00fake1", pay: 30 });
    expect(summary.projects).toEqual([{ id: "proj-a", name: "Analytical Engine" }]);
    expect(summary.ambiguousProject).toBe(false);
  });

  it("flags ambiguousProject when >1 project shares the (suffix-normalized) chart string", () => {
    const projC: CollationProject = {
      id: "proj-c",
      name: "Difference Engine",
      // Same suffix as PROJ_A, drifted prefix.
      chartString: "20.722.161028.128512.4000",
    };
    const result = run({
      projects: [PROJ_A, PROJ_B, projC],
      entries: [entry({ chartString: PROJ_A.chartString! })],
    });
    const summary = result.chartStrings[0];
    expect(summary.projects.map((p) => p.id).sort()).toEqual(["proj-a", "proj-c"]);
    expect(summary.ambiguousProject).toBe(true);
  });

  it('buckets blank chart strings under "Unknown"', () => {
    const result = run({ entries: [entry({ chartString: "" })] });
    expect(result.chartStrings.map((c) => c.chartString)).toEqual(["Unknown"]);
  });
});

describe("summary and median", () => {
  it("computes the median over DALI per-(person,job) pays — odd count", () => {
    const result = run({
      assignments: [ASSIGN_ADA_A, ASSIGN_GRACE_A],
      entries: [
        entry({ totalShiftTime: 1, totalEarnings: 85 }),
        entry({ employeeNetId: "f00fake2", jobId: "4889", totalShiftTime: 1, totalEarnings: 90 }),
        entry({ employeeNetId: "f00fake2", jobId: "4890", totalShiftTime: 1, totalEarnings: 100 }),
      ],
    });
    expect(result.summary.medianPay).toBe(90);
  });

  it("computes the median — even count averages the middle pair", () => {
    const result = run({
      assignments: [ASSIGN_ADA_A, ASSIGN_GRACE_A],
      entries: [
        entry({ totalShiftTime: 1, totalEarnings: 85 }),
        entry({ employeeNetId: "f00fake2", jobId: "4889", totalShiftTime: 1, totalEarnings: 90 }),
      ],
    });
    expect(result.summary.medianPay).toBe(87.5);
  });

  it("counts distinct DALI students once across multiple jobs", () => {
    const result = run({
      entries: [
        entry({ jobId: "4834", totalShiftTime: 1, totalEarnings: 16.25 }),
        entry({ jobId: "4890", totalShiftTime: 1, totalEarnings: 20 }),
      ],
    });
    expect(result.summary.daliStudentCount).toBe(1);
  });

  it("returns a zeroed summary for empty input", () => {
    const result = run({ entries: [] });
    expect(result.summary).toEqual({
      daliHours: 0,
      daliPay: 0,
      externalHours: 0,
      externalPay: 0,
      totalHours: 0,
      totalPay: 0,
      daliStudentCount: 0,
      medianPay: 0,
    });
    expect(result.projects).toEqual([]);
  });
});
