import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    partnerApplicationFormBinding: { findFirst: vi.fn() },
    formSubmission: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildResponseGrid: vi.fn(async (subs: unknown[]) => ({
    columns: [{ key: "q1", label: "Role" }],
    rowsBySubmission: subs.map(() => [{ key: "q1", label: "Role", value: "x" }]),
  })),
}));

import { prisma } from "~/lib/db";
import {
  RESPONSES_PAGE_SIZE,
  loadVersionResponses,
  responsesWhere,
} from "~/forms/lib/version-responses.server";

const db = prisma as unknown as {
  partnerApplicationFormBinding: { findFirst: ReturnType<typeof vi.fn> };
  formSubmission: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function submission(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `s${i}`,
    createdAt: new Date(Date.UTC(2026, 4, 20, 10, 0, 60 - i)),
    answers: {},
    submitterName: null,
    submitterEmail: null,
    submitterIp: null,
    slot: null,
    user: { firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu", personalEmail: null },
    formVersion: { versionNumber: 1, questions: [] },
    partnerApplication: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerApplicationFormBinding.findFirst.mockResolvedValue(null);
  db.formSubmission.count.mockResolvedValue(0);
  db.formSubmission.findMany.mockResolvedValue([]);
});

describe("responsesWhere", () => {
  it("scopes to the version with no filters", () => {
    expect(responsesWhere("f1", "v1")).toEqual({ formId: "f1", formVersionId: "v1" });
  });

  it("filters by slot", () => {
    expect(responsesWhere("f1", "v1", { slot: "Tue 3pm" })).toMatchObject({ slot: "Tue 3pm" });
  });

  it("requires every word to match a name or email field, case-insensitively", () => {
    const where = responsesWhere("f1", "v1", { q: "  ada  example " });
    expect(where.AND).toHaveLength(2);
    expect((where.AND as any[])[0].OR).toEqual([
      { submitterName: { contains: "ada", mode: "insensitive" } },
      { submitterEmail: { contains: "ada", mode: "insensitive" } },
      { user: { is: { firstName: { contains: "ada", mode: "insensitive" } } } },
      { user: { is: { lastName: { contains: "ada", mode: "insensitive" } } } },
      { user: { is: { daliEmail: { contains: "ada", mode: "insensitive" } } } },
      { user: { is: { personalEmail: { contains: "ada", mode: "insensitive" } } } },
    ]);
  });

  it("treats a blank query as no search", () => {
    expect(responsesWhere("f1", "v1", { q: "   " })).toEqual({ formId: "f1", formVersionId: "v1" });
  });
});

describe("loadVersionResponses", () => {
  it("reads one page at the right offset and trims the extra row", async () => {
    const rows = Array.from({ length: RESPONSES_PAGE_SIZE + 1 }, (_, i) => submission(i));
    // count(total), count(matches), distinct slots, page rows
    db.formSubmission.count.mockResolvedValueOnce(300).mockResolvedValueOnce(120);
    db.formSubmission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);

    const result = await loadVersionResponses("f1", "v1", { page: 3 });

    const pageCall = db.formSubmission.findMany.mock.calls.find((c) => c[0].take);
    expect(pageCall![0]).toMatchObject({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: RESPONSES_PAGE_SIZE * 2,
      take: RESPONSES_PAGE_SIZE + 1,
    });
    expect(result.responses).toHaveLength(RESPONSES_PAGE_SIZE);
    expect(result).toMatchObject({ totalCount: 300, matchCount: 120, page: 3, hasNext: true });
  });

  it("reports the end of the list on a short page", async () => {
    db.formSubmission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([submission(1)]);
    const result = await loadVersionResponses("f1", "v1");
    expect(result.hasNext).toBe(false);
    expect(result.page).toBe(1);
    expect(result.responses[0]).toMatchObject({ name: "Ada Lovelace", email: "ada@example.edu" });
  });

  it("counts the whole version and the filtered set separately", async () => {
    await loadVersionResponses("f1", "v1", { q: "ada", slot: "Tue 3pm" });
    const wheres = db.formSubmission.count.mock.calls.map((c) => c[0].where);
    expect(wheres[0]).toEqual({ formId: "f1", formVersionId: "v1" });
    expect(wheres[1]).toMatchObject({ slot: "Tue 3pm", AND: expect.any(Array) });
  });

  it("builds slot options from every submission in the version, not the page", async () => {
    db.formSubmission.findMany
      .mockResolvedValueOnce([{ slot: "Mon 9am" }, { slot: "Tue 3pm" }])
      .mockResolvedValueOnce([submission(1, { slot: "Tue 3pm" })]);
    const result = await loadVersionResponses("f1", "v1", { slot: "Tue 3pm" });
    expect(result.slotOptions).toEqual(["Mon 9am", "Tue 3pm"]);
    const slotCall = db.formSubmission.findMany.mock.calls.find((c) => c[0].distinct);
    expect(slotCall![0]).toMatchObject({
      where: { formId: "f1", formVersionId: "v1", slot: { not: null } },
      distinct: ["slot"],
      select: { slot: true },
    });
    expect(slotCall![0].take).toBeUndefined();
  });

  it("falls back to the submitter's own name and email for anonymous fills", async () => {
    db.formSubmission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      submission(1, { user: null, submitterName: "Grace", submitterEmail: "grace@example.edu" }),
      submission(2, { user: null }),
    ]);
    const { responses } = await loadVersionResponses("f1", "v1");
    expect(responses.map((r) => [r.name, r.email])).toEqual([
      ["Grace", "grace@example.edu"],
      ["Anonymous", null],
    ]);
  });
});
