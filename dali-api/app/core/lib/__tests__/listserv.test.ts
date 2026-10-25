import { describe, expect, it } from "vitest";
import {
  ListservDraftSchema,
  bySendBy,
  canTake,
  daysAgo,
  formatDay,
  hasContent,
  imageCount,
  labToday,
  sendByLabel,
  statusLabel,
  toPlainText,
  urgency,
  type ListservAction,
  type ListservStatus,
} from "~/core/lib/listserv";

describe("labToday", () => {
  it("reads the calendar day in Eastern time, not UTC", () => {
    // 02:30 UTC on Oct 25 is still the evening of Oct 24 in Hanover.
    expect(labToday(new Date("2026-10-25T02:30:00Z"))).toBe("2026-10-24");
    expect(labToday(new Date("2026-10-25T05:00:00Z"))).toBe("2026-10-25");
  });
});

describe("day helpers", () => {
  it("formats a calendar day without shifting it by timezone", () => {
    expect(formatDay("2026-10-20")).toBe("Tue, Oct 20");
  });

  it("counts days ago in calendar days", () => {
    expect(daysAgo("2026-10-24", "2026-10-24")).toBe("today");
    expect(daysAgo("2026-10-23", "2026-10-24")).toBe("yesterday");
    expect(daysAgo("2026-10-20", "2026-10-24")).toBe("4 days ago");
    expect(daysAgo("2026-10-25", "2026-10-24")).toBe("today");
  });

  it("calls a send-by date overdue once it has passed, soon within two days, later after", () => {
    expect(urgency("2026-10-23", "2026-10-24")).toBe("overdue");
    expect(urgency("2026-10-24", "2026-10-24")).toBe("soon");
    expect(urgency("2026-10-26", "2026-10-24")).toBe("soon");
    expect(urgency("2026-10-27", "2026-10-24")).toBe("later");
  });

  it("labels a passed send-by date as past due, and others as a deadline", () => {
    expect(sendByLabel("2026-10-23", "2026-10-24")).toBe("Past send-by date (Fri, Oct 23)");
    expect(sendByLabel("2026-10-30", "2026-10-24")).toBe("Send by Fri, Oct 30");
  });

  it("sorts the earliest deadline first and undated emails last", () => {
    const rows = [{ sendBy: null }, { sendBy: "2026-11-02" }, { sendBy: "2026-10-30" }];
    expect(rows.sort(bySendBy).map((r) => r.sendBy)).toEqual(["2026-10-30", "2026-11-02", null]);
  });
});

describe("content", () => {
  const text = (t: string) => ({ id: t || "e", type: "text" as const, text: t });
  const image = (url: string, caption = "") => ({ id: url, type: "image" as const, url, caption });

  it("needs real text or an image to count as content", () => {
    expect(hasContent([text("   ")])).toBe(false);
    expect(hasContent([text("Hi")])).toBe(true);
    expect(hasContent([text(""), image("https://x/y.png")])).toBe(true);
    expect(imageCount([text("a"), image("https://a"), image("https://b")])).toBe(2);
  });

  it("copies a plain-text email that names its images and attachments", () => {
    const out = toPlainText({
      subject: "Technigala",
      content: [text("Come by."), image("https://x/p.jpg", "The poster"), image("https://x/q.jpg"), text("  ")],
      attachments: [{ name: "program.pdf" }, { name: "map.png" }],
    });
    expect(out).toBe(
      "Subject: Technigala\n\nCome by.\n\n[Image: The poster]\n\n[Image: https://x/q.jpg]\n\nAttachments: program.pdf, map.png",
    );
  });

  it("rejects a draft without a subject or with a malformed send-by day", () => {
    const base = { subject: "S", content: [text("x")], attachments: [], sendBy: "", note: "" };
    expect(ListservDraftSchema.safeParse(base).success).toBe(true);
    expect(ListservDraftSchema.safeParse({ ...base, subject: "  " }).success).toBe(false);
    expect(ListservDraftSchema.safeParse({ ...base, sendBy: "10/30/2026" }).success).toBe(false);
    expect(ListservDraftSchema.safeParse({ ...base, content: [] }).success).toBe(false);
  });
});

describe("statusLabel", () => {
  it("speaks to the lead about their work and to submitters about theirs", () => {
    expect(statusLabel("Submitted", true)).toBe("Needs review");
    expect(statusLabel("Submitted", false)).toBe("In review");
    expect(statusLabel("Approved", true)).toBe("Ready to send");
    expect(statusLabel("Approved", false)).toBe("Approved");
    expect(statusLabel("ChangesRequested", false)).toBe("Changes requested");
    expect(statusLabel("Sent", true)).toBe("Sent");
  });
});

describe("canTake", () => {
  const lead = { isLead: true, isOwner: false };
  const owner = { isLead: false, isOwner: true };
  const bystander = { isLead: false, isOwner: false };
  const allowed = (action: ListservAction, viewer: typeof lead) =>
    (["Submitted", "ChangesRequested", "Approved", "Sent"] as ListservStatus[]).filter((s) => canTake(action, s, viewer));

  it("lets only the lead review, and only from the right status", () => {
    expect(allowed("approve", lead)).toEqual(["Submitted", "ChangesRequested"]);
    expect(allowed("unapprove", lead)).toEqual(["Approved"]);
    expect(allowed("request-changes", lead)).toEqual(["Submitted", "Approved"]);
    expect(allowed("mark-sent", lead)).toEqual(["Approved"]);
    expect(allowed("unmark-sent", lead)).toEqual(["Sent"]);
    expect(allowed("approve", owner)).toEqual([]);
    expect(allowed("mark-sent", bystander)).toEqual([]);
  });

  it("lets only the submitter edit or withdraw, and never once it's sent", () => {
    expect(allowed("edit", owner)).toEqual(["Submitted", "ChangesRequested", "Approved"]);
    expect(allowed("withdraw", owner)).toEqual(["Submitted", "ChangesRequested", "Approved"]);
    expect(allowed("edit", lead)).toEqual([]);
    expect(allowed("withdraw", bystander)).toEqual([]);
  });
});
