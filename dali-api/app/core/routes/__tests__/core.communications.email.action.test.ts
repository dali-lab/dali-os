import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: vi.fn(), drainNow: vi.fn() }));
vi.mock("~/email/lib/layout.server", () => ({ renderAuthEmail: vi.fn() }));
vi.mock("~/admin/components/EmailTemplatesAdmin", () => ({ EmailTemplatesAdmin: () => null }));
vi.mock("~/email/lib/templates.server", () => ({
  saveEmailTemplate: vi.fn(),
  rollbackEmailTemplate: vi.fn(),
  listEmailTemplates: vi.fn(),
  listEmailTemplateVersions: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { enqueueOutbound } from "~/lib/outbound.server";
import { renderAuthEmail } from "~/email/lib/layout.server";
import { isCore } from "~/lib/roles";
import { rollbackEmailTemplate, saveEmailTemplate } from "~/email/lib/templates.server";
import { EMAIL_TEMPLATES } from "~/email/lib/registry";
import { action } from "~/core/routes/core.communications.email";

const KEY = Object.keys(EMAIL_TEMPLATES)[0];

function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request = new Request("http://localhost/admin/email", { method: "POST", body });
  return { request, run: () => action({ request, params: {}, context: {} } as never) };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("admin.email action", () => {
  it("hands the request to save so the audit row carries the caller's ip", async () => {
    const { request, run } = submit({ intent: "save", key: KEY, subject: "S", body: "B", stay: "1" });
    await run();
    expect(saveEmailTemplate).toHaveBeenCalledWith(KEY, { subject: "S", body: "B" }, "u1", request);
  });

  it("hands the request to rollback", async () => {
    const { request, run } = submit({ intent: "rollback", key: KEY, versionId: "v3", stay: "1" });
    await run();
    expect(rollbackEmailTemplate).toHaveBeenCalledWith(KEY, "v3", "u1", request);
  });

  it("does not save for someone outside Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await submit({ intent: "save", key: KEY, subject: "S", body: "B" }).run();
    expect(saveEmailTemplate).not.toHaveBeenCalled();
  });

  describe("send-test", () => {
    const WAITLISTED = "hiring:decision:Waitlisted";
    beforeEach(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ daliEmail: "ada@example.edu" } as never);
      vi.mocked(renderAuthEmail).mockImplementation(
        ({ subject, bodyHtml }) => ({ subject, html: bodyHtml, text: subject }),
      );
      vi.mocked(enqueueOutbound).mockResolvedValue({ id: "o1" } as never);
    });
    const sentHtml = () => vi.mocked(enqueueOutbound).mock.calls[0]![0].bodyHtml;

    it("fills variables from the sample the editor sends", async () => {
      await submit({
        intent: "send-test",
        key: WAITLISTED,
        subject: "Waitlist",
        body: "Reply by {{respondBy}}",
        sample: JSON.stringify({ respondBy: "Friday, January 8, 2027" }),
      }).run();
      expect(sentHtml()).toContain("Friday, January 8, 2027");
    });

    it("uses the registry sample without one", async () => {
      await submit({ intent: "send-test", key: WAITLISTED, subject: "Waitlist", body: "Reply by {{respondBy}}" }).run();
      expect(sentHtml()).toContain("Monday, June 8, 2026");
    });

    it("falls back to the registry sample when the sample isn't JSON", async () => {
      await submit({
        intent: "send-test",
        key: WAITLISTED,
        subject: "Waitlist",
        body: "Reply by {{respondBy}}",
        sample: "{nope",
      }).run();
      expect(sentHtml()).toContain("Monday, June 8, 2026");
    });
  });
});
