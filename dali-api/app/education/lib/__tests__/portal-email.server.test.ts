import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { featureFlag: { findMany: vi.fn(async () => []) } },
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
import { sendEducationEmail } from "~/education/lib/portal-email.server";

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;
const sent = () => mockEnqueue.mock.calls[0][0];

const BASE = {
  to: "student@dartmouth.edu",
  recipientUserId: "u1",
  dedupKey: "education.assignment:a1:u1",
  eventType: "education.assignment",
  subject: "New assignment in Intro to UX: Wireframes",
  firstName: "Alex",
  paragraphs: ["A new assignment is due Friday."],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendEducationEmail", () => {
  it("sends as the Education identity", async () => {
    await sendEducationEmail(BASE);
    expect(sent().purpose).toBe("Education");
  });

  it("escapes the recipient's name and the body", async () => {
    await sendEducationEmail({
      ...BASE,
      firstName: "<b>Alex</b>",
      paragraphs: ["a < b & c"],
    });
    expect(sent().bodyHtml).not.toContain("<b>Alex</b>");
    expect(sent().bodyHtml).toContain("&lt;");
    expect(sent().bodyHtml).toContain("&amp;");
  });

  it("turns the CTA into an absolute link", async () => {
    await sendEducationEmail({
      ...BASE,
      cta: { path: "/education/1/assignments/2", label: "Open the assignment" },
    });
    expect(sent().bodyHtml).toContain(
      'href="https://os.dali.dartmouth.edu/education/1/assignments/2"',
    );
  });

  it("puts the CTA in the text part as a bare URL", async () => {
    await sendEducationEmail({
      ...BASE,
      cta: { path: "/education/1/hub", label: "Open the course hub" },
    });
    expect(sent().bodyText).toContain(
      "Open the course hub: https://os.dali.dartmouth.edu/education/1/hub",
    );
  });

  it("works without a CTA", async () => {
    await sendEducationEmail(BASE);
    expect(sent().bodyHtml).toContain("A new assignment is due Friday.");
    expect(sent().bodyText).toBeTruthy();
  });

  it("adds no non-prod banner of its own", async () => {
    // Env safety is the transport's. The producer used to redirect and prepend a
    // banner too, so staging mail carried two and the transport's named the test
    // inbox rather than the student.
    await sendEducationEmail(BASE);
    expect(sent().bodyHtml).not.toContain("Test environment");
    expect(sent().target).toBe("student@dartmouth.edu");
  });

  it("renders several paragraphs", async () => {
    await sendEducationEmail({ ...BASE, paragraphs: ["First.", "Second."] });
    expect(sent().bodyHtml).toContain("First.");
    expect(sent().bodyHtml).toContain("Second.");
    expect(sent().bodyText).toContain("First.");
    expect(sent().bodyText).toContain("Second.");
  });
});
