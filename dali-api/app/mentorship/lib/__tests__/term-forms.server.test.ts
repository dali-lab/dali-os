import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    mentorshipTermForm: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    formSubmission: { findMany: vi.fn() },
  },
}));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildResponseGrid: vi.fn(async (subs: { answers: Record<string, unknown> }[]) => ({
    columns: [],
    rowsBySubmission: subs.map((s) => [{ key: "q", label: "Q", value: String(s.answers.q) }]),
  })),
}));

import { prisma } from "~/lib/db";
import { loadTermForms, setTermForm } from "../term-forms.server";

const m = prisma as any;
const TERM = { id: "term1", startDate: new Date("2026-09-14T00:00:00Z") };
const sub = (userId: string, q: string, createdAt: string) => ({
  userId,
  createdAt: new Date(createdAt),
  answers: { q },
  formVersion: { versionNumber: 1, questions: [] },
});

beforeEach(() => vi.clearAllMocks());

describe("loadTermForms", () => {
  it("returns no forms when none are linked", async () => {
    m.mentorshipTermForm.findMany.mockResolvedValue([]);
    expect(await loadTermForms(TERM, ["u1"])).toEqual({});
    expect(m.formSubmission.findMany).not.toHaveBeenCalled();
  });

  it("maps each person's latest response this term to their domain and side", async () => {
    m.mentorshipTermForm.findMany.mockResolvedValue([
      { domainId: "dev", role: "mentee", form: { id: "f-mentee", name: "Mentee check-in" } },
      { domainId: "dev", role: "mentor", form: { id: "f-mentor", name: "Mentor check-in" } },
    ]);
    m.formSubmission.findMany.mockImplementation(async ({ where }: any) =>
      where.formId === "f-mentee"
        ? [sub("mentee1", "newer", "2026-10-14"), sub("mentee1", "older", "2026-10-13")]
        : [sub("mentor1", "fine", "2026-10-14")],
    );

    const result = await loadTermForms(TERM, ["mentee1", "mentor1"]);

    expect(result.dev.mentee.form?.name).toBe("Mentee check-in");
    expect(result.dev.mentee.responses.mentee1.rows[0].value).toBe("newer");
    expect(result.dev.mentor.responses.mentor1.rows[0].value).toBe("fine");
    expect(result.dev.mentee.responses.mentor1).toBeUndefined();
  });

  it("keeps each domain's forms apart", async () => {
    m.mentorshipTermForm.findMany.mockResolvedValue([
      { domainId: "dev", role: "mentee", form: { id: "f-dev", name: "Dev mentee" } },
      { domainId: "design", role: "mentee", form: { id: "f-design", name: "Design mentee" } },
    ]);
    m.formSubmission.findMany.mockImplementation(async ({ where }: any) =>
      where.formId === "f-dev" ? [sub("u1", "dev answer", "2026-10-14")] : [],
    );

    const result = await loadTermForms(TERM, ["u1"]);

    expect(result.dev.mentee.form?.name).toBe("Dev mentee");
    expect(result.design.mentee.form?.name).toBe("Design mentee");
    expect(result.dev.mentee.responses.u1.rows[0].value).toBe("dev answer");
    expect(result.design.mentee.responses).toEqual({});
    expect(result.dev.mentor.form).toBeNull();
  });

  it("only reads responses from people on the page, submitted since the term began", async () => {
    m.mentorshipTermForm.findMany.mockResolvedValue([
      { domainId: "dev", role: "mentee", form: { id: "f1", name: "F" } },
    ]);
    m.formSubmission.findMany.mockResolvedValue([]);

    await loadTermForms(TERM, ["u1", "u2"]);

    expect(m.formSubmission.findMany.mock.calls[0][0].where).toEqual({
      formId: "f1",
      userId: { in: ["u1", "u2"] },
      createdAt: { gte: TERM.startDate },
    });
  });

  it("ignores rows with an unknown role", async () => {
    m.mentorshipTermForm.findMany.mockResolvedValue([
      { domainId: "dev", role: "lead", form: { id: "f1", name: "F" } },
    ]);
    expect(await loadTermForms(TERM, ["u1"])).toEqual({});
  });
});

describe("setTermForm", () => {
  it("links a form by upserting the term's slot for that domain and side", async () => {
    await setTermForm("term1", "dev", "mentor", "f1");
    expect(m.mentorshipTermForm.upsert).toHaveBeenCalledWith({
      where: { termId_domainId_role: { termId: "term1", domainId: "dev", role: "mentor" } },
      create: { termId: "term1", domainId: "dev", role: "mentor", formId: "f1" },
      update: { formId: "f1" },
    });
  });

  it("unlinks when no form is given", async () => {
    await setTermForm("term1", "dev", "mentee", null);
    expect(m.mentorshipTermForm.deleteMany).toHaveBeenCalledWith({
      where: { termId: "term1", domainId: "dev", role: "mentee" },
    });
    expect(m.mentorshipTermForm.upsert).not.toHaveBeenCalled();
  });
});
