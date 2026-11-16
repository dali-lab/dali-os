import { describe, expect, it } from "vitest";
import {
  applicationColumns,
  visibleSort,
  CYCLE_SCOPED_PARAMS,
  DEFAULT_SORT,
  filtersFromParams,
  matchesApplicationQuery,
  sortApplications,
  sortFromParams,
  writeViewParams,
} from "~/hiring/lib/application-filters";

const params = (search: string) => new URLSearchParams(search);

describe("filtersFromParams", () => {
  it("is empty for a bare URL", () => {
    expect(filtersFromParams(params(""))).toEqual({
      domainIds: [],
      statuses: [],
      stage: null,
      engagement: [],
      eventIds: [],
      pieIncludesInProgress: false,
    });
  });

  it("reads every filter, keeping repeated values", () => {
    expect(
      filtersFromParams(
        params(
          "cycle=c1&domain=d1&domain=d2&status=Submitted&stage=Interview&engagement=returning&engagement=educated&event=ev1&pie=all&q=ada",
        ),
      ),
    ).toEqual({
      domainIds: ["d1", "d2"],
      statuses: ["Submitted"],
      stage: "Interview",
      engagement: ["returning", "educated"],
      eventIds: ["ev1"],
      pieIncludesInProgress: true,
    });
  });

  it("drops engagement signals that don't exist", () => {
    expect(filtersFromParams(params("engagement=classYear&engagement=emailed")).engagement).toEqual([
      "emailed",
    ]);
  });

  it("treats an empty stage as no stage", () => {
    expect(filtersFromParams(params("stage=")).stage).toBeNull();
  });
});

describe("sortFromParams", () => {
  it("defaults when the URL names no sort or an unknown column", () => {
    expect(sortFromParams(params(""))).toEqual(DEFAULT_SORT);
    expect(sortFromParams(params("sort=reviewCount&dir=desc"))).toEqual(DEFAULT_SORT);
  });

  it("reads a known column and direction", () => {
    expect(sortFromParams(params("sort=reviewers&dir=desc"))).toEqual({ key: "reviewers", dir: "desc" });
    expect(sortFromParams(params("sort=submittedAt&dir=asc"))).toEqual({ key: "submittedAt", dir: "asc" });
  });
});

describe("writeViewParams", () => {
  it("writes only the fields it is given and keeps every other param", () => {
    const next = writeViewParams(params("cycle=c1&q=ada&status=Submitted"), { domainIds: ["d1", "d2"] });
    expect(next.toString()).toBe("cycle=c1&q=ada&status=Submitted&domain=d1&domain=d2");
  });

  it("replaces a list and removes it when emptied", () => {
    expect(writeViewParams(params("status=A&status=B"), { statuses: ["C"] }).toString()).toBe("status=C");
    expect(writeViewParams(params("cycle=c1&status=A"), { statuses: [] }).toString()).toBe("cycle=c1");
  });

  it("sets and clears the stage and the in-progress toggle", () => {
    const on = writeViewParams(params(""), { stage: "Interview", pieIncludesInProgress: true });
    expect(on.toString()).toBe("stage=Interview&pie=all");
    expect(writeViewParams(on, { stage: null, pieIncludesInProgress: false }).toString()).toBe("");
  });

  it("writes a sort, and leaves the default out of the URL", () => {
    const desc = writeViewParams(params("q=a"), { sort: { key: "reviewers", dir: "desc" } });
    expect(desc.toString()).toBe("q=a&sort=reviewers&dir=desc");
    expect(writeViewParams(desc, { sort: { key: "domain", dir: "asc" } }).toString()).toBe("q=a&sort=domain&dir=asc");
    expect(writeViewParams(desc, { sort: DEFAULT_SORT }).toString()).toBe("q=a");
  });

  it("round-trips through filtersFromParams and sortFromParams", () => {
    const view = {
      domainIds: ["d1"],
      statuses: ["Submitted", "Rejected"],
      stage: "Offer",
      engagement: ["attendedEvent" as const],
      eventIds: ["ev1", "ev2"],
      pieIncludesInProgress: true,
    };
    const sort = { key: "status" as const, dir: "desc" as const };
    const written = writeViewParams(params("cycle=c1"), { ...view, sort });
    expect(filtersFromParams(written)).toEqual(view);
    expect(sortFromParams(written)).toEqual(sort);
  });
});

describe("CYCLE_SCOPED_PARAMS", () => {
  it("covers every filter picked from a cycle's data, and not search, sort or the toggle", () => {
    expect([...CYCLE_SCOPED_PARAMS].sort()).toEqual(["domain", "engagement", "event", "stage", "status"]);
  });
});

