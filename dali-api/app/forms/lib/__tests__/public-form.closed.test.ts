import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
  sendFormReceipt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import {
  formAccessMeta,
  listedFormsFor,
  loadPublicForm,
  submitAnonymousForm,
  submitMemberForm,
} from "~/forms/lib/public-form";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
};

const QUESTIONS = [{ key: "name", type: "text", required: true, data: { label: "Name" } }];
const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60 * 60_000);

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Showcase registration",
    published: true,
    closesAt: null,
    oneResponsePerMember: false,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings: [],
    ...over,
  };
}

const member = () =>
  submitMemberForm({ token: "tok", versionId: "ver-1", userId: "u1", answers: { name: "Ada" } });
const anonymous = () =>
  submitAnonymousForm({ token: "tok", versionId: "ver-1", answers: { name: "Ada" }, submitterIp: null });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fillAccessByPage).mockResolvedValue("ok");
  db.form.findUnique.mockResolvedValue(formRow());
  db.form.findMany.mockResolvedValue([]);
  db.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  db.formSubmission.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
});

describe("a published form past its close time", () => {
  beforeEach(() => {
    db.form.findUnique.mockResolvedValue(formRow({ closesAt: PAST }));
  });

  it("has no fill access meta, so the fill page 404s", async () => {
    expect(await formAccessMeta("tok")).toBeNull();
  });

  it("doesn't load for filling", async () => {
    expect(await loadPublicForm("tok", "u1")).toBeNull();
  });

  it("refuses a member submission", async () => {
    expect(await member()).toEqual({ error: "This form is closed.", status: 404 });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });

  it("refuses an anonymous submission", async () => {
    expect(await anonymous()).toMatchObject({ status: 404 });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});

describe("a published form with a future close time", () => {
  beforeEach(() => {
    db.form.findUnique.mockResolvedValue(formRow({ closesAt: FUTURE }));
  });

  it("is fillable", async () => {
    expect(await formAccessMeta("tok")).toEqual({ id: "form-1", name: "Showcase registration" });
  });

  it.each([
    ["member", member],
    ["anonymous", anonymous],
  ])("accepts a %s submission", async (_name, submit) => {
    expect(await submit()).toEqual({ ok: true });
    expect(db.formSubmission.create).toHaveBeenCalled();
  });
});

describe("listedFormsFor", () => {
  it("leaves out forms past their close time", async () => {
    await listedFormsFor("u1");
    const where = db.form.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }]);
  });
});
