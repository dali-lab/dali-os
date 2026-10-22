import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/email/lib/access.server", () => ({ findReadableAccount: vi.fn() }));
vi.mock("~/email/lib/gmail-mailbox.server", () => {
  class MailboxError extends Error {}
  return { MailboxError, getAttachment: vi.fn(), getMailboxToken: vi.fn(), getThread: vi.fn() };
});

import { requireAuth } from "~/lib/auth";
import { findReadableAccount } from "~/email/lib/access.server";
import { getAttachment, getMailboxToken, getThread } from "~/email/lib/gmail-mailbox.server";
import { logAuditEvent } from "~/lib/audit";
import { loader } from "~/routes/api.email.attachment";

function get(query = "account=acc-1&thread=th-1&message=msg-1&index=0") {
  return loader({
    request: new Request(`http://localhost/api/email/attachment?${query}`),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(findReadableAccount).mockResolvedValue({ id: "acc-1" } as never);
  vi.mocked(getMailboxToken).mockResolvedValue("tok" as never);
  vi.mocked(getThread).mockResolvedValue([
    { id: "msg-1", attachments: [{ attachmentId: "att-1", filename: "offer.pdf", mimeType: "application/pdf" }] },
  ] as never);
  vi.mocked(getAttachment).mockResolvedValue(Buffer.from("PDFBYTES"));
});

describe("GET /api/email/attachment audit", () => {
  it("logs the download with the message, file name and size but not the bytes", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const event = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(event).toMatchObject({
      action: "email.attachment.download",
      userId: "u1",
      targetId: "msg-1",
      metadata: { accountId: "acc-1", threadId: "th-1", index: 0, filename: "offer.pdf", sizeBytes: 8 },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("PDFBYTES");
  });

  it("logs nothing for a bad request, an unreadable inbox, a missing attachment or empty bytes", async () => {
    await get("account=acc-1");
    vi.mocked(findReadableAccount).mockResolvedValueOnce(null as never);
    await get();
    await get("account=acc-1&thread=th-1&message=msg-1&index=4");
    vi.mocked(getAttachment).mockResolvedValue(Buffer.alloc(0));
    expect((await get()).status).toBe(502);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
