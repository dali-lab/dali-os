// Tests for education MCP tools.
// Pattern: scope tag + forbidden path + happy path per tool.
// Heavy mocks — no DB connection required.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the registry module to prevent it from importing all tool areas and
// crashing in the BY_NAME map initialization (some other area may export an
// undefined entry in CI). We only need the error classes from registry here.
vi.mock("~/mcp/registry", async () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'. Expected one of: ${Object.keys(spec).join(", ")}`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError, requireForAction };
});

vi.mock("~/lib/db");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
  manageableOfferingIds: vi.fn(),
}));
vi.mock("~/education/lib/offerings.server", () => ({
  listCatalog: vi.fn(),
  listManageable: vi.fn(),
  listMyApplications: vi.fn(),
  getOfferingDetail: vi.fn(),
  runOfferingAction: vi.fn(),
}));
vi.mock("~/education/lib/apply.server", () => ({
  submitApplication: vi.fn(),
}));
vi.mock("~/education/lib/decisions.server", () => ({
  withdrawApplication: vi.fn(),
  decideApplication: vi.fn(),
  approveAllPending: vi.fn(),
}));
vi.mock("~/education/lib/assignments.server", () => ({
  offeringIdForAssignment: vi.fn(),
  getAssignmentForStudent: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
}));
vi.mock("~/education/lib/attendance.server", () => ({
  saveAttendance: vi.fn(),
}));
vi.mock("~/education/lib/student-notes.server", () => ({
  upsertStudentNote: vi.fn(),
}));
vi.mock("~/education/lib/certificates.server", () => ({
  closeOutOffering: vi.fn(),
  previewCloseOut: vi.fn(),
}));
vi.mock("~/education/lib/ce-credits.server", () => ({
  myCreditStanding: vi.fn(),
  creditHistory: vi.fn(),
}));

import { isCore } from "~/lib/roles";
import { isOfferingManager, manageableOfferingIds } from "~/education/lib/access.server";
import {
  listCatalog,
  listManageable,
  listMyApplications,
  getOfferingDetail,
  runOfferingAction,
} from "~/education/lib/offerings.server";
import { submitApplication } from "~/education/lib/apply.server";
import {
  withdrawApplication,
  decideApplication,
  approveAllPending,
} from "~/education/lib/decisions.server";
import {
  offeringIdForAssignment,
  getAssignmentForStudent,
  createAssignment,
  deleteAssignment,
} from "~/education/lib/assignments.server";
import { saveAttendance } from "~/education/lib/attendance.server";
import { upsertStudentNote } from "~/education/lib/student-notes.server";
import { closeOutOffering, previewCloseOut } from "~/education/lib/certificates.server";
import { myCreditStanding, creditHistory } from "~/education/lib/ce-credits.server";
import { prisma } from "~/lib/db";

import {
  LIST_EDUCATION_OFFERINGS_TOOL,
  runListEducationOfferings,
} from "../list-education-offerings";
import {
  GET_EDUCATION_OFFERING_TOOL,
  runGetEducationOffering,
} from "../get-education-offering";
import {
  LIST_MY_EDUCATION_APPLICATIONS_TOOL,
  runListMyEducationApplications,
} from "../list-my-education-applications";
import {
  GET_EDUCATION_ASSIGNMENT_TOOL,
  runGetEducationAssignment,
} from "../get-education-assignment";
import {
  GET_CE_CREDIT_STANDING_TOOL,
  runGetCeCreditStanding,
} from "../get-ce-credit-standing";
import {
  SUBMIT_EDUCATION_APPLICATION_TOOL,
  runSubmitEducationApplication,
} from "../submit-education-application";
import {
  WITHDRAW_EDUCATION_APPLICATION_TOOL,
  runWithdrawEducationApplication,
} from "../withdraw-education-application";
import {
  DECIDE_EDUCATION_APPLICATION_TOOL,
  runDecideEducationApplication,
} from "../decide-education-application";
import {
  SAVE_EDUCATION_ATTENDANCE_TOOL,
  runSaveEducationAttendance,
} from "../save-education-attendance";
import {
  MANAGE_EDUCATION_OFFERING_TOOL,
  runManageEducationOffering,
} from "../manage-education-offering";
import {
  MANAGE_EDUCATION_SESSION_TOOL,
  runManageEducationSession,
} from "../manage-education-session";
import {
  MANAGE_EDUCATION_ASSIGNMENT_TOOL,
  runManageEducationAssignment,
} from "../manage-education-assignment";
import {
  UPSERT_EDUCATION_STUDENT_NOTE_TOOL,
  runUpsertEducationStudentNote,
} from "../upsert-education-student-note";
import {
  CLOSE_OUT_EDUCATION_OFFERING_TOOL,
  runCloseOutEducationOffering,
} from "../close-out-education-offering";

