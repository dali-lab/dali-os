import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));
vi.mock("~/forms/lib/form-usages.server", () => ({
  formUsages: vi.fn().mockResolvedValue([]),
  managingUsage: vi.fn().mockReturnValue(null),
}));
vi.mock("~/forms/lib/reference-sources", () => ({ resolveReferenceOptions: vi.fn() }));
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import { managingUsage } from "~/forms/lib/form-usages.server";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
import { ordinaryFillBlock } from "~/forms/lib/public-form";
import {
  answersToFillState,
  deleteFormResponse,
  editOwnResponse,
  loadResponseForEditing,
} from "~/forms/lib/form-response.server";
import { NEW_MEMBER_PROFILE_FORM_NAME } from "~/members/lib/profile-form-interpreter";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const audit = logAuditEvent as ReturnType<typeof vi.fn>;
const access = fillAccessByPage as ReturnType<typeof vi.fn>;
const managing = managingUsage as ReturnType<typeof vi.fn>;
const resolveRef = resolveReferenceOptions as ReturnType<typeof vi.fn>;

const FREE = {
  slot: null,
  staffingCycleId: null,
  educationOfferingId: null,
  educationSessionId: null,
  partnerApplication: null,
  educationApplication: null,
  partnerSurveyFor: null,
};

const V1_QUESTIONS = [
  { key: "name", type: "text", required: true, data: { label: "Name" } },
  { key: "tags", type: "checkbox", required: false, data: { label: "Tags", options: ["a", "b"] } },
  { key: "proj", type: "reference", required: false, data: { label: "Project", referenceSource: "projects:active" } },
  { key: "cv", type: "file", required: true, data: { label: "CV" } },
];

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    name: "Feedback",
    published: true,
    oneResponsePerMember: true,
    allowResponseEdit: true,
    page: { iconEmoji: null },
    versions: [{ id: "v1" }],
    cycleBindings: [],
    ...over,
  };
}

function submissionRow(over: Record<string, unknown> = {}) {
  return {
    id: "s1",
    answers: { name: "Ada", tags: ["a"], proj: "p1", cv: { key: "files/cv.pdf" } },
    formVersion: {
      id: "v1",
      questions: V1_QUESTIONS,
      intro: null,
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    },
    ...FREE,
    ...over,
  };
}

const edit = (answers: Record<string, unknown>, userId: string | null = "u1") =>
  editOwnResponse({ token: "tok", userId, answers });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue("ok");
  managing.mockReturnValue(null);
  resolveRef.mockResolvedValue([{ value: "p1", label: "P1" }, { value: "p2", label: "P2" }]);
  db.form.findUnique.mockResolvedValue(formRow());
  db.formSubmission.findFirst.mockResolvedValue(submissionRow());
});

