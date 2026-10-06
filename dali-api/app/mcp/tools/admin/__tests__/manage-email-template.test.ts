import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    emailTemplateVersion: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
vi.mock("~/email/lib/templates.server", () => ({
  getEmailTemplate: vi.fn(),
  saveEmailTemplate: vi.fn(),
  rollbackEmailTemplate: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { enqueueOutbound } from "~/lib/outbound.server";
import {
  getEmailTemplate,
  saveEmailTemplate,
  rollbackEmailTemplate,
} from "~/email/lib/templates.server";
import {
  runManageEmailTemplate,
  MANAGE_EMAIL_TEMPLATE_TOOL,
} from "~/mcp/tools/admin/manage-email-template";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  emailTemplateVersion: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};
const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;

function makeCtx(userId = "u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: "lead@dali.dartmouth.edu",
      dartmouthEmail: null,
      netId: null,
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: "lead@dali.dartmouth.edu" });
});

describe("manage_email_template", () => {
  it("declares the admin scope", () => {
    expect(MANAGE_EMAIL_TEMPLATE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("refuses a non-Core caller", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageEmailTemplate(makeCtx(), { action: "save", key: "hiring:decision:Accepted" }),
    ).rejects.toThrow(/Core/);
  });

  it("rejects an unknown key instead of silently writing nothing", async () => {
    // The failure mode of the previous tool: it wrote to a store with no readers,
    // so a call could look successful and change no outbound email.
    await expect(
      runManageEmailTemplate(makeCtx(), { action: "save", key: "nope", subject: "s", body: "b" }),
    ).rejects.toThrow(/Unknown email key/);
    expect(saveEmailTemplate).not.toHaveBeenCalled();
  });

  describe("save", () => {
    it("writes the copy for the key", async () => {
      const res = await runManageEmailTemplate(makeCtx(), {
        action: "save",
        key: "hiring:decision:Accepted",
        subject: "Welcome",
        body: "Hi {{firstName}}",
      });
      expect(saveEmailTemplate).toHaveBeenCalledWith(
        "hiring:decision:Accepted",
        { subject: "Welcome", body: "Hi {{firstName}}" },
        "u1",
      );
      expect(res).toEqual({ key: "hiring:decision:Accepted", saved: true });
    });
  });

  describe("clear", () => {
    it("turns off an email whose absence just skips the send", async () => {
      const res = await runManageEmailTemplate(makeCtx(), {
        action: "clear",
        key: "hiring:notification:InterviewReminderApplicant",
      });
      expect(saveEmailTemplate).toHaveBeenCalledWith(
        "hiring:notification:InterviewReminderApplicant",
        { subject: "", body: "" },
        "u1",
      );
      expect(res).toMatchObject({ cleared: true });
    });

    it("refuses to clear one whose absence blocks a release", async () => {
      await expect(
        runManageEmailTemplate(makeCtx(), { action: "clear", key: "hiring:decision:Accepted" }),
      ).rejects.toThrow(/can't be turned off/);
      expect(saveEmailTemplate).not.toHaveBeenCalled();
    });
  });

  describe("rollback", () => {
    it("restores a version by its number", async () => {
      mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue({ id: "v-3" });
      const res = await runManageEmailTemplate(makeCtx(), {
        action: "rollback",
        key: "hiring:decision:Accepted",
        versionNumber: 3,
      });
      expect(rollbackEmailTemplate).toHaveBeenCalledWith(
        "hiring:decision:Accepted",
        "v-3",
        "u1",
      );
      expect(res).toMatchObject({ restoredVersion: 3 });
    });

    it("404s on a version that isn't this email's", async () => {
      mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue(null);
      await expect(
        runManageEmailTemplate(makeCtx(), {
          action: "rollback",
          key: "hiring:decision:Accepted",
          versionNumber: 99,
        }),
      ).rejects.toThrow(/no version 99/);
    });
  });

  describe("send_test", () => {
    it("sends as the identity the email really uses, not a hardcoded one", async () => {
      vi.mocked(getEmailTemplate).mockResolvedValue({
        subject: "Welcome {{firstName}}",
        body: "Hi {{firstName}}",
      });
      await runManageEmailTemplate(makeCtx(), {
        action: "send_test",
        key: "education:decision:Approved",
      });
      const arg = mockEnqueue.mock.calls[0][0];
      // The old tool hardcoded purpose "Hiring", so an education template's test
      // arrived from applications@.
      expect(arg.purpose).toBe("Education");
      expect(arg.target).toBe("lead@dali.dartmouth.edu");
      expect(arg.subject).toContain("[TEST]");
      // Rendered with sample values, so no raw placeholder reaches the inbox.
      expect(arg.subject).not.toContain("{{firstName}}");
      expect(arg.dedupKey).toBeUndefined();
    });

    it("refuses when nothing is written yet", async () => {
      vi.mocked(getEmailTemplate).mockResolvedValue(null);
      await expect(
        runManageEmailTemplate(makeCtx(), {
          action: "send_test",
          key: "education:decision:Approved",
        }),
      ).rejects.toThrow(/no copy written/);
    });

    it("refuses when the caller has no DALI address", async () => {
      vi.mocked(getEmailTemplate).mockResolvedValue({ subject: "s", body: "b" });
      mockPrisma.user.findUnique.mockResolvedValue({ daliEmail: null });
      await expect(
        runManageEmailTemplate(makeCtx(), {
          action: "send_test",
          key: "education:decision:Approved",
        }),
      ).rejects.toThrow(/DALI email/);
    });
  });
});
