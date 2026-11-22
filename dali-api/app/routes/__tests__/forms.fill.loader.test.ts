import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
}));
vi.mock("~/lib/roles", () => ({ requireMember: vi.fn() }));
vi.mock("~/forms/lib/public-form", () => ({
  formAccessMeta: vi.fn(),
  formFillAccess: vi.fn(),
  loadPublicForm: vi.fn(),
  ordinaryFillBlock: vi.fn(),
}));
vi.mock("~/forms/lib/form-usages.server", () => ({ applicantFillRedirect: vi.fn() }));
vi.mock("~/forms/lib/form-response.server", () => ({
  loadEditableResponse: vi.fn(),
  loadResponseForEditing: vi.fn(),
}));
vi.mock("~/education/lib/feedback.server", () => ({ canFillEducationForm: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ canBuildForm: vi.fn() }));
vi.mock("~/forms/components/MemberFormFillView", () => ({
  MemberFormFillView: () => null,
  MemberFormShell: () => null,
}));
vi.mock("~/components/ui/Button", () => ({ buttonClasses: () => "" }));
vi.mock("~/lib/os-shell", () => ({ useOsShellRoot: () => {} }));

import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import {
  formAccessMeta,
  formFillAccess,
  loadPublicForm,
  ordinaryFillBlock,
} from "~/forms/lib/public-form";
import { applicantFillRedirect } from "~/forms/lib/form-usages.server";
import { canFillEducationForm } from "~/education/lib/feedback.server";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { loadEditableResponse, loadResponseForEditing } from "~/forms/lib/form-response.server";
import { loader } from "~/routes/forms.fill.$token";

const FORM = { formId: "f1", name: "Feedback", questions: [], versionId: "v1" };

function run(url: string) {
  return loader({
    request: new Request(url),
    params: { token: "tok" },
  } as never) as Promise<any>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(formAccessMeta).mockResolvedValue({ id: "f1", name: "Feedback" });
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(requireMember).mockResolvedValue({ id: "u1" } as never);
  vi.mocked(loadPublicForm).mockResolvedValue(FORM as never);
  vi.mocked(ordinaryFillBlock).mockResolvedValue(null);
  vi.mocked(applicantFillRedirect).mockResolvedValue(null as never);
  vi.mocked(formFillAccess).mockResolvedValue("ok");
});

describe("forms.fill loader edit-form link", () => {
  it("links someone who can edit the form to its editor", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    const data = await run("http://os.test/forms/fill/tok");
    expect(canBuildForm).toHaveBeenCalledWith("u1", "f1", expect.any(Request));
    expect(data.editFormHref).toBe("/forms/edit/f1");
  });

  it("gives a respondent without edit access no link", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    expect((await run("http://os.test/forms/fill/tok")).editFormHref).toBeNull();
  });

  it("gives an anonymous filler of a public form no link, without checking access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await run("http://os.test/forms/fill/tok")).editFormHref).toBeNull();
    expect(canBuildForm).not.toHaveBeenCalled();
  });

  it("does not check or reveal edit access when the form is denied", async () => {
    vi.mocked(formFillAccess).mockResolvedValue("denied");
    const data = await run("http://os.test/forms/fill/tok");
    expect(data).toEqual({ accessDenied: true, name: "Feedback" });
    expect(canBuildForm).not.toHaveBeenCalled();
  });

  it("keeps the link on the already-submitted screen", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(ordinaryFillBlock).mockResolvedValue({ at: new Date("2026-11-20T15:00:00Z") } as never);
    vi.mocked(loadEditableResponse).mockResolvedValue({ error: "closed" } as never);
    const data = await run("http://os.test/forms/fill/tok");
    expect(data.alreadySubmitted).toEqual({ at: "2026-11-20T15:00:00.000Z" });
    expect(data.editFormHref).toBe("/forms/edit/f1");
  });

  it("keeps the link while editing your own response", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(true);
    vi.mocked(loadResponseForEditing).mockResolvedValue({ form: FORM, answers: { q1: "a" } } as never);
    const data = await run("http://os.test/forms/fill/tok?edit=1");
    expect(data.editingAnswers).toEqual({ q1: "a" });
    expect(data.editFormHref).toBe("/forms/edit/f1");
  });
});

describe("forms.fill loader education context", () => {
  it("keeps a valid education context and skips the audience gate", async () => {
    vi.mocked(canFillEducationForm).mockResolvedValue(true);

    const data = await run("http://os.test/forms/fill/tok?session=sess-1");

    expect(canFillEducationForm).toHaveBeenCalledWith({
      token: "tok",
      userId: "u1",
      sessionId: "sess-1",
      offeringId: null,
    });
    expect(formFillAccess).not.toHaveBeenCalled();
    expect(data.educationSessionId).toBe("sess-1");
  });

  it("sends a member with a bogus context through the ordinary gate", async () => {
    // The regression: a member could read any published form's questions by
    // appending ?session=x, because the context was only validated for
    // non-members.
    vi.mocked(canFillEducationForm).mockResolvedValue(false);
    vi.mocked(formFillAccess).mockResolvedValue("denied");

    const data = await run("http://os.test/forms/fill/tok?session=bogus");

    expect(formFillAccess).toHaveBeenCalled();
    expect(data).toEqual({ accessDenied: true, name: "Feedback" });
  });

  it("drops the dead context when the member passes the ordinary gate", async () => {
    vi.mocked(canFillEducationForm).mockResolvedValue(false);
    vi.mocked(formFillAccess).mockResolvedValue("ok");

    const data = await run("http://os.test/forms/fill/tok?offering=stale");

    expect(data.educationSessionId).toBeNull();
    expect(data.educationOfferingId).toBeNull();
    expect(data.accessDenied).toBe(false);
  });

  it("still turns away a non-member with a bogus context", async () => {
    vi.mocked(canFillEducationForm).mockResolvedValue(false);
    vi.mocked(requireMember).mockResolvedValue(null as never);

    const res = await run("http://os.test/forms/fill/tok?session=bogus");

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("Location")).toBe("/");
  });
});