describe("deleteFormResponse", () => {
  const run = () =>
    deleteFormResponse({ formId: "f1", submissionId: "s1", actorId: "owner" });
  const found = (over: Record<string, unknown> = {}) =>
    db.formSubmission.findFirst.mockResolvedValue({
      id: "s1",
      userId: "u1",
      formVersionId: "v1",
      form: { name: "Feedback" },
      ...FREE,
      ...over,
    });

  it("hard-deletes an ordinary response and audits it without answers", async () => {
    found();
    expect(await run()).toEqual({ ok: true });
    expect(db.formSubmission.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(audit).toHaveBeenCalledWith({
      action: "form.response.delete",
      userId: "owner",
      targetId: "f1",
      metadata: { submissionId: "s1", respondentId: "u1", formVersionId: "v1" },
      request: undefined,
    });
  });

  it("only finds a response on the form being managed", async () => {
    found();
    await run();
    expect(db.formSubmission.findFirst.mock.calls[0][0].where).toEqual({ id: "s1", formId: "f1" });
  });

  it("404s for an unknown response", async () => {
    db.formSubmission.findFirst.mockResolvedValue(null);
    expect(await run()).toMatchObject({ status: 404 });
    expect(db.formSubmission.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["slot", { slot: "project-bids" }],
    ["staffingCycleId", { staffingCycleId: "c1" }],
    ["educationOfferingId", { educationOfferingId: "o1" }],
    ["educationSessionId", { educationSessionId: "s9" }],
    ["partnerApplication", { partnerApplication: { id: "a" } }],
    ["educationApplication", { educationApplication: { id: "a" } }],
    ["partnerSurveyFor", { partnerSurveyFor: { id: "a" } }],
    ["the onboarding profile form", { form: { name: NEW_MEMBER_PROFILE_FORM_NAME } }],
  ])("refuses when the response has %s", async (_n, over) => {
    found(over);
    expect(await run()).toMatchObject({ status: 409 });
    expect(db.formSubmission.delete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("after a delete", () => {
  it("lets the member fill again even with one response per member on", async () => {
    db.formSubmission.findFirst.mockResolvedValueOnce({
      id: "s1", userId: "u1", formVersionId: "v1", form: { name: "Feedback" }, ...FREE,
    });
    await deleteFormResponse({ formId: "f1", submissionId: "s1", actorId: "owner" });

    db.form.findUnique.mockResolvedValue(formRow());
    db.formSubmission.findFirst.mockResolvedValue(null);
    expect(await ordinaryFillBlock("f1", "u1")).toBeNull();
  });
});

describe("editOwnResponse gates", () => {
  it("needs a session", async () => {
    expect(await edit({ name: "x" }, null)).toMatchObject({ status: 401 });
    expect(db.formSubmission.update).not.toHaveBeenCalled();
  });

  it("404s for an unknown or unpublished form", async () => {
    db.form.findUnique.mockResolvedValue(null);
    expect(await edit({})).toMatchObject({ status: 404 });
    db.form.findUnique.mockResolvedValue(formRow({ published: false }));
    expect(await edit({})).toMatchObject({ status: 404 });
  });

  it("requires fill access", async () => {
    access.mockResolvedValue("denied");
    expect(await edit({})).toMatchObject({ status: 403 });
  });

  it("refuses when the form doesn't allow edits", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ allowResponseEdit: false }));
    expect(await edit({})).toMatchObject({ status: 403 });
  });

  it("refuses once one response per member is turned off", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ oneResponsePerMember: false }));
    expect(await edit({})).toMatchObject({ status: 403 });
  });

  it("refuses a managed form", async () => {
    managing.mockReturnValue({ kind: "staffing", label: "x" });
    expect(await edit({})).toMatchObject({ status: 403 });
  });

  it("looks only at the caller's own response", async () => {
    await edit({ name: "Ada" });
    expect(db.formSubmission.findFirst.mock.calls[0][0].where).toEqual({ formId: "f1", userId: "u1" });
  });

  it("404s when the member hasn't responded", async () => {
    db.formSubmission.findFirst.mockResolvedValue(null);
    expect(await edit({})).toMatchObject({ status: 404 });
  });

  it.each([
    ["slot", { slot: "project-bids" }],
    ["staffingCycleId", { staffingCycleId: "c1" }],
    ["educationOfferingId", { educationOfferingId: "o1" }],
    ["educationSessionId", { educationSessionId: "s9" }],
    ["partnerApplication", { partnerApplication: { id: "a" } }],
    ["educationApplication", { educationApplication: { id: "a" } }],
    ["partnerSurveyFor", { partnerSurveyFor: { id: "a" } }],
  ])("refuses a response with %s", async (_n, over) => {
    db.formSubmission.findFirst.mockResolvedValue(submissionRow(over));
    expect(await edit({ name: "x" })).toMatchObject({ status: 409 });
    expect(db.formSubmission.update).not.toHaveBeenCalled();
  });

  it("refuses the onboarding profile form", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ name: NEW_MEMBER_PROFILE_FORM_NAME }));
    expect(await edit({ name: "x" })).toMatchObject({ status: 409 });
  });
});

describe("editOwnResponse", () => {
  it("merges posted answers over stored ones so file answers survive", async () => {
    expect(await edit({ name: "Ada L", tags: JSON.stringify(["b"]), proj: "p2" })).toEqual({ ok: true });
    expect(db.formSubmission.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { answers: { name: "Ada L", tags: ["b"], proj: "p2", cv: { key: "files/cv.pdf" } } },
    });
  });

  it("ignores posted keys that aren't editable questions, files included", async () => {
    await edit({ name: "Ada", cv: "evil", extra: "x" });
    const saved = db.formSubmission.update.mock.calls[0][0].data.answers;
    expect(saved.cv).toEqual({ key: "files/cv.pdf" });
    expect(saved).not.toHaveProperty("extra");
  });

  it("validates against the stored version, not the latest", async () => {
    await edit({ name: "Ada" });
    expect(db.formSubmission.findFirst.mock.calls[0][0].select.formVersion).toBeTruthy();
    expect(db.form.findUnique.mock.calls[0][0].select).not.toHaveProperty("versions");
    expect(db.formVersion.findFirst).not.toHaveBeenCalled();
    expect(await edit({ name: "" })).toMatchObject({ status: 400 });
  });

  it("rejects a checkbox option the stored version doesn't offer", async () => {
    expect(await edit({ tags: JSON.stringify(["zzz"]) })).toMatchObject({ status: 400 });
    expect(db.formSubmission.update).not.toHaveBeenCalled();
  });

  it("skips the live check for an unchanged reference answer", async () => {
    resolveRef.mockResolvedValue([]);
    expect(await edit({ name: "Ada", proj: "p1" })).toEqual({ ok: true });
    expect(resolveRef).not.toHaveBeenCalled();
  });

  it("still checks a changed reference answer", async () => {
    resolveRef.mockResolvedValue([{ value: "p2", label: "P2" }]);
    expect(await edit({ proj: "p3" })).toMatchObject({ status: 400 });
    expect(await edit({ proj: "p2" })).toEqual({ ok: true });
  });

  it("has no side effects beyond the update and its audit row", async () => {
    await edit({ name: "Ada" });
    expect(notifyFormSubmission).not.toHaveBeenCalled();
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.notification.updateMany).not.toHaveBeenCalled();
    expect(db.formSubmission.delete).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      action: "form.response.edit",
      userId: "u1",
      targetId: "f1",
      metadata: { submissionId: "s1", formVersionId: "v1" },
      request: undefined,
    });
  });
});

