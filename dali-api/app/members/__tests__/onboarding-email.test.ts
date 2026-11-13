import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { acceptanceEmailVars, acceptanceLogoHtml } from "~/members/lib/welcome.server";

describe("acceptanceEmailVars", () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = "https://os.dali.dartmouth.edu";
    delete process.env.SLACK_WORKSPACE_URL;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("passes the provisioned address and one-time password through for a new account", () => {
    const vars = acceptanceEmailVars({
      daliEmail: "test.onboarding@dali.dartmouth.edu",
      daliTempPassword: "temp-pw-123",
    });
    expect(vars.daliEmail).toBe("test.onboarding@dali.dartmouth.edu");
    expect(vars.tempPassword).toBe("temp-pw-123");
    expect(vars.loginUrl).toBe("https://os.dali.dartmouth.edu/login");
    expect(vars.slackUrl).toBe("https://dali-lab.slack.com");
  });

  it("points at the existing password when the account already existed", () => {
    const vars = acceptanceEmailVars({
      daliEmail: "test.onboarding@dali.dartmouth.edu",
      daliTempPassword: null,
    });
    expect(vars.daliEmail).toBe("test.onboarding@dali.dartmouth.edu");
    expect(vars.tempPassword).toBe("your existing password");
  });

  it("falls back to the member's existing DALI address when nothing was provisioned", () => {
    const vars = acceptanceEmailVars(null, "core.member@dali.dartmouth.edu");
    expect(vars.daliEmail).toBe("core.member@dali.dartmouth.edu");
    expect(vars.tempPassword).toBe("your existing password");
  });

  it("says the login details arrive separately when provisioning hasn't finished", () => {
    const vars = acceptanceEmailVars({ daliEmail: null, daliTempPassword: null });
    expect(vars.daliEmail).toContain("arrive in a separate email");
    expect(vars.tempPassword).toContain("arriving with your DALI email");
  });

  it("uses SLACK_WORKSPACE_URL when set, without a trailing slash", () => {
    process.env.SLACK_WORKSPACE_URL = "https://dali.enterprise.slack.com/";
    const vars = acceptanceEmailVars(null);
    expect(vars.slackUrl).toBe("https://dali.enterprise.slack.com");
  });
});

describe("acceptanceLogoHtml", () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = "https://os.dali.dartmouth.edu";
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("renders the absolute logo image", () => {
    const html = acceptanceLogoHtml();
    expect(html).toContain('src="https://os.dali.dartmouth.edu/logo-blue.png"');
    expect(html).toContain("<img");
  });
});
