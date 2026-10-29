import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// onboardingEmailHtml reads its prose from the template store now, so the stub
// needs the one accessor that path uses. findUnique → null means no operator has
// edited it, which falls back to the registry wording these assertions describe.
vi.mock("~/lib/db", () => ({
  prisma: { emailTemplate: { findUnique: vi.fn(async () => null) } },
}));

import { prisma } from "~/lib/db";
import { onboardingEmailHtml } from "~/members/lib/welcome.server";

describe("onboardingEmailHtml", () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = "https://os.dali.dartmouth.edu";
    delete process.env.SLACK_INVITE_URL;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("renders the temp password + DALI email when both are present", async () => {
    const html = await onboardingEmailHtml("test.onboarding@dali.dartmouth.edu", "temp-pw-123");
    expect(html).toContain("test.onboarding@dali.dartmouth.edu");
    expect(html).toContain("temp-pw-123");
    expect(html).toContain("set a password on first login");
    expect(html).toContain("https://os.dali.dartmouth.edu/login");
  });

  it("does not show a password when none is provided (account already existed)", async () => {
    const html = await onboardingEmailHtml("test.onboarding@dali.dartmouth.edu", null);
    expect(html).toContain("test.onboarding@dali.dartmouth.edu");
    expect(html).toContain("existing password");
    expect(html).not.toContain("Password:");
  });

  it("shows the 'account is being set up' fallback when there's no DALI email", async () => {
    const html = await onboardingEmailHtml(null, null);
    expect(html).toContain("being set up");
    expect(html).not.toContain("Password:");
  });

  it("shows the workspace 'a teammate will add you' line", async () => {
    const html = await onboardingEmailHtml("a@dali.dartmouth.edu", "pw");
    expect(html).toContain("teammate will add you");
    expect(html).toContain("https://dali-lab.slack.com");
    expect(html).not.toContain("Join the DALI Slack");
  });

  it("stays manual even if SLACK_INVITE_URL is set (Enterprise has no public links)", async () => {
    process.env.SLACK_INVITE_URL = "https://join.slack.com/t/dali-lab/shared_invite/zt-abc";
    const html = await onboardingEmailHtml("a@dali.dartmouth.edu", "pw");
    expect(html).toContain("teammate will add you");
    expect(html).not.toContain("Join the DALI Slack");
    expect(html).not.toContain("https://join.slack.com/t/dali-lab/shared_invite/zt-abc");
  });

  describe("next-steps block", () => {
    it("fills the start term and respond-by date into the default copy", async () => {
      const html = await onboardingEmailHtml("a@dali.dartmouth.edu", "pw", {
        startTerm: "27W",
        respondBy: "Monday, June 8, 2026",
      });
      expect(html).toContain("The deadline to accept your offer and complete onboarding is Monday, June 8, 2026.");
      expect(html).toContain("an incredible 27W together");
      expect(html).not.toContain("26F");
      expect(html).not.toContain("June 8th");
    });

    it("fills them into an operator-edited template too", async () => {
      vi.mocked(prisma.emailTemplate.findUnique).mockResolvedValueOnce({
        key: "hiring:onboarding:NextSteps",
        subject: "Next steps",
        body: "Accept by {{respondBy}}. See you in {{startTerm}}.",
      } as any);
      const html = await onboardingEmailHtml("a@dali.dartmouth.edu", "pw", {
        startTerm: "26F",
        respondBy: "Friday, September 4, 2026",
      });
      expect(html).toContain("Accept by Friday, September 4, 2026. See you in 26F.");
      expect(vi.mocked(prisma.emailTemplate.findUnique)).toHaveBeenCalledWith({
        where: { key: "hiring:onboarding:NextSteps" },
      });
    });

    it("escapes the values it splices in", async () => {
      const html = await onboardingEmailHtml("a@dali.dartmouth.edu", "pw", { startTerm: "<b>27W</b>" });
      expect(html).not.toContain("<b>27W</b>");
      expect(html).toContain("&lt;b&gt;27W&lt;/b&gt;");
    });
  });
});
