import { describe, it, expect } from "vitest";
import { finalizeAnswer, SourceRegistry } from "../sources";

function registry() {
  const r = new SourceRegistry();
  r.add({ kind: "document", title: "Sprint 4 planning", url: "/documents/p1" });
  r.add({ kind: "meeting", title: "Partner sync", url: "/calendar/meeting/m1", date: "2026-10-30T15:00:00Z" });
  r.add({ kind: "task", title: "Ship v2", url: "/projects/pr1?tab=board&task=t1" });
  return r;
}

describe("SourceRegistry", () => {
  it("hands out refs in order and reuses a ref for the same url", () => {
    const r = new SourceRegistry();
    const a = r.add({ kind: "document", title: "A", url: "/documents/a" });
    const b = r.add({ kind: "document", title: "B", url: "/documents/b" });
    const again = r.add({ kind: "document", title: "A, renamed", url: "/documents/a" });
    expect([a.ref, b.ref, again.ref]).toEqual(["s1", "s2", "s1"]);
    expect(again.title).toBe("A");
    expect(r.size).toBe(2);
    expect(r.get("s2")).toBe(b);
    expect(r.get("s9")).toBeUndefined();
  });

  it("names a blank title", () => {
    expect(new SourceRegistry().add({ kind: "document", title: "  ", url: "/documents/x" }).title).toBe("Untitled");
  });
});

describe("finalizeAnswer", () => {
  it("numbers cited sources in the order they first appear", () => {
    const { answer, sources } = finalizeAnswer(
      "The launch moved to May [s2]. The plan lists the steps [s1]. The sync confirmed it [s2].",
      registry(),
    );
    expect(answer).toBe("The launch moved to May [1]. The plan lists the steps [2]. The sync confirmed it [1].");
    expect(sources.map((s) => [s.n, s.ref, s.title])).toEqual([
      [1, "s2", "Partner sync"],
      [2, "s1", "Sprint 4 planning"],
    ]);
  });

  it("returns only cited sources, not everything the tools found", () => {
    expect(finalizeAnswer("Done [s3].", registry()).sources.map((s) => s.url)).toEqual([
      "/projects/pr1?tab=board&task=t1",
    ]);
  });

  it("splits a grouped citation and dedupes within it", () => {
    expect(finalizeAnswer("Both say so [s1, s3,s1].", registry()).answer).toBe("Both say so [1][2].");
  });

  it("drops refs no tool returned, keeping the rest of the sentence clean", () => {
    const { answer, sources } = finalizeAnswer("It's due Friday [s7]. See the plan [s1, s99].", registry());
    expect(answer).toBe("It's due Friday. See the plan [1].");
    expect(sources).toHaveLength(1);
  });

  it("never turns model-written links into sources", () => {
    const { answer, sources } = finalizeAnswer(
      "Open [the plan](https://evil.example/x) or <https://evil.example/y>. ![pixel](https://evil.example/p.png)",
      registry(),
    );
    expect(answer).toBe("Open the plan or https://evil.example/y.");
    expect(answer).not.toContain("](");
    expect(sources).toEqual([]);
  });

  it("leaves an answer without citations as written", () => {
    expect(finalizeAnswer("I couldn't find that. I searched notes for \"launch\".", registry())).toEqual({
      answer: "I couldn't find that. I searched notes for \"launch\".",
      sources: [],
    });
  });

  it("keeps the source details for display", () => {
    const [s] = finalizeAnswer("Yes [s2].", registry()).sources;
    expect(s).toEqual({
      kind: "meeting",
      title: "Partner sync",
      url: "/calendar/meeting/m1",
      date: "2026-10-30T15:00:00Z",
      ref: "s2",
      n: 1,
    });
  });
});
