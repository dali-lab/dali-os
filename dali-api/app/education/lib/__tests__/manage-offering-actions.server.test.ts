import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn() },
    projectFile: { findUnique: vi.fn(), update: vi.fn() },
    educationApplication: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));
vi.mock("~/education/lib/offerings.server", () => ({ runOfferingAction: vi.fn() }));
vi.mock("~/education/lib/decisions.server", () => ({
  decideApplication: vi.fn(),
  approveAllPending: vi.fn(),
  moveWaitlistEntry: vi.fn(),
}));
vi.mock("~/education/lib/lms.server", () => ({
  createMaterialPage: vi.fn(),
  moveMaterialPage: vi.fn(),
  moveMaterialFile: vi.fn(),
  renameMaterialPage: vi.fn(),
  renameMaterialFile: vi.fn(),
  archiveMaterialPage: vi.fn(),
  archiveMaterialFile: vi.fn(),
}));
vi.mock("~/education/lib/session-checkin.server", () => ({ setSessionCheckInOpen: vi.fn() }));
vi.mock("~/education/lib/assignments.server", () => ({
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
}));
vi.mock("~/education/lib/announcements.server", () => ({
  postAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));
vi.mock("~/education/lib/attendance.server", () => ({ saveAttendance: vi.fn() }));
vi.mock("~/education/lib/student-notes.server", () => ({ upsertStudentNote: vi.fn() }));
vi.mock("~/education/lib/certificate-templates.server", () => ({
  bindOfferingCertificateTemplate: vi.fn(),
}));
vi.mock("~/education/lib/certificates.server", () => ({
  closeOutOffering: vi.fn(),
  reopenOffering: vi.fn(),
  previewCloseOut: vi.fn(),
}));
vi.mock("~/education/lib/feedback.server", () => ({ setFormBinding: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { runOfferingAction } from "~/education/lib/offerings.server";
import { decideApplication } from "~/education/lib/decisions.server";
import { saveAttendance } from "~/education/lib/attendance.server";
import { bindOfferingCertificateTemplate } from "~/education/lib/certificate-templates.server";
import {
  MANAGE_CONTENT_ACTIONS,
  runManageOfferingAction,
} from "../manage-offering-actions.server";

const db = prisma as any;

function post(fields: Record<string, string>) {
  return new Request("http://localhost/education/manage/off1", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}
const run = (fields: Record<string, string>) => runManageOfferingAction(post(fields), "off1");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isOfferingManager).mockResolvedValue(true);
});

describe("content intents", () => {
  it("registers the 25 content intents", () => {
    expect(Object.keys(MANAGE_CONTENT_ACTIONS)).toHaveLength(25);
  });

  it("returns 403 for a non-manager and runs nothing", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    const res = (await run({ intent: "decide-application", applicationId: "a1", status: "Approved" })) as Response;
    expect(res.status).toBe(403);
    expect(decideApplication).not.toHaveBeenCalled();
  });

  it("scopes a decision to the URL offering and the actor", async () => {
    vi.mocked(decideApplication).mockResolvedValue({ ok: true } as never);
    expect(await run({ intent: "decide-application", applicationId: "a1", status: "Approved" })).toEqual({
      ok: true,
    });
    expect(decideApplication).toHaveBeenCalledWith({
      applicationId: "a1",
      offeringId: "off1",
      status: "Approved",
      actorId: "u1",
    });
  });

  it("maps an error result to a JSON response with its status", async () => {
    vi.mocked(decideApplication).mockResolvedValue({ error: "Nope", status: 422 } as never);
    const res = (await run({ intent: "decide-application", applicationId: "a1", status: "Approved" })) as Response;
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nope" });
  });

  it("save-attendance parses mark fields and turns empty into null", async () => {
    vi.mocked(saveAttendance).mockResolvedValue({ ok: true } as never);
    await run({ intent: "save-attendance", sessionId: "s1", "mark-a1": "Present", "mark-a2": "" });
    expect(saveAttendance).toHaveBeenCalledWith({
      offeringId: "off1",
      sessionId: "s1",
      marks: [
        { applicationId: "a1", status: "Present" },
        { applicationId: "a2", status: null },
      ],
      actorId: "u1",
    });
  });

  it("set-material-session refuses a page from another workspace", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "EducationOffering", workspaceId: "other" });
    const res = (await run({ intent: "set-material-session", pageId: "p1", sessionId: "s1" })) as Response;
    expect(res.status).toBe(404);
    expect(db.page.update).not.toHaveBeenCalled();
  });

  it("set-material-session updates a page in this offering and clears with an empty session", async () => {
    db.page.findUnique.mockResolvedValue({ workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(await run({ intent: "set-material-session", pageId: "p1", sessionId: "" })).toEqual({ ok: true });
    expect(db.page.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { sessionId: null } });
  });

  it("save-student-note refuses an application from another offering", async () => {
    db.educationApplication.findUnique.mockResolvedValue({ offeringId: "other" });
    const res = (await run({ intent: "save-student-note", applicationId: "a1" })) as Response;
    expect(res.status).toBe(404);
  });

  it("bind-certificate-template is Core only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await run({ intent: "bind-certificate-template", templateId: "t1" })) as Response;
    expect(res.status).toBe(403);
    expect(bindOfferingCertificateTemplate).not.toHaveBeenCalled();
  });
});

describe("offering intents", () => {
  it("pins the offering id from the URL over a form-supplied one", async () => {
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true } as never);
    await run({ intent: "update-offering", offeringId: "other" });
    const [fd, userId] = vi.mocked(runOfferingAction).mock.calls[0];
    expect((fd as FormData).get("offeringId")).toBe("off1");
    expect(userId).toBe("u1");
  });

  it("maps an error result to its status", async () => {
    vi.mocked(runOfferingAction).mockResolvedValue({ error: "Nope", status: 400 } as never);
    const res = (await run({ intent: "update-offering" })) as Response;
    expect(res.status).toBe(400);
  });

  it("delete-offering redirects to the offerings list", async () => {
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true } as never);
    const res = (await run({ intent: "delete-offering" })) as Response;
    expect(res.headers.get("Location")).toBe("/education/offerings");
  });

  it("duplicate-offering redirects to the new offering", async () => {
    vi.mocked(runOfferingAction).mockResolvedValue({ ok: true, id: "new1" } as never);
    const res = (await run({ intent: "duplicate-offering" })) as Response;
    expect(res.headers.get("Location")).toBe("/education/manage/new1");
  });
});

describe("auth", () => {
  it("returns the auth response when signed out", async () => {
    const response = new Response(null, { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response } as never);
    expect(await run({ intent: "decide-application" })).toBe(response);
  });
});
