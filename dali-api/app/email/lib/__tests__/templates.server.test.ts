import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  MissingEmailTemplateError,
  getEmailTemplate,
  listEmailTemplates,
  renderEmailTemplate,
  saveEmailTemplate,
} from "~/email/lib/templates.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

// A key whose absence blocks a release, and one whose absence just skips.
const BLOCKING = "hiring:decision:Accepted" as const;
const SKIPPING = "hiring:notification:InterviewReminderApplicant" as const;

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.emailTemplate.findUnique.mockResolvedValue(null);
  mockPrisma.emailTemplate.findMany.mockResolvedValue([]);
  mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue(null);
  // $transaction(fn) runs the callback against the same mock client.
  mockPrisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma));
});

describe("getEmailTemplate", () => {
  it("returns the stored copy", async () => {
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({
      key: BLOCKING,
      subject: "s",
      body: "b",
    });
    expect(await getEmailTemplate(BLOCKING)).toEqual({ subject: "s", body: "b" });
  });

  it("returns null when nothing is written and the key does not fall back", async () => {
    expect(await getEmailTemplate(SKIPPING)).toBeNull();
  });
});

describe("saveEmailTemplate", () => {
  it("upserts the row and appends a version", async () => {
    await saveEmailTemplate(BLOCKING, { subject: "Welcome", body: "Hi" }, "u1");
    expect(mockPrisma.emailTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: BLOCKING } }),
    );
    expect(mockPrisma.emailTemplateVersion.create).toHaveBeenCalledWith({
      data: {
        templateKey: BLOCKING,
        versionNumber: 1,
        subject: "Welcome",
        body: "Hi",
        createdById: "u1",
      },
    });
  });

  it("numbers the next version after the latest", async () => {
    mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue({ versionNumber: 7 });
    await saveEmailTemplate(BLOCKING, { subject: "s", body: "b" }, "u1");
    expect(mockPrisma.emailTemplateVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 8 }) }),
    );
  });

  it("does not append a version when nothing changed", async () => {
    // Otherwise opening the editor and hitting save would pad the history.
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "s", body: "b" });
    await saveEmailTemplate(BLOCKING, { subject: "s", body: "b" }, "u1");
    expect(mockPrisma.emailTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("trims before comparing, so whitespace alone is not a new version", async () => {
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({ subject: "s", body: "b" });
    await saveEmailTemplate(BLOCKING, { subject: "  s  ", body: "  b  " }, "u1");
    expect(mockPrisma.emailTemplateVersion.create).not.toHaveBeenCalled();
  });

  it("deletes the row when both fields are blanked", async () => {
    // Carried over from the slot tables: this is how an operator turns an email
    // off, and it keeps "no row" as the one representation of off.
    await saveEmailTemplate(SKIPPING, { subject: "   ", body: "" }, "u1");
    expect(mockPrisma.emailTemplate.deleteMany).toHaveBeenCalledWith({
      where: { key: SKIPPING },
    });
    expect(mockPrisma.emailTemplate.upsert).not.toHaveBeenCalled();
  });
});

describe("listEmailTemplates", () => {
  it("drops a row whose key no longer exists in code", async () => {
    // A key retired in a deploy leaves its row behind until someone reaps it;
    // surfacing it would crash the admin page looking up its def.
    mockPrisma.emailTemplate.findMany.mockResolvedValue([
      { key: BLOCKING, subject: "s", body: "b", updatedAt: new Date(), updatedById: null },
      { key: "hiring:decision:Retired", subject: "x", body: "y", updatedAt: new Date(), updatedById: null },
    ]);
    const out = await listEmailTemplates();
    expect([...out.keys()]).toEqual([BLOCKING]);
  });
});

describe("renderEmailTemplate applies the registry's whenMissing rule", () => {
  it("renders and interpolates when copy exists", async () => {
    mockPrisma.emailTemplate.findUnique.mockResolvedValue({
      subject: "Welcome {{firstName}}",
      body: "Hi {{firstName}}, about {{domain}}.",
    });
    const out = await renderEmailTemplate(BLOCKING, {
      firstName: "Ada",
      domain: "Engineering",
    });
    expect(out?.subject).toBe("Welcome Ada");
    expect(out?.html).toContain("Hi Ada, about Engineering.");
  });

  it("returns null for a skip key with no copy", async () => {
    expect(await renderEmailTemplate(SKIPPING, { firstName: "Ada" })).toBeNull();
  });

  it("throws for an error key with no copy, so the release is refused", async () => {
    // The applicant-facing failure mode this prevents: releasing a decision that
    // silently emails nobody.
    await expect(renderEmailTemplate(BLOCKING, { firstName: "Ada" })).rejects.toThrow(
      MissingEmailTemplateError,
    );
  });

  it("names the email in the error so an operator knows what to write", async () => {
    await expect(renderEmailTemplate(BLOCKING, { firstName: "Ada" })).rejects.toThrow(
      /Decision: accepted/,
    );
  });
});
