import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    form: { findUnique: vi.fn() },
    formVersion: { findFirst: vi.fn() },
    formSubmission: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ canBuildForm: vi.fn() }));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildResponseGrid: vi.fn(async () => ({ columns: [], rowsBySubmission: [] })),
  responsesCsvRows: vi.fn(() => [["Name"]]),
}));
vi.mock("~/forms/lib/version-responses.server", () => ({ versionResponsesWhere: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canBuildForm } from "~/forms/lib/form-access.server";
import { versionResponsesWhere } from "~/forms/lib/version-responses.server";
import { loader } from "~/forms/routes/forms.responses.$formId.export.csv";

const db = prisma as unknown as {
  form: { findUnique: ReturnType<typeof vi.fn> };
  formVersion: { findFirst: ReturnType<typeof vi.fn> };
  formSubmission: { findMany: ReturnType<typeof vi.fn> };
};

const questions = [
  { key: "a", type: "select", required: false, data: { label: "A", options: ["Yes"] } },
  { key: "f", type: "file", required: false, data: { label: "F" } },
];

const call = (query: string) =>
  loader({
    request: new Request(`http://os.test/forms/responses/f1/export.csv?${query}`),
    params: { formId: "f1" },
  } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canBuildForm).mockResolvedValue(true);
  db.form.findUnique.mockResolvedValue({ id: "f1", name: "Intake" });
  db.formVersion.findFirst.mockResolvedValue({ id: "v2", questions });
  db.formSubmission.findMany.mockResolvedValue([]);
  vi.mocked(versionResponsesWhere).mockResolvedValue({ formId: "f1", formVersionId: "v2", id: { in: ["s1"] } });
});

describe("export.csv filters", () => {
  it("exports what the results filters match for the requested version", async () => {
    await call("version=2&q=ada&slot=Tue&a=a:is:Yes&a=f:blank&a=gone:blank");
    expect(db.formVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { formId: "f1", versionNumber: 2 } }),
    );
    expect(versionResponsesWhere).toHaveBeenCalledWith("f1", "v2", {
      q: "ada",
      slot: "Tue",
      answers: [{ key: "a", kind: "is", values: ["Yes"] }],
      questions,
    });
    expect(db.formSubmission.findMany.mock.calls[0][0].where).toEqual({
      formId: "f1",
      formVersionId: "v2",
      id: { in: ["s1"] },
    });
  });

  it("still exports the whole version when no filters are given", async () => {
    await call("version=2");
    expect(versionResponsesWhere).toHaveBeenCalledWith("f1", "v2", {
      q: "",
      slot: "",
      answers: [],
      questions,
    });
  });

  it("exports every version, ignoring filters, when none is named", async () => {
    await call("q=ada&a=a:is:Yes");
    expect(versionResponsesWhere).not.toHaveBeenCalled();
    expect(db.formSubmission.findMany.mock.calls[0][0].where).toEqual({ formId: "f1" });
  });

  it("keeps an unknown version empty rather than widening to every version", async () => {
    db.formVersion.findFirst.mockResolvedValue(null);
    await call("version=9");
    expect(db.formSubmission.findMany.mock.calls[0][0].where).toEqual({
      formId: "f1",
      formVersion: { versionNumber: 9 },
    });
  });

  it("sends a caller who can't build the form away before reading anything", async () => {
    vi.mocked(canBuildForm).mockResolvedValue(false);
    const res = (await call("version=2")) as Response;
    expect(res.status).toBe(302);
    expect(db.formSubmission.findMany).not.toHaveBeenCalled();
  });
});
