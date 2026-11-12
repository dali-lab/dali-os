import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireEnrollment: vi.fn(),
  getOfferingDetail: vi.fn(),
  registrationOpen: vi.fn(() => true),
  loadOfferingApplicationForm: vi.fn(),
  submitApplication: vi.fn(),
  getMyApplication: vi.fn(),
  getHubData: vi.fn(),
  readMaterialPage: vi.fn(),
  runDiscussionAction: vi.fn(),
  recordRouteVisit: vi.fn(),
  withdrawApplication: vi.fn(),
  getAssignmentForStudent: vi.fn(),
  submitAssignment: vi.fn(),
  ensureDocSubmissionRow: vi.fn(),
  findOffering: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  prisma: { educationOffering: { findUnique: m.findOffering }, user: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }) }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn(async () => "tok") }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({ ensureBlocks: (v: unknown) => v }));
vi.mock("~/education/lib/access.server", () => ({ requireEnrollment: m.requireEnrollment }));
vi.mock("~/education/lib/offerings.server", () => ({
  getOfferingDetail: m.getOfferingDetail,
  registrationOpen: m.registrationOpen,
}));
vi.mock("~/education/lib/application-form.server", () => ({ loadOfferingApplicationForm: m.loadOfferingApplicationForm }));
vi.mock("~/education/lib/apply.server", () => ({
  submitApplication: m.submitApplication,
  getMyApplication: m.getMyApplication,
}));
vi.mock("~/education/lib/lms.server", () => ({ getHubData: m.getHubData, readMaterialPage: m.readMaterialPage }));
vi.mock("~/education/lib/discussions.server", () => ({ runDiscussionAction: m.runDiscussionAction }));
vi.mock("~/education/lib/decisions.server", () => ({ withdrawApplication: m.withdrawApplication }));
vi.mock("~/education/lib/assignments.server", () => ({
  getAssignmentForStudent: m.getAssignmentForStudent,
  submitAssignment: m.submitAssignment,
  ensureDocSubmissionRow: m.ensureDocSubmissionRow,
}));
vi.mock("~/lib/user-pages.server", () => ({ recordRouteVisit: m.recordRouteVisit }));

import { MEMBER_SURFACE, PORTAL_SURFACE } from "../offering-surface";
import {
  hubAction,
  loadApply,
  loadAssignment,
  loadHub,
  loadMaterialPage,
  submitApplyAction,
  submitAssignmentAction,
  withdrawOfferingAction,
} from "../offering-surface.server";

const args = (url = "http://x/y", extra: Record<string, string> = {}, init?: RequestInit) => ({
  request: new Request(url, init),
  params: { offeringId: "o1", assignmentId: "a1", pageId: "p1", ...extra },
});
const asUser = (type: string) =>
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type, firstName: "Ada", lastName: "Lovelace" } });
const loc = (r: unknown) => (r as Response).headers.get("Location");

beforeEach(() => {
  vi.clearAllMocks();
  m.registrationOpen.mockReturnValue(true);
  m.findOffering.mockResolvedValue({ title: "Intro" });
});

describe("loadApply", () => {
  it("sends a Dartmouth account on the member surface to the portal apply page", async () => {
    asUser("dartmouth");
    expect(loc(await loadApply(args(), MEMBER_SURFACE))).toBe("/portal/education/o1/apply");
  });

  it("sends a member on the portal surface to the member apply page", async () => {
    asUser("member");
    expect(loc(await loadApply(args(), PORTAL_SURFACE))).toBe("/education/o1/apply");
  });

  it("does not redirect the matching audience and 404s an unpublished offering", async () => {
    asUser("member");
    m.getOfferingDetail.mockResolvedValue({ id: "o1", status: "Draft" });
    await expect(loadApply(args(), MEMBER_SURFACE)).rejects.toMatchObject({ status: 404 });
    asUser("dartmouth");
    await expect(loadApply(args(), PORTAL_SURFACE)).rejects.toMatchObject({ status: 404 });
  });

  it("goes to login when signed out", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect(loc(await loadApply(args(), PORTAL_SURFACE))).toBe("/login");
  });
});

describe("submitApplyAction", () => {
  const post = (answers: string) => {
    const body = new FormData();
    body.set("answers", answers);
    return args("http://x/y", {}, { method: "POST", body });
  };

  it.each([
    [MEMBER_SURFACE, "/education/o1"],
    [PORTAL_SURFACE, "/portal/education/o1"],
  ])("redirects to the offering under %o base", async (surface, target) => {
    asUser("member");
    m.submitApplication.mockResolvedValue({ ok: true });
    expect(loc(await submitApplyAction(post("{}"), surface))).toBe(target);
  });

  it("rejects a malformed answers payload without submitting", async () => {
    asUser("member");
    const res = (await submitApplyAction(post("[1]"), PORTAL_SURFACE)) as Response;
    expect(res.status).toBe(400);
    expect(m.submitApplication).not.toHaveBeenCalled();
  });
});

