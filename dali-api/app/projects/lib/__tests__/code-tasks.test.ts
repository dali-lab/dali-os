import { describe, it, expect } from "vitest";
import {
  canBeCodeTask,
  extractTaskRefs,
  hasMergedPr,
  parsePullRequestUrl,
  pullRequestState,
  requiresMergedPr,
} from "../code-tasks";

describe("canBeCodeTask / requiresMergedPr", () => {
  it("only Fullstack tasks can be code tasks", () => {
    expect(canBeCodeTask("Fullstack")).toBe(true);
    for (const code of ["UIUX", "PM", "CORE", null, undefined, "fullstack"]) {
      expect(canBeCodeTask(code)).toBe(false);
    }
  });

  it("needs a merged PR only for a Fullstack task flagged as code", () => {
    expect(requiresMergedPr({ isCodeTask: true, domainCode: "Fullstack" })).toBe(true);
    expect(requiresMergedPr({ isCodeTask: false, domainCode: "Fullstack" })).toBe(false);
    expect(requiresMergedPr({ isCodeTask: true, domainCode: "UIUX" })).toBe(false);
    expect(requiresMergedPr({ isCodeTask: true, domainCode: null })).toBe(false);
  });
});

describe("hasMergedPr", () => {
  it("is true when any attached PR is merged", () => {
    expect(hasMergedPr([])).toBe(false);
    expect(hasMergedPr([{ state: "open" }, { state: "closed" }])).toBe(false);
    expect(hasMergedPr([{ state: "open" }, { state: "merged" }])).toBe(true);
  });
});

describe("parsePullRequestUrl", () => {
  it.each([
    ["https://github.com/dali-lab/os/pull/42", { repo: "dali-lab/os", number: 42 }],
    ["github.com/dali-lab/os/pull/42/files", { repo: "dali-lab/os", number: 42 }],
    ["  https://www.github.com/a/b/pull/7?w=1#x  ", { repo: "a/b", number: 7 }],
  ])("%s", (url, out) => {
    expect(parsePullRequestUrl(url)).toEqual(out);
  });

  it.each([
    "https://github.com/dali-lab/os/issues/42",
    "https://gitlab.com/a/b/pull/1",
    "https://github.com/dali-lab/pull/1",
    "not a url",
  ])("rejects %s", (url) => {
    expect(parsePullRequestUrl(url)).toBeNull();
  });
});

describe("pullRequestState", () => {
  it("maps GitHub's PR fields", () => {
    expect(pullRequestState({ state: "closed", merged: true })).toBe("merged");
    expect(pullRequestState({ state: "closed", merged_at: "2026-10-01T00:00:00Z" })).toBe("merged");
    expect(pullRequestState({ state: "closed", merged: false })).toBe("closed");
    expect(pullRequestState({ state: "open" })).toBe("open");
  });
});

describe("extractTaskRefs", () => {
  it("finds closing-keyword issue refs for the same repo only", () => {
    const text = "Closes #12, fixes: #13 and Resolves dali-lab/os#14. See #99. fixes other/repo#15";
    expect(extractTaskRefs(text, "dali-lab/os").issueNumbers.sort()).toEqual([12, 13, 14]);
  });

  it("finds dali.os task links", () => {
    const text =
      "Implements https://os.dali.dartmouth.edu/projects/project-dali-os?tab=board&task=cmabc123 (and ?task=nope elsewhere)";
    expect(extractTaskRefs(text, "a/b").taskIds).toEqual(["cmabc123"]);
  });

  it("finds nothing in plain text", () => {
    expect(extractTaskRefs("just a PR", "a/b")).toEqual({ issueNumbers: [], taskIds: [] });
  });
});
