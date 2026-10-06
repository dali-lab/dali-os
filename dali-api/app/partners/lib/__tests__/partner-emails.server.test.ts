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
  sendContractSentEmail,
  sendSowSharedEmail,
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

  it("escapes a contact name on the contract-sent email", async () => {
    await sendContractSentEmail("p@x.com", '<img src=x onerror="alert(1)">', "https://os.dali.dartmouth.edu/x");
    expect(sent().bodyHtml).not.toContain("<img");
  });

  it("escapes a contact name on the SOW-shared email", async () => {
    await sendSowSharedEmail("p@x.com", "<b>Ada</b>", "app-1");
    expect(sent().bodyHtml).not.toContain("<b>Ada</b>");
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