describe("sortApplications", () => {
  const row = (name: string, over: Partial<Parameters<typeof sortApplications>[0][number]> = {}) => ({
    name,
    domain: "Dev",
    status: "Submitted",
    submittedAt: null as string | null,
    reviewers: null as string | null,
    interviewers: null as string | null,
    ...over,
  });
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it("sorts text columns in both directions without mutating the input", () => {
    const rows = [row("Bo"), row("Ada"), row("Cy")];
    expect(names(sortApplications(rows, { key: "name", dir: "asc" }))).toEqual(["Ada", "Bo", "Cy"]);
    expect(names(sortApplications(rows, { key: "name", dir: "desc" }))).toEqual(["Cy", "Bo", "Ada"]);
    expect(names(rows)).toEqual(["Bo", "Ada", "Cy"]);
  });

  it("sorts reviewer and interviewer names, with unassigned rows last", () => {
    const rows = [row("Ada", { reviewers: "Zed Q" }), row("Bo"), row("Cy", { reviewers: "Amy R" })];
    expect(names(sortApplications(rows, { key: "reviewers", dir: "asc" }))).toEqual(["Cy", "Ada", "Bo"]);
    expect(names(sortApplications(rows, { key: "reviewers", dir: "desc" }))).toEqual(["Ada", "Cy", "Bo"]);
    const iv = [row("Ada"), row("Bo", { interviewers: "Kim L" })];
    expect(names(sortApplications(iv, { key: "interviewers", dir: "asc" }))).toEqual(["Bo", "Ada"]);
  });

  it("keeps unsubmitted rows last in both directions", () => {
    const rows = [
      row("Ada"),
      row("Bo", { submittedAt: "2026-02-01T00:00:00.000Z" }),
      row("Cy", { submittedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(names(sortApplications(rows, { key: "submittedAt", dir: "asc" }))).toEqual(["Cy", "Bo", "Ada"]);
    expect(names(sortApplications(rows, { key: "submittedAt", dir: "desc" }))).toEqual(["Bo", "Cy", "Ada"]);
  });

  it("keeps the incoming order for ties", () => {
    const rows = [row("Ada", { domain: "Design" }), row("Bo"), row("Cy", { domain: "Design" })];
    expect(names(sortApplications(rows, { key: "domain", dir: "desc" }))).toEqual(["Bo", "Ada", "Cy"]);
  });
});

describe("applicationColumns", () => {
  const keys = (status: string) => applicationColumns(status).map((c) => c.key);

  it("shows reviewers and interviewers instead of the submitted date while under review", () => {
    expect(keys("UnderReview")).toEqual(["name", "domain", "status", "reviewers", "interviewers"]);
  });

  it("shows the submitted date and no assignee columns in every other stage", () => {
    for (const status of ["Draft", "Open", "Completed", ""]) {
      expect(keys(status)).toEqual(["name", "domain", "status", "submittedAt"]);
    }
  });
});

describe("visibleSort", () => {
  it("keeps a sort on a column that is shown", () => {
    const sort = { key: "reviewers", dir: "desc" } as const;
    expect(visibleSort(sort, applicationColumns("UnderReview"))).toEqual(sort);
  });

  it("falls back to the default when the sorted column is hidden for this cycle", () => {
    expect(visibleSort({ key: "reviewers", dir: "desc" }, applicationColumns("Open"))).toEqual(DEFAULT_SORT);
    expect(visibleSort({ key: "submittedAt", dir: "asc" }, applicationColumns("UnderReview"))).toEqual(DEFAULT_SORT);
  });
});

describe("matchesApplicationQuery", () => {
  const ada = { name: "Ada Lovelace", email: "ada.lovelace@example.edu" };

  it("matches every row on an empty or blank query", () => {
    expect(matchesApplicationQuery(ada, "")).toBe(true);
    expect(matchesApplicationQuery(ada, "   ")).toBe(true);
  });

  it("matches a first name with a trailing space", () => {
    expect(matchesApplicationQuery(ada, "ada ")).toBe(true);
  });

  it("matches a first name plus the start of a last name", () => {
    expect(matchesApplicationQuery(ada, "ada l")).toBe(true);
  });

  it("matches the full name in either order, case-insensitively", () => {
    expect(matchesApplicationQuery(ada, "Ada Lovelace")).toBe(true);
    expect(matchesApplicationQuery(ada, "lovelace ada")).toBe(true);
  });

  it("matches on the email", () => {
    expect(matchesApplicationQuery(ada, "lovelace@example")).toBe(true);
  });

  it("matches a row with no email by name", () => {
    expect(matchesApplicationQuery({ ...ada, email: null }, "ada l")).toBe(true);
  });

  it("rejects a query with any word that isn't in the name or email", () => {
    expect(matchesApplicationQuery(ada, "ada q")).toBe(false);
    expect(matchesApplicationQuery(ada, "grace")).toBe(false);
  });
});
