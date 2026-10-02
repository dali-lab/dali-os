import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  renderNotificationCopy,
  resolveNotificationCopy,
} from "~/email/lib/notification-render.server";

const mockPrisma = prisma as unknown as {
  emailTemplate: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.emailTemplate.findMany.mockResolvedValue([]);
});

describe("resolveNotificationCopy", () => {
  it("falls back to the registry wording when nothing is written", async () => {
    const copy = await resolveNotificationCopy(["meeting.invite"]);
    expect(copy.get("meeting.invite")).toEqual({
      subject: "Meeting invite: {{itemTitle}}",
      body: "{{itemDetail}}",
    });
  });

  it("prefers the operator's row", async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([
      { key: "notify:meeting.invite", subject: "You're invited: {{itemTitle}}", body: "" },
    ]);
    expect(await resolveNotificationCopy(["meeting.invite"])).toEqual(
      new Map([
        ["meeting.invite", { subject: "You're invited: {{itemTitle}}", body: "" }],
      ]),
    );
  });

  it("reads once for a fan-out, however many recipients share the template", async () => {
    await resolveNotificationCopy([
      "meeting.invite",
      "meeting.invite",
      "meeting.invite",
      "task.assigned",
    ]);
    expect(mockPrisma.emailTemplate.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.emailTemplate.findMany.mock.calls[0][0].where;
    expect(where.key.in.sort()).toEqual(["notify:meeting.invite", "notify:task.assigned"]);
  });

  it("queries nothing for an empty call", async () => {
    expect(await resolveNotificationCopy([])).toEqual(new Map());
    expect(mockPrisma.emailTemplate.findMany).not.toHaveBeenCalled();
  });

  it("keeps a template's body null when the copy is authored per send", async () => {
    // Announcements: the registry supplies no body, so the caller's passes through.
    const copy = await resolveNotificationCopy(["announcement"]);
    expect(copy.get("announcement")?.body).toBeNull();
  });

  it("honours an operator blanking an announcement's body rather than treating it as absent", async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([
      { key: "notify:announcement", subject: "{{itemTitle}}", body: "" },
    ]);
    const copy = await resolveNotificationCopy(["announcement"]);
    expect(copy.get("announcement")?.body).toBe("");
  });
});

describe("renderNotificationCopy", () => {
  it("interpolates the variables", () => {
    const out = renderNotificationCopy(
      { subject: "Meeting invite: {{itemTitle}}", body: "{{itemDetail}}" },
      { itemTitle: "Weekly Core", itemDetail: "Tuesday 2pm" },
    );
    expect(out).toEqual({ subject: "Meeting invite: Weekly Core", body: "Tuesday 2pm" });
  });

  it("collapses an empty body to null, so the row and the email both omit it", () => {
    const out = renderNotificationCopy(
      { subject: "Removed from meeting: {{itemTitle}}", body: "" },
      { itemTitle: "Weekly Core" },
    );
    expect(out.body).toBeNull();
  });

  it("collapses a body whose only content was a missing variable", () => {
    const out = renderNotificationCopy(
      { subject: "s", body: "{{itemDetail}}" },
      { itemDetail: "" },
    );
    expect(out.body).toBeNull();
  });

  it("leaves a pass-through body null for the caller to fill", () => {
    const out = renderNotificationCopy({ subject: "{{itemTitle}}", body: null }, {
      itemTitle: "Lab update",
    });
    expect(out).toEqual({ subject: "Lab update", body: null });
  });

  it("leaves an unknown token as literal text rather than blanking it", () => {
    // Matches interpolateVars: a typo survives to be noticed, and the editor's
    // lint flags it, instead of silently producing a gap in the sentence.
    const out = renderNotificationCopy(
      { subject: "Hi {{nope}}", body: "" },
      { itemTitle: "x" },
    );
    expect(out.subject).toBe("Hi {{nope}}");
  });

  it("returns nothing for a template it has no entry for", () => {
    expect(renderNotificationCopy(undefined, {})).toEqual({ subject: null, body: null });
  });
});