describe("loadResponseForEditing", () => {
  it("serves the version the response was recorded against, with answers as fill state", async () => {
    const out = await loadResponseForEditing({ token: "tok", userId: "u1" });
    if ("error" in out) throw new Error(out.error);
    expect(out.form.versionId).toBe("v1");
    expect(out.form.questions.map((q) => q.key)).toEqual(["name", "tags", "proj", "cv"]);
    expect(out.answers).toEqual({ name: "Ada", tags: '["a"]', proj: "p1" });
  });

  it("resolves reference options for the stored version", async () => {
    const out = await loadResponseForEditing({ token: "tok", userId: "u1" });
    if ("error" in out) throw new Error(out.error);
    expect(resolveRef).toHaveBeenCalledWith("projects:active", { userId: "u1", termId: undefined });
    expect(out.form.questions[2].data.referenceOptions).toHaveLength(2);
  });

  it("returns the same refusal the endpoint would", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ allowResponseEdit: false }));
    expect(await loadResponseForEditing({ token: "tok", userId: "u1" })).toMatchObject({ status: 403 });
  });
});

describe("answersToFillState", () => {
  it("stringifies arrays and numbers and drops files and unknown shapes", () => {
    expect(
      answersToFillState(V1_QUESTIONS as never, { name: "A", tags: ["a", "b"], proj: 3, cv: {} }),
    ).toEqual({ name: "A", tags: '["a","b"]', proj: "3" });
  });
});

describe("editOwnResponse with rules", () => {
  const RULE_QUESTIONS = [
    { key: "returning", type: "select", required: true, data: { label: "Returning?", options: ["Yes", "No"] } },
    {
      key: "why",
      type: "textarea",
      required: true,
      data: { label: "Why?", showIf: { questionKey: "returning", op: "is", value: "No" } },
    },
    {
      key: "cv",
      type: "file",
      required: true,
      data: { label: "CV", showIf: { questionKey: "returning", op: "is", value: "No" } },
    },
  ];
  const stored = (answers: Record<string, unknown>) =>
    db.formSubmission.findFirst.mockResolvedValue(
      submissionRow({
        answers,
        formVersion: { id: "v1", questions: RULE_QUESTIONS, intro: null, updatedAt: new Date() },
      }),
    );
  const saved = () => db.formSubmission.update.mock.calls[0][0].data.answers;

  it("removes stored answers an edit has hidden, files included", async () => {
    stored({ returning: "No", why: "moving", cv: { key: "files/cv.pdf" } });
    expect(await edit({ returning: "Yes" })).toEqual({ ok: true });
    expect(saved()).toEqual({ returning: "Yes" });
  });

  it("does not require a question the edit has hidden", async () => {
    stored({ returning: "No", why: "moving", cv: { key: "files/cv.pdf" } });
    expect(await edit({ returning: "Yes", why: "" })).toEqual({ ok: true });
  });

  it("keeps the stored upload satisfying a shown required file", async () => {
    stored({ returning: "No", why: "moving", cv: { key: "files/cv.pdf" } });
    expect(await edit({ returning: "No", why: "still moving" })).toEqual({ ok: true });
    expect(saved()).toEqual({ returning: "No", why: "still moving", cv: { key: "files/cv.pdf" } });
  });

  it("still requires a question the edit has shown", async () => {
    stored({ returning: "Yes" });
    expect(await edit({ returning: "No" })).toMatchObject({ status: 400 });
    expect(db.formSubmission.update).not.toHaveBeenCalled();
  });
});
