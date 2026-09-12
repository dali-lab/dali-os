// Tests for newly-added education MCP tools.
// Pattern: scope tag + forbidden path + happy path per tool.
// Self-contained heavy mocks — no DB connection required.

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Registry mock (same as the base test file) ──────────────────────────────

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

// ─── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("~/lib/db");

// ─── Role + access mocks ──────────────────────────────────────────────────────

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});

vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
}));

// ─── Server fn mocks ──────────────────────────────────────────────────────────

vi.mock("~/education/lib/assignments.server", () => ({
  submitAssignment: vi.fn(),
  gradeSubmission: vi.fn(),
  offeringIdForAssignment: vi.fn(),
}));

vi.mock("~/education/lib/session-checkin.server", () => ({
  selfCheckInToSession: vi.fn(),
  setSessionCheckInOpen: vi.fn(),
}));

vi.mock("~/education/lib/certificates.server", () => ({
  getCertificate: vi.fn(),
}));

vi.mock("~/education/lib/lms.server", () => ({
  createMaterialPage: vi.fn(),
  moveMaterialPage: vi.fn(),
  moveMaterialFile: vi.fn(),
  readMaterialPage: vi.fn(),
}));

vi.mock("~/education/lib/announcements.server", () => ({
  postAnnouncement: vi.fn(),
  listDiscussion: vi.fn(),
}));

vi.mock("~/education/lib/discussions.server", () => ({
  listThreads: vi.fn(),
  offeringInstructorIds: vi.fn(),
}));

vi.mock("~/education/lib/ce-credits.server", () => ({
  complianceForTerm: vi.fn(),
  grantManualCredit: vi.fn(),
  remindNonCompliant: vi.fn(),
}));

vi.mock("~/education/lib/feedback.server", () => ({
  setFormBinding: vi.fn(),
}));

