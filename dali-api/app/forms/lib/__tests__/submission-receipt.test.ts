import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn(),
}));
vi.mock("~/forms/lib/form-usages.server", () => ({
  formUsages: vi.fn().mockResolvedValue([]),
  managingUsage: vi.fn().mockReturnValue(null),
}));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { managingUsage } from "~/forms/lib/form-usages.server";
import {
  anonymousReceiptKey,
  receiptAddress,
  sendFormReceipt,
} from "~/forms/lib/submission-notify.server";
import type { Question } from "~/types";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const enqueue = vi.mocked(enqueueOutbound);

const text = (key: string, label: string): Question => ({
  key,
  type: "text",
  required: false,
  data: { label },
});
const email = (key: string): Question => ({
  key,
  type: "email",
  required: false,
  data: { label: "Email" },
});

const SUBMITTED = new Date("2026-11-02T20:00:00Z");

function submissionRow(over: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    answers: { q1: "Blue", q2: "ada@example.edu" },
    createdAt: SUBMITTED,
    formVersion: { versionNumber: 1, questions: [text("q1", "Favorite color"), email("q2")] },
    ...over,
  };
}

const sent = () => enqueue.mock.calls[0][0];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(managingUsage).mockReturnValue(null);
  enqueue.mockResolvedValue({ id: "out-1", deduped: false });
  db.form.findUnique.mockResolvedValue({ id: "f1", name: "Spring check-in", sendReceipt: true });
  db.formSubmission.findUnique.mockResolvedValue(submissionRow());
  db.user.findUnique.mockResolvedValue({
    firstName: "Ada",
    daliEmail: "ada@dali.example.edu",
    personalEmail: "ada@home.example.com",
  });
  db.emailTemplate.findUnique.mockResolvedValue(null);
});

describe("sendFormReceipt, signed in", () => {
  it("sends the answers and form name to the daliEmail, keyed on the submission", async () => {
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(sent()).toMatchObject({
      channel: "email",
      purpose: "General",
      target: "ada@dali.example.edu",
      recipientUserId: "u1",
      dedupKey: "form.receipt:s1",
    });
    expect(sent().subject).toBe("Your response to Spring check-in");
    expect(sent().bodyHtml).toContain("Favorite color: Blue");
    expect(sent().bodyHtml).toContain("Nov 2, 2026");
    expect(drainNow).toHaveBeenCalledWith(["out-1"]);
  });

  it("falls back to personalEmail, and sends nothing with neither", async () => {
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", daliEmail: null, personalEmail: "ada@home.example.com" });
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(sent().target).toBe("ada@home.example.com");

    enqueue.mockClear();
    db.user.findUnique.mockResolvedValue({ firstName: "Ada", daliEmail: null, personalEmail: null });
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("escapes a script injected into an answer", async () => {
    db.formSubmission.findUnique.mockResolvedValue(
      submissionRow({ answers: { q1: "<script>alert(1)</script>" } }),
    );
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(sent().bodyHtml).not.toContain("<script>");
    expect(sent().bodyHtml).toContain("&lt;script&gt;");
  });
});

describe("sendFormReceipt, not signed in", () => {
  beforeEach(() => {
    db.formSubmission.findUnique.mockResolvedValue(submissionRow({ userId: null }));
  });

  it("sends a fixed note with no answers, even when the form has text answers", async () => {
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(sent().target).toBe("ada@example.edu");
    expect(sent().recipientUserId).toBeNull();
    expect(sent().subject).toBe("We got your response to Spring check-in");
    expect(sent().bodyHtml).not.toContain("Blue");
    expect(sent().bodyHtml).not.toContain("Favorite color");
    expect(sent().bodyText).not.toContain("Blue");
  });

  it("never puts the raw address in the dedupKey", async () => {
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    const key = sent().dedupKey as string;
    expect(key).toMatch(/^form\.receipt:f1:[0-9a-f]{64}:2026-11-02$/);
    expect(key).not.toContain("ada");
    expect(key).not.toContain("example.edu");
  });

  it("uses the same key for the same address on the same day, any casing", () => {
    expect(anonymousReceiptKey("f1", "ada@example.edu", SUBMITTED)).toBe(
      anonymousReceiptKey("f1", receiptAddress([email("q")], { q: "  ADA@Example.edu " })!, SUBMITTED),
    );
  });

  it("sends nothing when the form has no Email question", async () => {
    db.formSubmission.findUnique.mockResolvedValue(
      submissionRow({ userId: null, formVersion: { versionNumber: 1, questions: [text("q1", "Color")] } }),
    );
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sends nothing when the Email answer is blank or invalid", async () => {
    for (const q2 of ["", "not-an-address"]) {
      db.formSubmission.findUnique.mockResolvedValue(submissionRow({ userId: null, answers: { q2 } }));
      await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    }
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("uses the first Email question", () => {
    expect(
      receiptAddress([email("a"), email("b")], { a: "one@example.edu", b: "two@example.edu" }),
    ).toBe("one@example.edu");
  });
});

describe("sendFormReceipt, gating and failure", () => {
  it("is off by default", async () => {
    db.form.findUnique.mockResolvedValue({ id: "f1", name: "Spring check-in", sendReceipt: false });
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("sends nothing from a managed form with a stale setting", async () => {
    vi.mocked(managingUsage).mockReturnValue({ kind: "hiring", label: "Cycle" } as never);
    await sendFormReceipt({ formId: "f1", submissionId: "s1" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("swallows a send failure and logs only the form id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    enqueue.mockRejectedValue(new Error("smtp down for ada@dali.example.edu"));
    await expect(sendFormReceipt({ formId: "f1", submissionId: "s1" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("form receipt failed for form f1");
    log.mockRestore();
  });
});
