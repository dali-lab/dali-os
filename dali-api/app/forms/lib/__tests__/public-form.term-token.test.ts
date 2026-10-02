import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { loadPublicForm } from "~/forms/lib/public-form";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// One question written as a template, the way a reusable staffing form is.
const QUESTIONS = [
  {
    key: "q1",
    type: "select",
    required: true,
    data: {
      label: "Are you planning on being on a project in {{term}}?",
      description: "We staff {{term}} from these answers.",
      options: ["Yes", "Off in {{term}}"],
    },
  },
];

function formRow(cycleBindings: unknown[]) {
  return {
    id: "form-1",
    name: "Intent to Work",
    published: true,
    versions: [
      {
        id: "ver-1",
        questions: QUESTIONS,
        intro: null,
        updatedAt: new Date("2026-10-01"),
      },
    ],
    cycleBindings,
  };
}

function binding(code: string, slot = "intent-to-work") {
  return {
    slot,
    updatedAt: new Date("2026-09-29"),
    staffingCycle: { term: { code } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadPublicForm term token", () => {
  it("resolves {{term}} to the bound cycle's term across label, description and options", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow([binding("27S")]));

    const form = await loadPublicForm("tok");

    expect(form?.questions[0].data.label).toBe(
      "Are you planning on being on a project in 27S?",
    );
    expect(form?.questions[0].data.description).toBe(
      "We staff 27S from these answers.",
    );
    expect(form?.questions[0].data.options).toEqual(["Yes", "Off in 27S"]);
  });

  it("follows the binding when the same form is re-bound to the next round", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow([binding("27W")]));
    const first = await loadPublicForm("tok");
    expect(first?.questions[0].data.label).toContain("27W");

    // Same stored version, bound to the next cycle: no edit, new term.
    mockPrisma.form.findUnique.mockResolvedValue(formRow([binding("27S")]));
    const second = await loadPublicForm("tok");
    expect(second?.questions[0].data.label).toContain("27S");
  });

  it("leaves the token literal on an unbound form rather than blanking it", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(formRow([]));

    const form = await loadPublicForm("tok");

    expect(form?.questions[0].data.label).toBe(
      "Are you planning on being on a project in {{term}}?",
    );
  });

  it("ignores a binding for an unrelated slot", async () => {
    // pickStaffingBinding only considers the three staffing slots, so a
    // non-slot binding can't name the term.
    mockPrisma.form.findUnique.mockResolvedValue(
      formRow([binding("27S", "some-other-slot")]),
    );

    const form = await loadPublicForm("tok");

    expect(form?.questions[0].data.label).toContain("{{term}}");
  });
});
