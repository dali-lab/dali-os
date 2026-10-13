import { describe, it, expect } from "vitest";
import {
  isSuggested,
  suggestNotebooks,
  type NotebookCandidate,
  type SuggestContext,
} from "~/lib/notebook-suggest";

const row = (over: Partial<NotebookCandidate> = {}): NotebookCandidate => ({
  id: "nb",
  title: "Notebook",
  path: "Lab",
  tabCount: 1,
  lastNoteAt: null,
  workspaceType: "Lab",
  workspaceId: null,
  holdsSeriesNote: false,
  audienceKeys: [],
  ...over,
});

const ctx = (over: Partial<SuggestContext> = {}): SuggestContext => ({
  seriesNotebookId: null,
  projectId: null,
  audienceKey: null,
  ...over,
});

describe("isSuggested", () => {
  it("is false when no signal matches", () => {
    expect(isSuggested(row(), ctx())).toBe(false);
  });

  it("flags the series' current default", () => {
    expect(isSuggested(row({ id: "nb-s" }), ctx({ seriesNotebookId: "nb-s" }))).toBe(true);
    expect(isSuggested(row({ id: "nb-o" }), ctx({ seriesNotebookId: "nb-s" }))).toBe(false);
  });

  it("flags a notebook that already holds a note of the series", () => {
    expect(isSuggested(row({ holdsSeriesNote: true }), ctx())).toBe(true);
  });

  it("flags a notebook that lives in the given project, and no other project's", () => {
    const inProject = row({ workspaceType: "Project", workspaceId: "p1" });
    expect(isSuggested(inProject, ctx({ projectId: "p1" }))).toBe(true);
    expect(isSuggested(inProject, ctx({ projectId: "p2" }))).toBe(false);
    expect(isSuggested(inProject, ctx())).toBe(false);
    expect(isSuggested(row({ workspaceType: "Lab", workspaceId: "p1" }), ctx({ projectId: "p1" }))).toBe(false);
  });

  it("flags a notebook used by meetings with the same guest set", () => {
    const used = row({ audienceKeys: ["core:users:abc", "general:users:def"] });
    expect(isSuggested(used, ctx({ audienceKey: "general:users:def" }))).toBe(true);
    expect(isSuggested(used, ctx({ audienceKey: "general:users:zzz" }))).toBe(false);
    expect(isSuggested(used, ctx())).toBe(false);
  });
});

describe("suggestNotebooks", () => {
  const old = new Date("2026-01-05T00:00:00Z");
  const mid = new Date("2026-05-05T00:00:00Z");
  const recent = new Date("2026-09-05T00:00:00Z");

  it("puts suggested notebooks first, each group most recent note first", () => {
    const out = suggestNotebooks(
      [
        row({ id: "plain-recent", lastNoteAt: recent }),
        row({ id: "sug-old", lastNoteAt: old, holdsSeriesNote: true }),
        row({ id: "plain-mid", lastNoteAt: mid }),
        row({ id: "sug-recent", lastNoteAt: recent, holdsSeriesNote: true }),
      ],
      ctx(),
    );
    expect(out.map((r) => r.id)).toEqual(["sug-recent", "sug-old", "plain-recent", "plain-mid"]);
    expect(out.map((r) => r.suggested)).toEqual([true, true, false, false]);
  });

  it("sorts notebooks with no dated note last, then by title", () => {
    const out = suggestNotebooks(
      [row({ id: "b", title: "Beta" }), row({ id: "a", title: "Alpha" }), row({ id: "dated", lastNoteAt: old })],
      ctx(),
    );
    expect(out.map((r) => r.id)).toEqual(["dated", "a", "b"]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ id: "x" }), row({ id: "y", holdsSeriesNote: true })];
    suggestNotebooks(rows, ctx());
    expect(rows.map((r) => r.id)).toEqual(["x", "y"]);
  });
});
