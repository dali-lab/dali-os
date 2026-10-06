import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    featureFlag: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
vi.mock("~/lib/app-env", () => ({
  getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu"),
  getAppEnv: vi.fn(() => "prod"),
}));

import { enqueueOutbound } from "~/lib/outbound.server";
import {
  sendTriageNextStepsEmail,
  sendDecisionAcceptedEmail,
  sendDecisionRejectedEmail,
  sendLearnMoreRequestEmail,
  sendMeetingInviteEmail,
  sendMemberEmailConflictEmail,
  sendPartnerSurveyEmail,
} from "~/partners/lib/partner-emails.server";

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const sent = () => mockEnqueue.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("partner emails escape interpolated values", () => {
  // Contact names, org names and the free-text blocks an operator types into the
  // triage / reject / learn-more modals were spliced into markup raw. A partner
  // controls their own contact name, so this was reachable.
  it("escapes a contact name", async () => {
    await sendTriageNextStepsEmail("p@x.com", '<img src=x onerror="alert(1)">', "steps");
    expect(sent().bodyHtml).not.toContain("<img");
    expect(sent().bodyHtml).toContain("&lt;img");
  });

  it("escapes an operator-typed next-steps block", async () => {
    await sendTriageNextStepsEmail("p@x.com", "Ada", "<script>alert(1)</script>");
    expect(sent().bodyHtml).not.toContain("<script>");
  });

  it("escapes a project name", async () => {
    await sendDecisionAcceptedEmail("p@x.com", "Ada", "<b>Proj</b> & Co");
    expect(sent().bodyHtml).not.toContain("<b>Proj</b>");
    expect(sent().bodyHtml).toContain("&amp;");
  });

  it("escapes a rejection reason", async () => {
    await sendDecisionRejectedEmail("p@x.com", "Ada", "<i>scope</i>");
    expect(sent().bodyHtml).not.toContain("<i>scope</i>");
  });

  it("escapes the learn-more request", async () => {
    await sendLearnMoreRequestEmail("p@x.com", "Ada", "a < b & c");
    expect(sent().bodyHtml).toContain("&lt;");
    expect(sent().bodyHtml).toContain("&amp;");
  });

  it("escapes a proposed meeting time", async () => {
    await sendMeetingInviteEmail("p@x.com", "Ada", "Tue 2pm <ET>");
    expect(sent().bodyHtml).toContain("&lt;ET&gt;");
  });
});

describe("partner emails keep operator line breaks", () => {
  it("preserves newlines in a typed block without turning them into markup", async () => {
    await sendTriageNextStepsEmail("p@x.com", "Ada", "one\ntwo");
    // pre-wrap rather than <br>, so the text is escaped wholesale and the breaks
    // still render.
    expect(sent().bodyHtml).toContain("white-space:pre-wrap");
    expect(sent().bodyHtml).toContain("one\ntwo");
  });
});

describe("partner emails carry a text part", () => {
  it("ships a non-empty plain-text alternative", async () => {
    await sendTriageNextStepsEmail("p@x.com", "Ada", "steps");
    expect(sent().bodyText).toBeTruthy();
    expect(sent().bodyText).not.toMatch(/<[a-z]/i);
  });

  it("flattens the sign-in link to a readable URL", async () => {
    await sendMemberEmailConflictEmail("p@x.com");
    expect(sent().bodyText).toContain("https://os.dali.dartmouth.edu/login");
  });
});

describe("partner emails route to the Partners identity", () => {
  it("sends as Partners, not the hiring address", async () => {
    await sendDecisionAcceptedEmail("p@x.com", "Ada");
    expect(sent().purpose).toBe("Partners");
  });

  it("falls back to a neutral greeting when there is no name", async () => {
    await sendDecisionAcceptedEmail("p@x.com", null);
    expect(sent().bodyHtml).toContain("Hi there,");
  });
});

describe("sendPartnerSurveyEmail", () => {
  it("links to the survey url and dedupes per ProjectPartner", async () => {
    await sendPartnerSurveyEmail(
      "p@x.com",
      "Ada",
      "Alumni Connect",
      "https://os.dali.dartmouth.edu/partner/survey/pp1",
      "pp1",
    );
    expect(sent().bodyHtml).toContain("https://os.dali.dartmouth.edu/partner/survey/pp1");
    expect(sent().dedupKey).toBe("partner.survey.invite:pp1");
    expect(sent().eventType).toBe("partner.survey_invite");
  });

  it("escapes the project name", async () => {
    await sendPartnerSurveyEmail("p@x.com", "Ada", "<b>Proj</b> & Co", "https://x/survey/pp1", "pp1");
    expect(sent().bodyHtml).not.toContain("<b>Proj</b>");
    expect(sent().bodyHtml).toContain("&amp;");
  });
});