const mockPrisma = prisma as unknown as {
  educationApplication: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

// A minimal McpCtx for tests.
function ctx(id = "u1") {
  return {
    user: {
      id,
      daliEmail: "test@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: "d12345",
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:read", "mcp:write", "mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Scopes ──────────────────────────────────────────────────────────────────

describe("scopes", () => {
  it("list_education_offerings requires mcp:read", () => {
    expect(LIST_EDUCATION_OFFERINGS_TOOL.requiredScope).toBe("mcp:read");
  });
  it("get_education_offering requires mcp:read", () => {
    expect(GET_EDUCATION_OFFERING_TOOL.requiredScope).toBe("mcp:read");
  });
  it("list_my_education_applications requires mcp:read", () => {
    expect(LIST_MY_EDUCATION_APPLICATIONS_TOOL.requiredScope).toBe("mcp:read");
  });
  it("get_education_assignment requires mcp:read", () => {
    expect(GET_EDUCATION_ASSIGNMENT_TOOL.requiredScope).toBe("mcp:read");
  });
  it("get_ce_credit_standing requires mcp:read", () => {
    expect(GET_CE_CREDIT_STANDING_TOOL.requiredScope).toBe("mcp:read");
  });
  it("submit_education_application requires mcp:write", () => {
    expect(SUBMIT_EDUCATION_APPLICATION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("withdraw_education_application requires mcp:write", () => {
    expect(WITHDRAW_EDUCATION_APPLICATION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("decide_education_application requires mcp:write", () => {
    expect(DECIDE_EDUCATION_APPLICATION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("save_education_attendance requires mcp:write", () => {
    expect(SAVE_EDUCATION_ATTENDANCE_TOOL.requiredScope).toBe("mcp:write");
  });
  it("manage_education_offering requires mcp:write", () => {
    expect(MANAGE_EDUCATION_OFFERING_TOOL.requiredScope).toBe("mcp:write");
  });
  it("manage_education_session requires mcp:write", () => {
    expect(MANAGE_EDUCATION_SESSION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("manage_education_assignment requires mcp:write", () => {
    expect(MANAGE_EDUCATION_ASSIGNMENT_TOOL.requiredScope).toBe("mcp:write");
  });
  it("upsert_education_student_note requires mcp:write", () => {
    expect(UPSERT_EDUCATION_STUDENT_NOTE_TOOL.requiredScope).toBe("mcp:write");
  });
  it("close_out_education_offering requires mcp:admin", () => {
    expect(CLOSE_OUT_EDUCATION_OFFERING_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── list_education_offerings ─────────────────────────────────────────────────

describe("list_education_offerings", () => {
  it("returns catalog for normal callers (no manageable flag)", async () => {
    vi.mocked(listCatalog).mockResolvedValue([]);
    const result = await runListEducationOfferings(ctx(), {});
    expect(listCatalog).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ offerings: [] });
  });

  it("rejects non-instructors requesting manageable list", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(manageableOfferingIds).mockResolvedValue([]);
    await expect(
      runListEducationOfferings(ctx(), { manageable: true }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns manageable list for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(manageableOfferingIds).mockResolvedValue("all");
    vi.mocked(listManageable).mockResolvedValue([]);
    const result = await runListEducationOfferings(ctx(), { manageable: true });
    expect(listManageable).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ offerings: [] });
  });
});

// ─── get_education_offering ───────────────────────────────────────────────────

describe("get_education_offering", () => {
  const baseOffering = {
    id: "o1",
    status: "Published" as const,
    title: "React Workshop",
    type: "Workshop" as const,
    capacity: 20,
    requiresReview: false,
    registrationOpensAt: new Date("2026-01-01"),
    registrationClosesAt: new Date("2026-02-01"),
    startsAt: new Date("2026-02-15"),
    endsAt: new Date("2026-02-15"),
    closedOutAt: null,
    approvedCount: 5,
    instructors: [],
    sessions: [],
  };

  it("returns published offering for non-managers", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getOfferingDetail).mockResolvedValue(baseOffering as any);
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    const result = await runGetEducationOffering(ctx(), { offeringId: "o1" });
    expect(result.id).toBe("o1");
    expect(result.registrationOpensAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("hides Draft offerings from non-managers", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getOfferingDetail).mockResolvedValue({ ...baseOffering, status: "Draft" as const } as any);
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runGetEducationOffering(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("shows Draft to managers", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getOfferingDetail).mockResolvedValue({ ...baseOffering, status: "Draft" as const } as any);
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    const result = await runGetEducationOffering(ctx(), { offeringId: "o1" });
    expect(result.status).toBe("Draft");
  });

  it("throws not-found for missing offering", async () => {
    vi.mocked(getOfferingDetail).mockResolvedValue(null);
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runGetEducationOffering(ctx(), { offeringId: "missing" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── list_my_education_applications ──────────────────────────────────────────

describe("list_my_education_applications", () => {
  it("returns applications for caller with serialized dates", async () => {
    const apps = [
      {
        id: "a1",
        status: "Approved" as const,
        submittedAt: new Date("2026-01-10"),
        offeringId: "o1",
        offeringTitle: "React Workshop",
        offeringType: "Workshop" as const,
        endsAt: new Date("2026-02-15"),
        closedOutAt: null,
        certificateId: null,
      },
    ];
    vi.mocked(listMyApplications).mockResolvedValue(apps);
    const result = await runListMyEducationApplications(ctx());
    expect(listMyApplications).toHaveBeenCalledWith("u1");
    expect(result.applications[0].status).toBe("Approved");
    expect(result.applications[0].submittedAt).toBe("2026-01-10T00:00:00.000Z");
  });
});

// ─── get_education_assignment ─────────────────────────────────────────────────

describe("get_education_assignment", () => {
  it("requires enrollment for non-managers", async () => {
    vi.mocked(offeringIdForAssignment).mockResolvedValue("o1");
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
    await expect(
      runGetEducationAssignment(ctx(), { assignmentId: "asgn1", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns assignment for enrolled student", async () => {
    vi.mocked(offeringIdForAssignment).mockResolvedValue("o1");
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1", status: "Approved" });
    vi.mocked(getAssignmentForStudent).mockResolvedValue({
      assignment: { id: "asgn1", title: "HW1", dueAt: new Date("2026-03-01"), submissionType: "Text", instructionsDocId: null, points: null },
      submission: null,
    });
    const result = await runGetEducationAssignment(ctx(), { assignmentId: "asgn1", offeringId: "o1" });
    expect(result.assignment.id).toBe("asgn1");
    expect(result.assignment.dueAt).toBe("2026-03-01T00:00:00.000Z");
    expect(result.submission).toBeNull();
  });

  it("throws 404 when assignment does not belong to offering", async () => {
    vi.mocked(offeringIdForAssignment).mockResolvedValue("o-other");
    await expect(
      runGetEducationAssignment(ctx(), { assignmentId: "asgn1", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── get_ce_credit_standing ───────────────────────────────────────────────────

describe("get_ce_credit_standing", () => {
  it("returns standing and history in parallel", async () => {
    vi.mocked(myCreditStanding).mockResolvedValue({ termCode: "26S", credits: 1, compliant: true });
    vi.mocked(creditHistory).mockResolvedValue([]);
    const result = await runGetCeCreditStanding(ctx());
    expect(result.standing).toMatchObject({ termCode: "26S", compliant: true });
    expect(result.history).toEqual([]);
  });
});

// ─── submit_education_application ────────────────────────────────────────────

describe("submit_education_application", () => {
  it("surfaces Approved outcome", async () => {
    vi.mocked(submitApplication).mockResolvedValue({ ok: true, status: "Approved" });
    const result = await runSubmitEducationApplication(ctx(), { offeringId: "o1" });
    expect(result.status).toBe("Approved");
  });

  it("throws invalid on error result", async () => {
    vi.mocked(submitApplication).mockResolvedValue({ error: "Registration isn't open", status: 400 });
    await expect(
      runSubmitEducationApplication(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws not-found when offering missing", async () => {
    vi.mocked(submitApplication).mockResolvedValue({ error: "Offering not found.", status: 404 });
    await expect(
      runSubmitEducationApplication(ctx(), { offeringId: "gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── withdraw_education_application ──────────────────────────────────────────

describe("withdraw_education_application", () => {
  it("succeeds and reports promoted seat", async () => {
    vi.mocked(withdrawApplication).mockResolvedValue({
      ok: true,
      status: "Withdrawn",
      promotedApplicationId: "app2",
    });
    const result = await runWithdrawEducationApplication(ctx(), { offeringId: "o1" });
    expect(result.promotedFromWaitlist).toBe(true);
  });

  it("throws not-found when no application exists", async () => {
    vi.mocked(withdrawApplication).mockResolvedValue({
      error: "No application to withdraw.",
      status: 404,
    });
    await expect(
      runWithdrawEducationApplication(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── decide_education_application ────────────────────────────────────────────

describe("decide_education_application", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runDecideEducationApplication(ctx(), { offeringId: "o1", applicationId: "a1", status: "Approved" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("approves a single application", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(decideApplication).mockResolvedValue({
      ok: true,
      status: "Approved",
      promotedApplicationId: null,
    });
    const result = await runDecideEducationApplication(ctx(), {
      offeringId: "o1",
      applicationId: "a1",
      status: "Approved",
    });
    expect(result.status).toBe("Approved");
    expect(result.promotedFromWaitlist).toBe(false);
  });

  it("bulk-approves pending applications", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(approveAllPending).mockResolvedValue({ approved: 3, skipped: 2 });
    const result = await runDecideEducationApplication(ctx(), {
      offeringId: "o1",
      bulk_approve: true,
    });
    expect(result).toMatchObject({ ok: true, approved: 3, skipped: 2 });
  });

  it("throws invalid when applicationId/status missing and bulk_approve not set", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    await expect(
      runDecideEducationApplication(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── save_education_attendance ────────────────────────────────────────────────

describe("save_education_attendance", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runSaveEducationAttendance(ctx(), { offeringId: "o1", sessionId: "s1", marks: [] }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("saves marks and returns count", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(saveAttendance).mockResolvedValue({ ok: true });
    const result = await runSaveEducationAttendance(ctx(), {
      offeringId: "o1",
      sessionId: "s1",
      marks: [
        { applicationId: "app1", status: "Present" },
        { applicationId: "app2" }, // no status → clears mark
      ],
    });
    expect(saveAttendance).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: [
          { applicationId: "app1", status: "Present" },
          { applicationId: "app2", status: null },
        ],
      }),
    );
    expect(result.marksProcessed).toBe(2);
  });
});

// ─── manage_education_offering ────────────────────────────────────────────────

describe("manage_education_offering", () => {
  it("rejects unknown action", async () => {
    await expect(
      runManageEducationOffering(ctx(), { action: "bogus" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("rejects non-core for set_instructors", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "set_instructors",
        offeringId: "o1",
        userIds: ["u2"],
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("rejects non-manager for update", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "update",
        offeringId: "o1",
        title: "New title",
        capacity: 20,
        registrationOpensAt: "2026-01-01T00:00:00Z",
        registrationClosesAt: "2026-02-01T00:00:00Z",
        startsAt: "2026-02-15T00:00:00Z",
        endsAt: "2026-02-15T00:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("calls runOfferingAction for set_status", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "o1" });
    const result = await runManageEducationOffering(ctx(), {
      action: "set_status",
      offeringId: "o1",
      status: "Published",
    });
    expect(runOfferingAction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});

// ─── manage_education_session ─────────────────────────────────────────────────

describe("manage_education_session", () => {
  it("rejects non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationSession(ctx(), {
        action: "add",
        offeringId: "o1",
        datetime: "2026-03-01T18:00:00Z",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("adds a session via runOfferingAction", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "s-new" });
    const result = await runManageEducationSession(ctx(), {
      action: "add",
      offeringId: "o1",
      datetime: "2026-03-01T18:00:00Z",
      location: "Sudikoff 115",
    });
    expect(result.id).toBe("s-new");
  });

  it("rejects unknown action", async () => {
    await expect(
      runManageEducationSession(ctx(), { action: "archive", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── manage_education_assignment ─────────────────────────────────────────────

describe("manage_education_assignment", () => {
  it("rejects non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationAssignment(ctx(), {
        action: "create",
        offeringId: "o1",
        title: "HW1",
        submissionType: "Text",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("creates an assignment", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(createAssignment).mockResolvedValue({ ok: true, id: "asgn-new" });
    const result = await runManageEducationAssignment(ctx(), {
      action: "create",
      offeringId: "o1",
      title: "Final Project",
      submissionType: "Mixed",
      dueAt: "2026-04-01T23:59:00Z",
    });
    expect(createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Final Project",
        submissionType: "Mixed",
        offeringId: "o1",
        dueAt: expect.any(Date),
      }),
    );
    expect(result.id).toBe("asgn-new");
  });

  it("blocks delete when submitted (propagates error from lib)", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(deleteAssignment).mockResolvedValue({
      error: "Students have submitted — this assignment can't be deleted",
      status: 400,
    });
    await expect(
      runManageEducationAssignment(ctx(), {
        action: "delete",
        offeringId: "o1",
        assignmentId: "asgn1",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── upsert_education_student_note ────────────────────────────────────────────

describe("upsert_education_student_note", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runUpsertEducationStudentNote(ctx(), {
        applicationId: "app1",
        offeringId: "o1",
        feedback: "Great work!",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found when application does not belong to offering", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    mockPrisma.educationApplication.findUnique.mockResolvedValue({ offeringId: "o-other" });
    await expect(
      runUpsertEducationStudentNote(ctx(), {
        applicationId: "app1",
        offeringId: "o1",
        feedback: "Good",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("saves feedback lane only (never internalNote)", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    mockPrisma.educationApplication.findUnique.mockResolvedValue({ offeringId: "o1" });
    vi.mocked(upsertStudentNote).mockResolvedValue({ ok: true });
    await runUpsertEducationStudentNote(ctx(), {
      applicationId: "app1",
      offeringId: "o1",
      feedback: "Excellent presentation!",
    });
    expect(upsertStudentNote).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: "Excellent presentation!",
      }),
    );
    // Must never pass internalNote
    expect(upsertStudentNote).not.toHaveBeenCalledWith(
      expect.objectContaining({ internalNote: expect.anything() }),
    );
  });
});

// ─── close_out_education_offering ─────────────────────────────────────────────

describe("close_out_education_offering", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runCloseOutEducationOffering(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns preview without issuing certificates", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(previewCloseOut).mockResolvedValue({
      eligible: ["Alice Smith", "Bob Jones"],
      belowThreshold: ["Charlie Brown"],
      alreadyIssued: 1,
    });
    const result = await runCloseOutEducationOffering(ctx(), {
      offeringId: "o1",
      preview: true,
    });
    expect(closeOutOffering).not.toHaveBeenCalled();
    expect(result).toMatchObject({ preview: true, eligible: ["Alice Smith", "Bob Jones"] });
  });

  it("issues certificates on live run", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(closeOutOffering).mockResolvedValue({
      ok: true,
      issued: 5,
      alreadyIssued: 2,
      ineligible: 1,
    });
    const result = await runCloseOutEducationOffering(ctx(), { offeringId: "o1" });
    expect(result).toMatchObject({ preview: false, issued: 5, alreadyIssued: 2 });
  });

  it("throws not-found for missing offering in preview", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(previewCloseOut).mockResolvedValue(null);
    await expect(
      runCloseOutEducationOffering(ctx(), { offeringId: "gone", preview: true }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});
