import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    partnerApplicationFormBinding: { findFirst: vi.fn() },
    formSubmission: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("~/forms/lib/answer-rows.server", () => ({
  buildReferenceLabelMaps: vi.fn(async () => new Map()),
  buildResponseGrid: vi.fn(async (subs: unknown[]) => ({
    columns: [{ key: "q1", label: "Role" }],
    rowsBySubmission: subs.map(() => [{ key: "q1", label: "Role", value: "x" }]),
  })),
}));
vi.mock("~/projects/lib/member-history.server", () => ({
  loadMemberHistories: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { loadMemberHistories } from "~/projects/lib/member-history.server";
import {
  RESPONSES_PAGE_SIZE,
  loadVersionResponses,
  responsesWhere,
  versionResponsesWhere,
} from "~/forms/lib/version-responses.server";

const db = prisma as unknown as {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
  partnerApplicationFormBinding: { findFirst: ReturnType<typeof vi.fn> };
  formSubmission: { count: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};

function submission(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `s${i}`,
    createdAt: new Date(Date.UTC(2026, 4, 20, 10, 0, 60 - i)),
    updatedAt: new Date(Date.UTC(2026, 4, 20, 10, 0, 60 - i)),
    form: { name: "Feedback" },
    staffingCycleId: null,
    educationOfferingId: null,
    educationSessionId: null,
    educationApplication: null,
    partnerSurveyFor: null,
    answers: {},
    submitterName: null,
    submitterEmail: null,
    submitterIp: null,
    slot: null,
    userId: "u1",
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

describe("responsesWhere with answer matches", () => {
  it("restricts to the ids the filters matched, including none", () => {
    expect(responsesWhere("f1", "v1", {}, { filterIds: ["s1", "s2"], wordIds: [] })).toMatchObject({
      id: { in: ["s1", "s2"] },
    });
    expect(responsesWhere("f1", "v1", {}, { filterIds: [], wordIds: [] })).toMatchObject({ id: { in: [] } });
  });

  it("lets each word match the respondent or an answer", () => {
    const where = responsesWhere("f1", "v1", { q: "ada rust" }, { filterIds: null, wordIds: [["s1"], []] });
    const [first, second] = where.AND as { OR: unknown[] }[];
    expect(first.OR).toHaveLength(7);
    expect(first.OR.at(-1)).toEqual({ id: { in: ["s1"] } });
    expect(second.OR).toHaveLength(6);
  });
});

describe("versionResponsesWhere", () => {
  const questions = [
    { key: "k", type: "text", required: false, data: { label: "K" } },
  ] as never;

  it("asks the database for nothing without answer filters or a search", async () => {
    await versionResponsesWhere("f1", "v1", { slot: "s", questions });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("folds the answer filter ids and the answer-text ids into the where", async () => {
    db.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes("jsonb_each_text") ? [{ id: "t1", word: 1 }] : [{ id: "s1" }],
    );
    const where = await versionResponsesWhere("f1", "v1", {
      q: "rust",
      answers: [{ key: "k", kind: "blank" }],
      questions,
    });
    expect(where).toMatchObject({ formId: "f1", formVersionId: "v1", id: { in: ["s1"] } });
    expect((where.AND as { OR: unknown[] }[])[0].OR.at(-1)).toEqual({ id: { in: ["t1"] } });
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
});

describe("loadVersionResponses", () => {
  it("counts matches with the answer filters applied and returns the panel's questions", async () => {
    const questions = [
      { key: "k", type: "select", required: false, data: { label: "K", options: ["A"] } },
      { key: "f", type: "file", required: false, data: { label: "F" } },
    ] as never;
    db.$queryRawUnsafe.mockResolvedValue([{ id: "s1" }]);
    const result = await loadVersionResponses("f1", "v1", {
      answers: [{ key: "k", kind: "is", values: ["A"] }],
      questions,
    });
    const wheres = db.formSubmission.count.mock.calls.map((c) => c[0].where);
    expect(wheres[0]).toEqual({ formId: "f1", formVersionId: "v1" });
    expect(wheres[1]).toMatchObject({ id: { in: ["s1"] } });
    expect(result.filterQuestions.map((f) => f.key)).toEqual(["k"]);
  });

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

describe("loadVersionResponses edit and delete state", () => {
  async function rowFor(over: Record<string, unknown>) {
    db.formSubmission.findMany.mockResolvedValue([submission(1, over)]);
    return (await loadVersionResponses("f1", "v1")).responses[0];
  }

  it("marks a response edited only when updatedAt is after createdAt", async () => {
    expect((await rowFor({})).edited).toBe(false);
    expect((await rowFor({ updatedAt: new Date(Date.UTC(2026, 4, 21)) })).edited).toBe(true);
  });

  it("leaves an ordinary response deletable", async () => {
    expect((await rowFor({})).lockReason).toBeNull();
  });

  it.each([
    ["slot", { slot: "project-bids" }],
    ["staffingCycleId", { staffingCycleId: "c1" }],
    ["educationOfferingId", { educationOfferingId: "o1" }],
    ["educationSessionId", { educationSessionId: "s1" }],
    ["partnerApplication", { partnerApplication: { id: "a", title: "T" } }],
    ["educationApplication", { educationApplication: { id: "a" } }],
    ["partnerSurveyFor", { partnerSurveyFor: { id: "a" } }],
    ["the onboarding profile form", { form: { name: "Welcome to DALI! 👋" } }],
  ])("gives a reason for a response with %s", async (_n, over) => {
    expect((await rowFor(over)).lockReason).toEqual(expect.any(String));
  });
});

describe("loadVersionResponses partner application", () => {
  it("selects the partner application title so the table can name it", async () => {
    await loadVersionResponses("f1", "v1");
    const page = db.formSubmission.findMany.mock.calls.find((c) => c[0].select?.partnerApplication)!;
    expect(page[0].select.partnerApplication).toEqual({ select: { id: true, title: true } });
    expect(page[0].select.slot).toBe(true);
  });
});

describe("loadVersionResponses member columns", () => {
  const f26 = { code: "26F", sortKey: 264, startDate: new Date("2026-09-14") };
  const history = {
    projects: [{ level: "P2", domainId: "eng", project: { name: "Evergreen" }, domain: { displayName: "Engineering" }, term: f26 }],
    core: [],
    eligibilities: [{ level: "P2", domainId: "eng", domain: { displayName: "Engineering" } }],
  };

  beforeEach(() => {
    vi.mocked(loadMemberHistories).mockResolvedValue(new Map([["u1", history]]));
  });

  it("adds no columns and skips the history lookup when none are chosen", async () => {
    db.formSubmission.findMany.mockResolvedValue([submission(1)]);
    const r = await loadVersionResponses("f1", "v1");
    expect(loadMemberHistories).not.toHaveBeenCalled();
    expect(r.columns).toEqual([{ key: "q1", label: "Role" }]);
    expect(r.responses[0].rows.map((x) => x.key)).toEqual(["q1"]);
  });

  it("appends the chosen columns in the order given and fills them for signed-in respondents", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-11"), toFake: ["Date"] });
    db.formSubmission.findMany.mockResolvedValue([
      submission(1),
      submission(2, { userId: "u1" }),
      submission(3, { userId: null, user: null, submitterName: "Guest" }),
    ]);
    const r = await loadVersionResponses("f1", "v1", {
      columns: [{ id: "member:currentRole" }, { id: "member:hiredRoles" }, { id: "member:projectHistory" }],
    });
    vi.useRealTimers();

    expect(loadMemberHistories).toHaveBeenCalledWith(["u1"]);
    expect(r.columns).toEqual([
      { key: "q1", label: "Role" },
      { key: "member:currentRole", label: "Current role" },
      { key: "member:hiredRoles", label: "Hired roles" },
      { key: "member:projectHistory", label: "Project history" },
    ]);
    expect(r.responses[0].rows.slice(1)).toEqual([
      { key: "member:currentRole", label: "Current role", value: "26F: Engineering (P2)" },
      { key: "member:hiredRoles", label: "Hired roles", value: "Engineering (P2)" },
      { key: "member:projectHistory", label: "Project history", value: "Evergreen (26F)" },
    ]);
    expect(r.responses[2].rows.slice(1).map((x) => x.value)).toEqual(["", "", ""]);
  });

  it("follows saved order, labels and hidden columns, and lists what + can add", async () => {
    db.formSubmission.findMany.mockResolvedValue([submission(2, { userId: "u1" })]);
    const r = await loadVersionResponses("f1", "v1", {
      columns: [
        { id: "member:termsInLab", label: "Terms" },
        { id: "q1", hidden: true },
        { id: "member:hiredRoles", hidden: true },
      ],
    });
    expect(r.columns).toEqual([{ key: "member:termsInLab", label: "Terms" }]);
    expect(r.hiddenColumns.map((c) => c.key)).toEqual([
      "q1",
      "member:hiredRoles",
      "member:projectHistory",
      "member:currentRole",
    ]);
    expect(r.responses[0].rows.map((x) => x.key)).toEqual(["q1", "member:termsInLab"]);
  });
});
