import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
  sendFormReceipt: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import {
  loadPublicForm,
  submitAnonymousForm,
  submitMemberForm,
} from "~/forms/lib/public-form";

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
  mockPrisma.formSubmission.create.mockResolvedValue({ id: "sub-1" });
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

describe("submitting a checkbox option written with {{term}}", () => {
  const CHECKBOX = {
    key: "q1",
    type: "checkbox",
    required: true,
    data: { label: "When in {{term}}?", options: ["Early {{term}}", "Late {{term}}"] },
  };

  function checkboxForm(cycleBindings: unknown[]) {
    return {
      id: "form-1",
      name: "Intent to Work",
      published: true,
      oneResponsePerMember: false,
      versions: [{ id: "ver-1", questions: [CHECKBOX], updatedAt: new Date("2026-10-01") }],
      cycleBindings,
    };
  }

  function boundForm() {
    return checkboxForm([
      {
        slot: "level-up",
        updatedAt: new Date("2026-09-29"),
        columnMapping: null,
        staffingCycle: {
          id: "cycle-1",
          termId: "term-1",
          maxPreferencesPerMember: 3,
          term: { code: "27S" },
        },
      },
    ]);
  }

  beforeEach(() => {
    mockPrisma.page.findUnique.mockResolvedValue({ archivedAt: null, linkAccess: "Public" });
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction = vi.fn(
      async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
    ) as never;
  });

  it("accepts the term-filled option a member saw on a bound form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(boundForm());

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: '["Early 27S"]' },
    });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.formSubmission.create.mock.calls[0][0].data.answers).toEqual({
      q1: ["Early 27S"],
    });
  });

  it("accepts the term-filled option on an anonymous fill", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(boundForm());

    const result = await submitAnonymousForm({
      token: "tok",
      versionId: "ver-1",
      answers: { q1: '["Late 27S"]' },
      submitterIp: null,
    });

    expect(result).toEqual({ ok: true });
  });

  it("still rejects an option from another term", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(boundForm());

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: '["Early 27W"]' },
    });

    expect(result).toMatchObject({ status: 400 });
  });

  it("names the term in the error rather than the token", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(boundForm());

    const result = await submitMemberForm({
      token: "tok",
      versionId: "ver-1",
      userId: "user-1",
      answers: { q1: "[]" },
    });

    expect(result).toMatchObject({ error: '"When in 27S?" is required.' });
  });

  it("leaves an unbound form's literal token as the valid option", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(checkboxForm([]));

    const result = await submitAnonymousForm({
      token: "tok",
      versionId: "ver-1",
      answers: { q1: '["Early {{term}}"]' },
      submitterIp: null,
    });

    expect(result).toEqual({ ok: true });
  });
});

describe("loadPublicForm icon", () => {
  it("serves the form page's emoji to the fill view", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ ...formRow([]), page: { iconEmoji: "📋" } });
    expect((await loadPublicForm("tok"))?.iconEmoji).toBe("📋");
  });

  it("serves null when the form has no emoji", async () => {
    mockPrisma.form.findUnique.mockResolvedValue({ ...formRow([]), page: { iconEmoji: null } });
    expect((await loadPublicForm("tok"))?.iconEmoji).toBeNull();
  });
});

describe("ordinary forms are untouched by the term token", () => {
  it("returns an unbound form's questions unchanged, including an unlabelled one", async () => {
    // A standalone form has no cycle bindings, so there are no vars to
    // substitute and the questions come back as stored. The empty label is the
    // shape the builder allows ("Untitled question"), which a blanket
    // interpolate would have thrown on.
    const questions = [
      { key: "q1", type: "textarea", required: true, data: { label: "" } },
      {
        key: "q2",
        type: "text",
        required: false,
        data: { label: "Your major" },
      },
    ];
    mockPrisma.form.findUnique.mockResolvedValue({
      id: "form-2",
      name: "Feedback",
      published: true,
      versions: [
        { id: "ver-1", questions, intro: null, updatedAt: new Date() },
      ],
      cycleBindings: [],
    });

    const form = await loadPublicForm("tok");

    expect(form?.questions[0].data.label).toBe("");
    expect(form?.questions[1].data.label).toBe("Your major");
  });
});