describe("loadHub / hubAction", () => {
  beforeEach(() => {
    m.getHubData.mockResolvedValue({ offering: { id: "o1", title: "Intro" } });
  });

  it("gates with the surface kind and records the visit only on the member surface", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: false });
    await loadHub(args(), MEMBER_SURFACE);
    expect(m.requireEnrollment).toHaveBeenLastCalledWith(expect.any(Request), "o1", "member");
    expect(m.recordRouteVisit).toHaveBeenCalledWith("u1", "/education/o1/hub", "Intro", expect.any(Request));
    m.recordRouteVisit.mockClear();
    await loadHub(args(), PORTAL_SURFACE);
    expect(m.requireEnrollment).toHaveBeenLastCalledWith(expect.any(Request), "o1", "portal");
    expect(m.recordRouteVisit).not.toHaveBeenCalled();
  });

  it("previews as a student only for managers", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: null, isManager: true });
    const out = await loadHub(args("http://x/hub?as=student"), MEMBER_SURFACE);
    expect(out.previewAsStudent).toBe(true);
    expect(m.getHubData).toHaveBeenLastCalledWith(expect.objectContaining({ isManager: false }));
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: false });
    expect((await loadHub(args("http://x/hub?as=student"), PORTAL_SURFACE)).previewAsStudent).toBe(false);
  });

  it("404s when there is no hub", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: false });
    m.getHubData.mockResolvedValue(null);
    await expect(loadHub(args(), PORTAL_SURFACE)).rejects.toMatchObject({ status: 404 });
  });

  it("passes the manager flag to discussion actions", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: true });
    await hubAction(args("http://x/hub", {}, { method: "POST", body: new FormData() }), MEMBER_SURFACE);
    expect(m.runDiscussionAction).toHaveBeenCalledWith(expect.anything(), {
      offeringId: "o1",
      userId: "u1",
      isManager: true,
    });
  });
});

describe("loadMaterialPage", () => {
  it("gates by surface kind, 404s a missing page and returns the manager flag", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: true });
    m.readMaterialPage.mockResolvedValue(null);
    await expect(loadMaterialPage(args(), PORTAL_SURFACE)).rejects.toMatchObject({ status: 404 });
    expect(m.requireEnrollment).toHaveBeenLastCalledWith(expect.any(Request), "o1", "portal");
    m.readMaterialPage.mockResolvedValue({ id: "p1", title: "Notes", studentEditable: false, content: null });
    const out = await loadMaterialPage(args(), MEMBER_SURFACE);
    expect(out).toMatchObject({ offeringTitle: "Intro", isManager: true, collabToken: null, userName: "Student" });
  });
});

describe("assignments", () => {
  it("gates the loader with the surface kind and 404s a missing assignment", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: false });
    m.getAssignmentForStudent.mockResolvedValue(null);
    await expect(loadAssignment(args(), PORTAL_SURFACE)).rejects.toMatchObject({ status: 404 });
    expect(m.requireEnrollment).toHaveBeenLastCalledWith(expect.any(Request), "o1", "portal");
  });

  it("refuses a submit without an application with each surface's message", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: null, isManager: true });
    const req = () => args("http://x/a", {}, { method: "POST", body: new FormData() });
    const member = (await submitAssignmentAction(req(), MEMBER_SURFACE)) as Response;
    const portal = (await submitAssignmentAction(req(), PORTAL_SURFACE)) as Response;
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({ error: "Manager preview can't submit assignments." });
    expect(await portal.json()).toEqual({ error: "Not enrolled." });
    expect(m.submitAssignment).not.toHaveBeenCalled();
  });

  it("submits for an enrolled student", async () => {
    m.requireEnrollment.mockResolvedValue({ auth: { user: { sub: "u1" } }, applicationId: "ap", isManager: false });
    m.submitAssignment.mockResolvedValue({ ok: true });
    const body = new FormData();
    body.set("textContent", "hi");
    const out = await submitAssignmentAction(args("http://x/a", {}, { method: "POST", body }), PORTAL_SURFACE);
    expect(out).toEqual({ ok: true });
    expect(m.submitAssignment).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "ap", textContent: "hi" }));
  });
});

describe("withdrawOfferingAction", () => {
  it("rejects unknown intents and withdraws on withdraw", async () => {
    asUser("member");
    const withIntent = (intent: string) => {
      const body = new FormData();
      body.set("intent", intent);
      return args("http://x/o", {}, { method: "POST", body });
    };
    expect(((await withdrawOfferingAction(withIntent("nope"))) as Response).status).toBe(400);
    m.withdrawApplication.mockResolvedValue({ ok: true });
    expect(await withdrawOfferingAction(withIntent("withdraw"))).toEqual({ ok: true });
    expect(m.withdrawApplication).toHaveBeenCalledWith({ userId: "u1", offeringId: "o1" });
  });
});
