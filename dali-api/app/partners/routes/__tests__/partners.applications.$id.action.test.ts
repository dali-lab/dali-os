import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles");
vi.mock("~/lib/feature-flags.server");
vi.mock("~/partners/lib/partner-emails.server");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  sendMeetingInviteEmail,
  sendTriageNextStepsEmail,
  sendDecisionRejectedEmail,
  sendLearnMoreRequestEmail,
  sendDecisionAcceptedEmail,
} from "~/partners/lib/partner-emails.server";
import { action } from "~/partners/routes/partners.applications.$id";

const db = prisma as unknown as Record<string, any>;
const APP_ID = "app-1";

function callAction(fields: Record<string, string | string[]>) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => form.append(k, x));
    else form.append(k, v);
  }
  const request = new Request(`http://localhost/partners/applications/${APP_ID}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return action({ request, params: { id: APP_ID }, context: {} } as any);
}

const applicant = { name: "Ada", email: "ada@acme.com" };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member", email: "c@dali", firstName: "C", lastName: "" },
  });
  (isCore as any).mockResolvedValue(true);
  (getUserRoles as any).mockResolvedValue({ isCore: true });
  (isFeatureEnabled as any).mockResolvedValue(true);
  db.partnerApplication.findUnique.mockResolvedValue({
    applicantContactId: "c1",
    applicantContact: applicant,
    title: "Gallery Kiosk",
  });
  db.partnerApplication.update.mockResolvedValue({});
  db.partnerMeeting.create.mockResolvedValue({});
  db.partnerMeeting.update.mockResolvedValue({});
});

describe("partner application CRM action — guards", () => {
  it("rejects non-Core callers", async () => {
    (isCore as any).mockResolvedValue(false);
    const res = await callAction({ intent: "accept" });
    expect(res).toMatchObject({ error: expect.stringContaining("permission") });
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
  });

  it("blocks CRM intents when the flag is off", async () => {
    (isFeatureEnabled as any).mockResolvedValue(false);
    const res = await callAction({ intent: "accept" });
    expect(res).toMatchObject({ error: expect.stringContaining("not enabled") });
    expect(db.partnerApplication.update).not.toHaveBeenCalled();
  });
});

describe("triage / decision intents", () => {
  it("offer-meeting sets status Meeting and emails the invite", async () => {
    const res = await callAction({ intent: "offer-meeting", when: "Tue 3pm", details: "Zoom" });
    expect(res).toBeInstanceOf(Response);
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Meeting" } }),
    );
    expect(sendMeetingInviteEmail).toHaveBeenCalledWith("ada@acme.com", "Ada", "Tue 3pm", "Zoom");
  });

  it("offer-meeting requires a time", async () => {
    const res = await callAction({ intent: "offer-meeting", when: "" });
    expect(res).toMatchObject({ error: expect.stringContaining("time") });
    expect(sendMeetingInviteEmail).not.toHaveBeenCalled();
  });

  it("send-application sets status Triaged and emails next steps", async () => {
    await callAction({ intent: "send-application" });
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Triaged" } }),
    );
    expect(sendTriageNextStepsEmail).toHaveBeenCalled();
  });

  it("reject records the reason and emails", async () => {
    await callAction({ intent: "reject", reason: "Out of scope" });
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Rejected", decisionReason: "Out of scope" } }),
    );
    expect(sendDecisionRejectedEmail).toHaveBeenCalledWith("ada@acme.com", "Ada", "Out of scope");
  });

  it("learn-more requires what-we-need and stores it", async () => {
    const empty = await callAction({ intent: "learn-more", whatWeNeed: "" });
    expect(empty).toMatchObject({ error: expect.any(String) });
    expect(sendLearnMoreRequestEmail).not.toHaveBeenCalled();

    await callAction({ intent: "learn-more", whatWeNeed: "Share user research" });
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "LearnMore", decisionReason: "Share user research" } }),
    );
    expect(sendLearnMoreRequestEmail).toHaveBeenCalledWith("ada@acme.com", "Ada", "Share user research");
  });

  it("accept sets status Accepted and emails with the project title", async () => {
    await callAction({ intent: "accept" });
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Accepted" } }),
    );
    expect(sendDecisionAcceptedEmail).toHaveBeenCalledWith("ada@acme.com", "Ada", "Gallery Kiosk");
  });

  it("assign-meeter stores the meeter id (no email)", async () => {
    await callAction({ intent: "assign-meeter", meeterId: "u-9" });
    expect(db.partnerApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedMeeterId: "u-9" } }),
    );
    expect(sendMeetingInviteEmail).not.toHaveBeenCalled();
  });
});

describe("eval + acceptance intents", () => {
  it("eval builds a rubric blob from valid 1-5 scores + interview rating", async () => {
    await callAction({
      intent: "eval",
      score_feasibility: "4",
      score_impact: "5",
      score_funding: "0", // out of range → dropped
      evalNotes: "Strong team",
      interviewRating: "4",
    });
    const arg = db.partnerApplication.update.mock.calls[0][0];
    expect(arg.data.evalRubric).toMatchObject({
      feasibility: 4,
      impact: 5,
      notes: "Strong team",
      criteriaVersion: expect.any(Number),
    });
    expect(arg.data.evalRubric.funding).toBeUndefined();
    expect(arg.data.interviewRating).toBe(4);
  });

  it("acceptance stores ambiguity rating (clamped) and funding model", async () => {
    await callAction({ intent: "acceptance", ambiguityRating: "9", fundingModel: "Grant" });
    const arg = db.partnerApplication.update.mock.calls[0][0];
    expect(arg.data.ambiguityRating).toBe(5); // clamped to 5
    expect(arg.data.fundingModel).toBe("Grant");
  });
});

describe("meeting intents", () => {
  it("meeting-create records a PartnerMeeting with attendees", async () => {
    await callAction({
      intent: "meeting-create",
      meetingDate: "2026-09-01T15:00",
      attendeeUserIds: ["u-1", "u-2"],
      meetingNotes: "Kickoff",
    });
    expect(db.partnerMeeting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: APP_ID,
          attendeeUserIds: ["u-1", "u-2"],
          contactId: "c1",
        }),
      }),
    );
  });

  it("meeting-create requires a date", async () => {
    const res = await callAction({ intent: "meeting-create", meetingDate: "" });
    expect(res).toMatchObject({ error: expect.stringContaining("date") });
    expect(db.partnerMeeting.create).not.toHaveBeenCalled();
  });

  it("meeting-debrief validates the outcome enum", async () => {
    await callAction({ intent: "meeting-debrief", meetingId: "m-1", debrief: "Good", outcome: "Advance" });
    expect(db.partnerMeeting.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m-1" }, data: { debrief: "Good", outcome: "Advance" } }),
    );

    db.partnerMeeting.update.mockClear();
    await callAction({ intent: "meeting-debrief", meetingId: "m-1", debrief: "x", outcome: "Bogus" });
    const arg = db.partnerMeeting.update.mock.calls[0][0];
    expect(arg.data.outcome).toBeUndefined(); // invalid outcome dropped
  });
});
