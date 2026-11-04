import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/submission-notify.server", () => ({
  notifyFormSubmission: vi.fn().mockResolvedValue(undefined),
  sendFormReceipt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/forms/lib/form-access.server", () => ({ fillAccessByPage: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { fillAccessByPage } from "~/forms/lib/form-access.server";
import { submitAnonymousForm, submitMemberForm } from "~/forms/lib/public-form";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const QUESTIONS = [
  { key: "returning", type: "select", required: true, data: { label: "Returning?", options: ["Yes", "No"] } },
  {
    key: "why",
    type: "textarea",
    required: true,
    data: { label: "Why?", showIf: { questionKey: "returning", op: "is", value: "No" } },
  },
];

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "form-1",
    name: "Winter check-in",
    published: true,
    oneResponsePerMember: false,
    versions: [{ id: "ver-1", questions: QUESTIONS }],
    cycleBindings: [],
    ...over,
  };
}

const member = (answers: Record<string, unknown>) =>
  submitMemberForm({ token: "tok", versionId: "ver-1", userId: "u1", answers });
const anonymous = (answers: Record<string, unknown>) =>
  submitAnonymousForm({ token: "tok", versionId: "ver-1", answers, submitterIp: null });

const stored = () => db.formSubmission.create.mock.calls[0][0].data.answers;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fillAccessByPage).mockResolvedValue("ok");
  db.form.findUnique.mockResolvedValue(formRow());
  db.formSubmission.create.mockResolvedValue({ id: "sub-1" });
  db.formSubmission.findFirst.mockResolvedValue(null);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
});

describe.each([
  ["submitMemberForm", member],
  ["submitAnonymousForm", anonymous],
])("%s with rules", (_name, submit) => {
  it("accepts a submission that skips a hidden required question and stores no hidden answer", async () => {
    expect(await submit({ returning: "Yes", why: "stale" })).toEqual({ ok: true });
    expect(stored()).toEqual({ returning: "Yes" });
  });

  it("requires the question when its rule shows it", async () => {
    expect(await submit({ returning: "No" })).toMatchObject({ status: 400 });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });

  it("stores the answer when its rule shows it", async () => {
    expect(await submit({ returning: "No", why: "moving" })).toEqual({ ok: true });
    expect(stored()).toEqual({ returning: "No", why: "moving" });
  });
});

describe("submitMemberForm on a bound staffing form", () => {
  it("stores no hidden answer when the form feeds a slot", async () => {
    db.form.findUnique.mockResolvedValue(
      formRow({
        cycleBindings: [
          {
            slot: "referrals",
            columnMapping: null,
            updatedAt: new Date(),
            staffingCycle: { id: "c1", termId: "t1", maxPreferencesPerMember: 3, term: { code: "27W" } },
          },
        ],
      }),
    );
    expect(await member({ returning: "Yes", why: "stale" })).toEqual({ ok: true });
    expect(stored()).toEqual({ returning: "Yes" });
  });
});
