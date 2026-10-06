import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { mailMessageIndex: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/partners/lib/partner-email.server", () => ({ canViewPartnerThread: vi.fn() }));
vi.mock("~/email/lib/mail-index.server", () => ({ getSharedInboxToken: vi.fn() }));

const { MockMailboxError } = vi.hoisted(() => {
  class MockMailboxError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MailboxError";
    }
  }
  return { MockMailboxError };
});
vi.mock("~/email/lib/gmail-mailbox.server", () => ({
  getThread: vi.fn(),
  MailboxError: MockMailboxError,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canViewPartnerThread } from "~/partners/lib/partner-email.server";
import { getSharedInboxToken } from "~/email/lib/mail-index.server";
import { getThread } from "~/email/lib/gmail-mailbox.server";
import { loader } from "~/partners/routes/api.partner-contacts.$id.email-thread.$indexId";

const db = prisma as unknown as { mailMessageIndex: Record<string, ReturnType<typeof vi.fn>> };
const CONTACT_ID = "pc1";
const INDEX_ID = "idx1";

function call() {
  const request = new Request(`http://localhost/api/partner-contacts/${CONTACT_ID}/email-thread/${INDEX_ID}`);
  return loader({ request, params: { id: CONTACT_ID, indexId: INDEX_ID }, context: {} } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as any);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(canViewPartnerThread).mockResolvedValue(true);
  db.mailMessageIndex.findUnique.mockResolvedValue({ threadId: "t1", linkedPartnerContactId: CONTACT_ID });
  vi.mocked(getSharedInboxToken).mockResolvedValue({
    token: "tok",
    accountId: "acc1",
    address: "partners@dali.dartmouth.edu",
    source: "test",
  });
  vi.mocked(getThread).mockResolvedValue([
    {
      id: "m1",
      from: "partner@acme.com",
      to: "partners@dali.dartmouth.edu",
      cc: "",
      date: "2026-01-01T00:00:00Z",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      attachments: [],
    },
  ] as any);
});

describe("GET /api/partner-contacts/:id/email-thread/:indexId", () => {
  it("404s when not authenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as any);
    const res = await call();
    expect(res.status).toBe(401);
  });

  it("404s when the partner-email flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(canViewPartnerThread).not.toHaveBeenCalled();
  });

  it("404s when canViewPartnerThread refuses (not Core, or not a partners@ row)", async () => {
    vi.mocked(canViewPartnerThread).mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(getSharedInboxToken).not.toHaveBeenCalled();
  });

  it("404s when the index row isn't linked to the contact in the path", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue({ threadId: "t1", linkedPartnerContactId: "someone-else" });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("404s when the index row doesn't exist", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("returns the thread's messages when every gate passes", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ id: "m1", subject: "Hello" });
    expect(getThread).toHaveBeenCalledWith("tok", "t1");
  });

  it("503s with a friendly message when the inbox isn't connected", async () => {
    vi.mocked(getSharedInboxToken).mockRejectedValue(new MockMailboxError("nope"));
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("partners@");
  });
});