vi.mock("~/education/lib/offerings.server", () => ({
  runOfferingAction: vi.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { isCore } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { submitAssignment, gradeSubmission } from "~/education/lib/assignments.server";
import {
  selfCheckInToSession,
  setSessionCheckInOpen,
} from "~/education/lib/session-checkin.server";
import { getCertificate } from "~/education/lib/certificates.server";
import {
  createMaterialPage,
  moveMaterialPage,
  moveMaterialFile,
  readMaterialPage,
} from "~/education/lib/lms.server";
import { postAnnouncement, listDiscussion } from "~/education/lib/announcements.server";
import { listThreads, offeringInstructorIds } from "~/education/lib/discussions.server";
import { complianceForTerm, grantManualCredit, remindNonCompliant } from "~/education/lib/ce-credits.server";
import { setFormBinding } from "~/education/lib/feedback.server";
import { runOfferingAction } from "~/education/lib/offerings.server";
import { prisma } from "~/lib/db";

import { SUBMIT_ASSIGNMENT_TOOL, runSubmitAssignment } from "../submit-assignment";
import { CHECK_IN_TO_SESSION_TOOL, runCheckInToSession } from "../check-in-to-session";
import { GRADE_SUBMISSION_TOOL, runGradeSubmission } from "../grade-submission";
import { GET_CERTIFICATE_TOOL, runGetCertificate } from "../get-certificate";
import {
  MANAGE_OFFERING_MATERIALS_TOOL,
  runManageOfferingMaterials,
} from "../manage-offering-materials";
import { READ_EDUCATION_PAGE_TOOL, runReadEducationPage } from "../read-education-page";
import {
  POST_EDUCATION_ANNOUNCEMENT_TOOL,
  runPostEducationAnnouncement,
} from "../post-education-announcement";
import {
  READ_EDUCATION_DISCUSSION_TOOL,
  runReadEducationDiscussion,
} from "../read-education-discussion";
import { LIST_CE_COMPLIANCE_TOOL, runListCeCompliance } from "../list-ce-compliance";
import { GRANT_CE_CREDIT_TOOL, runGrantCeCredit } from "../grant-ce-credit";
import {
  REMIND_CE_NONCOMPLIANT_TOOL,
  runRemindCeNoncompliant,
} from "../remind-ce-noncompliant";
import {
  MANAGE_EDUCATION_SESSION_TOOL,
  runManageEducationSession,
} from "../manage-education-session";
import {
  MANAGE_EDUCATION_OFFERING_TOOL,
  runManageEducationOffering,
} from "../manage-education-offering";

// Typed prisma mock handle.
const mockPrisma = prisma as unknown as {
  educationApplication: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  educationOffering: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  educationSession: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  term: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

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

// ─── Scopes ───────────────────────────────────────────────────────────────────

describe("scopes", () => {
  it("submit_assignment requires mcp:write", () => {
    expect(SUBMIT_ASSIGNMENT_TOOL.requiredScope).toBe("mcp:write");
  });
  it("check_in_to_session requires mcp:write", () => {
    expect(CHECK_IN_TO_SESSION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("grade_submission requires mcp:write", () => {
    expect(GRADE_SUBMISSION_TOOL.requiredScope).toBe("mcp:write");
  });
  it("get_certificate requires mcp:read", () => {
    expect(GET_CERTIFICATE_TOOL.requiredScope).toBe("mcp:read");
  });
  it("manage_offering_materials requires mcp:write", () => {
    expect(MANAGE_OFFERING_MATERIALS_TOOL.requiredScope).toBe("mcp:write");
  });
  it("read_education_page requires mcp:read", () => {
    expect(READ_EDUCATION_PAGE_TOOL.requiredScope).toBe("mcp:read");
  });
  it("post_education_announcement requires mcp:write", () => {
    expect(POST_EDUCATION_ANNOUNCEMENT_TOOL.requiredScope).toBe("mcp:write");
  });
  it("read_education_discussion requires mcp:read", () => {
    expect(READ_EDUCATION_DISCUSSION_TOOL.requiredScope).toBe("mcp:read");
  });
  it("list_ce_compliance requires mcp:admin", () => {
    expect(LIST_CE_COMPLIANCE_TOOL.requiredScope).toBe("mcp:admin");
  });
  it("grant_ce_credit requires mcp:admin", () => {
    expect(GRANT_CE_CREDIT_TOOL.requiredScope).toBe("mcp:admin");
  });
  it("remind_ce_noncompliant requires mcp:admin", () => {
    expect(REMIND_CE_NONCOMPLIANT_TOOL.requiredScope).toBe("mcp:admin");
  });
});

// ─── submit_assignment ────────────────────────────────────────────────────────

describe("submit_assignment", () => {
  it("rejects unenrolled caller", async () => {
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
    await expect(
      runSubmitAssignment(ctx(), { assignmentId: "a1", offeringId: "o1", textContent: "Hi" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("submits a text assignment", async () => {
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    vi.mocked(submitAssignment).mockResolvedValue({ ok: true });
    const result = await runSubmitAssignment(ctx(), {
      assignmentId: "a1",
      offeringId: "o1",
      textContent: "My answer",
    });
    expect(submitAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "a1",
        offeringId: "o1",
        studentId: "u1",
        applicationId: "app1",
        textContent: "My answer",
        files: [],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("submits a link assignment", async () => {
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    vi.mocked(submitAssignment).mockResolvedValue({ ok: true });
    await runSubmitAssignment(ctx(), {
      assignmentId: "a1",
      offeringId: "o1",
      link: "https://example.com/project",
    });
    expect(submitAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ link: "https://example.com/project" }),
    );
  });

  it("surfaces past-due error as McpInvalidError", async () => {
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    vi.mocked(submitAssignment).mockResolvedValue({
      error: "This assignment is past due",
      status: 400,
    });
    await expect(
      runSubmitAssignment(ctx(), { assignmentId: "a1", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("surfaces not-found as McpNotFoundError", async () => {
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    vi.mocked(submitAssignment).mockResolvedValue({
      error: "Assignment not found",
      status: 404,
    });
    await expect(
      runSubmitAssignment(ctx(), { assignmentId: "gone", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── check_in_to_session ──────────────────────────────────────────────────────

describe("check_in_to_session", () => {
  it("marks present when check-in is open", async () => {
    vi.mocked(selfCheckInToSession).mockResolvedValue({ ok: true, alreadyPresent: false });
    const result = await runCheckInToSession(ctx(), { sessionId: "s1" });
    expect(selfCheckInToSession).toHaveBeenCalledWith({ sessionId: "s1", userId: "u1" });
    expect(result).toEqual({ ok: true, alreadyPresent: false });
  });

  it("returns alreadyPresent=true when already marked", async () => {
    vi.mocked(selfCheckInToSession).mockResolvedValue({ ok: true, alreadyPresent: true });
    const result = await runCheckInToSession(ctx(), { sessionId: "s1" });
    expect(result.alreadyPresent).toBe(true);
  });

  it("throws McpForbiddenError when check-in is closed", async () => {
    vi.mocked(selfCheckInToSession).mockResolvedValue({
      error: "Check-in isn't open for this session",
      status: 403,
    });
    await expect(
      runCheckInToSession(ctx(), { sessionId: "s1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpNotFoundError when session not found", async () => {
    vi.mocked(selfCheckInToSession).mockResolvedValue({
      error: "Session not found",
      status: 404,
    });
    await expect(
      runCheckInToSession(ctx(), { sessionId: "gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── grade_submission ─────────────────────────────────────────────────────────

describe("grade_submission", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runGradeSubmission(ctx(), { submissionId: "sub1", offeringId: "o1", grade: "Pass" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("grades a submission", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(gradeSubmission).mockResolvedValue({ ok: true });
    const result = await runGradeSubmission(ctx(), {
      submissionId: "sub1",
      offeringId: "o1",
      grade: "Pass",
      score: 90,
    });
    expect(gradeSubmission).toHaveBeenCalledWith({
      submissionId: "sub1",
      offeringId: "o1",
      grade: "Pass",
      score: 90,
      actorId: "u1",
    });
    expect(result.ok).toBe(true);
  });

  it("throws McpNotFoundError when submission not found", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(gradeSubmission).mockResolvedValue({
      error: "Submission not found",
      status: 404,
    });
    await expect(
      runGradeSubmission(ctx(), { submissionId: "gone", offeringId: "o1", grade: "Pass" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── get_certificate ──────────────────────────────────────────────────────────

describe("get_certificate", () => {
  const baseCert = {
    id: "cert1",
    issuedAt: new Date("2026-06-01"),
    applicantUserId: "u1",
    studentName: "Alice Smith",
    offeringId: "o1",
    offeringTitle: "React Workshop",
    offeringType: "Workshop" as const,
    startsAt: new Date("2026-05-01"),
    endsAt: new Date("2026-05-01"),
    instructorNames: ["Bob Jones"],
    feedback: "Great work!",
  };

  it("returns certificate to the owner", async () => {
    vi.mocked(getCertificate).mockResolvedValue(baseCert);
    const result = await runGetCertificate(ctx("u1"), { certificateId: "cert1" });
    expect(result.id).toBe("cert1");
    expect(result.issuedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns certificate to a manager", async () => {
    vi.mocked(getCertificate).mockResolvedValue({ ...baseCert, applicantUserId: "u-other" });
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(isCore).mockResolvedValue(false);
    const result = await runGetCertificate(ctx("u1"), { certificateId: "cert1" });
    expect(result.id).toBe("cert1");
  });

  it("rejects unrelated caller", async () => {
    vi.mocked(getCertificate).mockResolvedValue({ ...baseCert, applicantUserId: "u-other" });
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runGetCertificate(ctx("u1"), { certificateId: "cert1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws not-found for missing cert", async () => {
    vi.mocked(getCertificate).mockResolvedValue(null);
    await expect(
      runGetCertificate(ctx(), { certificateId: "gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── manage_offering_materials ────────────────────────────────────────────────

describe("manage_offering_materials", () => {
  it("rejects non-managers", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageOfferingMaterials(ctx(), {
        action: "create_page",
        offeringId: "o1",
        title: "Slides",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("rejects unknown action", async () => {
    await expect(
      runManageOfferingMaterials(ctx(), { action: "archive", offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("creates a page", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(createMaterialPage).mockResolvedValue({ id: "page1" });
    const result = await runManageOfferingMaterials(ctx(), {
      action: "create_page",
      offeringId: "o1",
      title: "Week 1 Slides",
    });
    expect(createMaterialPage).toHaveBeenCalledWith(
      expect.objectContaining({ offeringId: "o1", title: "Week 1 Slides" }),
    );
    expect(result).toMatchObject({ ok: true, id: "page1" });
  });

  it("moves a page into a folder", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(moveMaterialPage).mockResolvedValue({ ok: true });
    const result = await runManageOfferingMaterials(ctx(), {
      action: "move_page",
      offeringId: "o1",
      pageId: "page1",
      parentPageId: "folder1",
    });
    expect(result).toMatchObject({ ok: true });
  });

  it("set_material_session: throws not-found for wrong offering", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      workspaceType: "EducationOffering",
      workspaceId: "o-other",
    });
    await expect(
      runManageOfferingMaterials(ctx(), {
        action: "set_material_session",
        offeringId: "o1",
        pageId: "page1",
        sessionId: "s1",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("set_material_session: updates page", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      workspaceType: "EducationOffering",
      workspaceId: "o1",
    });
    mockPrisma.educationSession.findUnique.mockResolvedValue({ offeringId: "o1" });
    mockPrisma.page.update.mockResolvedValue({});
    const result = await runManageOfferingMaterials(ctx(), {
      action: "set_material_session",
      offeringId: "o1",
      pageId: "page1",
      sessionId: "s1",
    });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "page1" },
      data: { sessionId: "s1" },
    });
    expect(result).toMatchObject({ ok: true });
  });
});

// ─── read_education_page ──────────────────────────────────────────────────────

describe("read_education_page", () => {
  it("rejects unenrolled non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
    await expect(
      runReadEducationPage(ctx(), { offeringId: "o1", pageId: "page1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns page content for enrolled student", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    vi.mocked(readMaterialPage).mockResolvedValue({
      id: "page1",
      title: "Week 1",
      content: { type: "doc", content: [] },
    });
    const result = await runReadEducationPage(ctx(), { offeringId: "o1", pageId: "page1" });
    expect(result.id).toBe("page1");
    expect(result.title).toBe("Week 1");
  });

  it("throws not-found when page not in this offering", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(readMaterialPage).mockResolvedValue(null);
    await expect(
      runReadEducationPage(ctx(), { offeringId: "o1", pageId: "gone" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── post_education_announcement ──────────────────────────────────────────────

describe("post_education_announcement", () => {
  it("posts an announcement for a manager", async () => {
    vi.mocked(postAnnouncement).mockResolvedValue({ ok: true });
    const result = await runPostEducationAnnouncement(ctx(), {
      offeringId: "o1",
      body: "Class moved to Sudikoff 115.",
    });
    expect(postAnnouncement).toHaveBeenCalledWith(
      expect.objectContaining({
        offeringId: "o1",
        authorId: "u1",
        body: "Class moved to Sudikoff 115.",
        kind: "Announcement",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("throws McpForbiddenError when not enrolled/managing", async () => {
    vi.mocked(postAnnouncement).mockResolvedValue({ error: "Forbidden", status: 403 });
    await expect(
      runPostEducationAnnouncement(ctx(), { offeringId: "o1", body: "Hi" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("throws McpInvalidError on empty body", async () => {
    vi.mocked(postAnnouncement).mockResolvedValue({
      error: "Write something first",
      status: 400,
    });
    await expect(
      runPostEducationAnnouncement(ctx(), { offeringId: "o1", body: "  " }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── read_education_discussion ────────────────────────────────────────────────

describe("read_education_discussion", () => {
  it("rejects unenrolled non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
    await expect(
      runReadEducationDiscussion(ctx(), { offeringId: "o1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns discussion for enrolled student", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "app1" });
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "o1" });
    vi.mocked(offeringInstructorIds).mockResolvedValue(new Set(["instr1"]));
    vi.mocked(listDiscussion).mockResolvedValue([
      {
        id: "ann1",
        body: "Welcome!",
        kind: "Announcement",
        sentAt: new Date("2026-05-01"),
        authorId: "instr1",
        author: { firstName: "Bob", lastName: "Jones" },
        replies: [],
      },
    ]);
    vi.mocked(listThreads).mockResolvedValue([]);
    const result = await runReadEducationDiscussion(ctx(), { offeringId: "o1" });
    expect(result.announcements).toHaveLength(1);
    expect(result.announcements[0].sentAt).toBe("2026-05-01T00:00:00.000Z");
    expect(result.announcements[0].authorName).toBe("Bob Jones");
    expect(result.threads).toHaveLength(0);
  });
});

// ─── list_ce_compliance ───────────────────────────────────────────────────────

describe("list_ce_compliance", () => {
  it("rejects non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runListCeCompliance(ctx(), { termId: "t1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("returns compliance roster", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.term.findUnique.mockResolvedValue({ id: "t1", code: "26S" });
    vi.mocked(complianceForTerm).mockResolvedValue([
      { userId: "u1", name: "Alice Smith", credits: 1, compliant: true },
      { userId: "u2", name: "Bob Jones", credits: 0, compliant: false },
    ]);
    const result = await runListCeCompliance(ctx(), { termId: "t1" });
    expect(result.termCode).toBe("26S");
    expect(result.compliantCount).toBe(1);
    expect(result.nonCompliantCount).toBe(1);
    expect(result.members).toHaveLength(2);
  });

  it("throws not-found for missing term", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.term.findUnique.mockResolvedValue(null);
    await expect(
      runListCeCompliance(ctx(), { termId: "bad" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── grant_ce_credit ─────────────────────────────────────────────────────────

describe("grant_ce_credit", () => {
  it("rejects non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runGrantCeCredit(ctx(), { userId: "u2", termId: "t1", reason: "CEC check-in" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("grants a manual credit", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(grantManualCredit).mockResolvedValue({ ok: true });
    const result = await runGrantCeCredit(ctx(), {
      userId: "u2",
      termId: "t1",
      reason: "CEC async check-in",
    });
    expect(grantManualCredit).toHaveBeenCalledWith({
      userId: "u2",
      termId: "t1",
      reason: "CEC async check-in",
      actorId: "u1",
    });
    expect(result.ok).toBe(true);
  });

  it("throws not-found for unknown user/term", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(grantManualCredit).mockResolvedValue({
      error: "Member or term not found",
      status: 404,
    });
    await expect(
      runGrantCeCredit(ctx(), { userId: "gone", termId: "t1", reason: "test" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── remind_ce_noncompliant ───────────────────────────────────────────────────

describe("remind_ce_noncompliant", () => {
  it("rejects non-Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runRemindCeNoncompliant(ctx(), { termId: "t1" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("sends reminders and returns count", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.term.findUnique.mockResolvedValue({ id: "t1" });
    vi.mocked(remindNonCompliant).mockResolvedValue({ reminded: 5 });
    const result = await runRemindCeNoncompliant(ctx(), { termId: "t1" });
    expect(result).toEqual({ ok: true, reminded: 5 });
  });

  it("throws not-found for unknown term", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.term.findUnique.mockResolvedValue(null);
    await expect(
      runRemindCeNoncompliant(ctx(), { termId: "bad" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });
});

// ─── manage_education_session (set_check_in_open extension) ──────────────────

describe("manage_education_session / set_check_in_open", () => {
  it("rejects non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationSession(ctx(), {
        action: "set_check_in_open",
        offeringId: "o1",
        sessionId: "s1",
        open: true,
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("opens check-in window", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(setSessionCheckInOpen).mockResolvedValue({ ok: true });
    const result = await runManageEducationSession(ctx(), {
      action: "set_check_in_open",
      offeringId: "o1",
      sessionId: "s1",
      open: true,
    });
    expect(setSessionCheckInOpen).toHaveBeenCalledWith({
      offeringId: "o1",
      sessionId: "s1",
      open: true,
      actorId: "u1",
    });
    expect(result).toMatchObject({ ok: true, id: "s1" });
  });

  it("throws not-found when session not in this offering", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(setSessionCheckInOpen).mockResolvedValue({
      error: "Session not found",
      status: 404,
    });
    await expect(
      runManageEducationSession(ctx(), {
        action: "set_check_in_open",
        offeringId: "o1",
        sessionId: "gone",
        open: true,
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("requires sessionId for set_check_in_open", async () => {
    await expect(
      runManageEducationSession(ctx(), {
        action: "set_check_in_open",
        offeringId: "o1",
        // sessionId missing
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});

// ─── manage_education_offering (new actions) ──────────────────────────────────

describe("manage_education_offering / new actions", () => {
  it("rejects non-Core for duplicate", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "duplicate",
        offeringId: "o1",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("duplicates an offering via runOfferingAction", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "o2" });
    const result = await runManageEducationOffering(ctx(), {
      action: "duplicate",
      offeringId: "o1",
      firstSessionDate: "2026-10-01T09:00:00Z",
    });
    expect(runOfferingAction).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, id: "o2" });
  });

  it("rejects non-Core for invite_external_instructor", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "invite_external_instructor",
        offeringId: "o1",
        netId: "abc123",
        firstName: "Jane",
        lastName: "Doe",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("invites external instructor via runOfferingAction", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "o1" });
    const result = await runManageEducationOffering(ctx(), {
      action: "invite_external_instructor",
      offeringId: "o1",
      netId: "jdoe",
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects non-manager for set_form_binding", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "set_form_binding",
        offeringId: "o1",
        slot: "session-feedback",
        formId: "form1",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("binds a feedback form", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(setFormBinding).mockResolvedValue({ ok: true });
    const result = await runManageEducationOffering(ctx(), {
      action: "set_form_binding",
      offeringId: "o1",
      slot: "session-feedback",
      formId: "form1",
    });
    expect(setFormBinding).toHaveBeenCalledWith({
      offeringId: "o1",
      slot: "session-feedback",
      formId: "form1",
      actorId: "u1",
    });
    expect(result.ok).toBe(true);
  });

  it("unbinds a feedback form when formId omitted", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(setFormBinding).mockResolvedValue({ ok: true });
    await runManageEducationOffering(ctx(), {
      action: "set_form_binding",
      offeringId: "o1",
      slot: "instructor-exit",
    });
    expect(setFormBinding).toHaveBeenCalledWith(
      expect.objectContaining({ formId: null }),
    );
  });

  it("rejects non-manager for set_decision_email", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    await expect(
      runManageEducationOffering(ctx(), {
        action: "set_decision_email",
        offeringId: "o1",
        decisionStatus: "Approved",
        emailTemplateVersionId: "ver1",
      }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });

  it("sets decision email via runOfferingAction", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "o1" });
    const result = await runManageEducationOffering(ctx(), {
      action: "set_decision_email",
      offeringId: "o1",
      decisionStatus: "Approved",
      emailTemplateVersionId: "ver1",
    });
    expect(runOfferingAction).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });
});
