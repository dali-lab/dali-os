import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// welcome.server imports ~/lib/db at module load; stub it so the import resolves
// (onboardingEmailHtml itself touches no DB).
vi.mock("~/lib/db", () => ({ prisma: {} }));

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

  it("renders the temp password + DALI email when both are present", () => {
    const html = onboardingEmailHtml("test.onboarding@dali.dartmouth.edu", "temp-pw-123");
    expect(html).toContain("test.onboarding@dali.dartmouth.edu");
    expect(html).toContain("temp-pw-123");
    expect(html).toContain("set a password on first login");
    expect(html).toContain("https://os.dali.dartmouth.edu/login");
  });

  it("does not show a password when none is provided (account already existed)", () => {
    const html = onboardingEmailHtml("test.onboarding@dali.dartmouth.edu", null);
    expect(html).toContain("test.onboarding@dali.dartmouth.edu");
    expect(html).toContain("existing password");
    expect(html).not.toContain("Password:");
  });

  it("shows the 'account is being set up' fallback when there's no DALI email", () => {
    const html = onboardingEmailHtml(null, null);
    expect(html).toContain("being set up");
    expect(html).not.toContain("Password:");
  });

  it("shows the workspace 'a teammate will add you' line", () => {
    const html = onboardingEmailHtml("a@dali.dartmouth.edu", "pw");
    expect(html).toContain("a teammate will add you");
    expect(html).toContain("https://dali-lab.slack.com");
    expect(html).not.toContain("Join the DALI Slack");
  });

  it("stays manual even if SLACK_INVITE_URL is set (Enterprise has no public links)", () => {
    process.env.SLACK_INVITE_URL = "https://join.slack.com/t/dali-lab/shared_invite/zt-abc";
    const html = onboardingEmailHtml("a@dali.dartmouth.edu", "pw");
    expect(html).toContain("a teammate will add you");
    expect(html).not.toContain("Join the DALI Slack");
    expect(html).not.toContain("https://join.slack.com/t/dali-lab/shared_invite/zt-abc");
  });
});
