import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { emailTemplate: { findUnique: vi.fn(async () => null) } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/email/lib/layout.server", () => ({ renderMemberEmail: vi.fn() }));
vi.mock("~/email/lib/notification-render.server", () => ({
  renderNotificationCopy: vi.fn(),
  resolveNotificationCopy: vi.fn(),
}));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: vi.fn(), drainNow: vi.fn() }));
vi.mock("~/lib/app-env", () => ({
  getAppEnv: vi.fn(() => "development"),
  getFrontendUrl: vi.fn(() => "https://os.test"),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  slackConfigured: vi.fn(() => false),
  sendDm: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { onboardingEmailHtml } from "~/members/lib/welcome.server";

const findUnique = vi.mocked(prisma.emailTemplate.findUnique);

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue(null as never);
});

describe("onboardingEmailHtml", () => {
  it("renders a new account's credentials through the editable template", async () => {
    const html = await onboardingEmailHtml("ada.l@dali.dartmouth.edu", "pw-one-time-42", {});
    expect(html).toContain("ada.l@dali.dartmouth.edu");
    expect(html).toContain("pw-one-time-42");
    expect(html).toContain('href="https://os.test/login"');
  });

  it("uses the operator's edited credentials copy when one is saved", async () => {
    findUnique.mockImplementation((async (args: { where: { key: string } }) =>
      args.where.key === "hiring:onboarding:Credentials"
        ? { key: args.where.key, subject: "s", body: "Custom: {{daliEmail}} + {{tempPassword}}" }
        : null) as never);
    const html = await onboardingEmailHtml("ada.l@dali.dartmouth.edu", "pw-one-time-42", {});
    expect(html).toContain("Custom: ada.l@dali.dartmouth.edu + pw-one-time-42");
  });

  it("points an existing account at its current password, with none shown", async () => {
    const html = await onboardingEmailHtml("ada.l@dali.dartmouth.edu", null, {});
    expect(html).toContain("existing password");
    expect(html).toContain("ada.l@dali.dartmouth.edu");
  });

  it("says the account is still being set up when provisioning hasn't finished", async () => {
    const html = await onboardingEmailHtml(null, null, {});
    expect(html).toContain("being set up");
  });
});
