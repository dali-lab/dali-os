import { describe, expect, it } from "vitest";
import {
  activityKey,
  describeJourney,
  formatJourneyTime,
  getJourneyProgress,
  getModule,
  getModuleStatus,
  getNewlyUnlocked,
  journeyTitle,
  moduleTitle,
  nextAvailableModule,
  parseMinutes,
  progressKeys,
  richDocHas,
  richDocIsEmpty,
  richDocWordCount,
  sameContent,
  startModule,
} from "../journey";
import { diamond, mod } from "./fixtures";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }], children: [] });

describe("progress keys", () => {
  it("names a module's activities after the module", () => {
    expect(activityKey("m1", "lab")).toBe("m1#lab");
    expect(activityKey("m1", "quiz")).toBe("m1#quiz");
  });

  it("lists every module plus only the activities that exist", () => {
    const j = {
      modules: [
        mod("a", [], { lab: { title: "", intro: "", files: {}, steps: [] } }),
        mod("b", [], { quiz: { title: "", intro: "", passingScore: 80, questions: [] } }),
        mod("c"),
      ],
    };
    expect([...progressKeys(j)].sort()).toEqual(["a", "a#lab", "b", "b#quiz", "c"]);
  });
});

describe("module status", () => {
  const j = diamond();
  const [a, b, , d] = j.modules;

  it("is available when every prerequisite is done", () => {
    expect(getModuleStatus(a, new Set())).toBe("available");
    expect(getModuleStatus(b, new Set(["a"]))).toBe("available");
  });

  it("is locked while any prerequisite is missing", () => {
    expect(getModuleStatus(b, new Set())).toBe("locked");
    expect(getModuleStatus(d, new Set(["a", "b"]))).toBe("locked");
  });

  it("is completed once recorded, even with prerequisites missing", () => {
    expect(getModuleStatus(d, new Set(["d"]))).toBe("completed");
  });

  it("ignores activity keys when deciding prerequisites", () => {
    expect(getModuleStatus(b, new Set(["a#lab"]))).toBe("locked");
  });
});

describe("unlocking", () => {
  it("reports modules that finishing one would open", () => {
    expect(getNewlyUnlocked(diamond(), "a", new Set()).map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("waits for every prerequisite of a join", () => {
    expect(getNewlyUnlocked(diamond(), "b", new Set(["a"]))).toEqual([]);
    expect(getNewlyUnlocked(diamond(), "c", new Set(["a", "b"])).map((m) => m.id)).toEqual(["d"]);
  });

  it("doesn't report modules already finished", () => {
    expect(getNewlyUnlocked(diamond(), "a", new Set(["b"])).map((m) => m.id)).toEqual(["c"]);
  });
});

describe("progress and navigation", () => {
  it("counts finished modules only", () => {
    expect(getJourneyProgress(diamond(), new Set(["a", "b#quiz", "zzz"]))).toEqual({ done: 1, total: 4 });
  });

  it("picks the first open module in authoring order", () => {
    expect(nextAvailableModule(diamond(), new Set())?.id).toBe("a");
    expect(nextAvailableModule(diamond(), new Set(["a"]))?.id).toBe("b");
    expect(nextAvailableModule(diamond(), new Set(["a", "b", "c", "d"]))).toBeUndefined();
  });

  it("finds the start module and looks modules up by id", () => {
    expect(startModule(diamond())?.id).toBe("a");
    expect(getModule(diamond(), "c")?.id).toBe("c");
    expect(getModule(diamond(), undefined)).toBeUndefined();
  });
});

describe("durations", () => {
  it.each([
    ["20 min", 20],
    ["1 h", 60],
    ["1h 30m", 90],
    ["2 hours 5 min", 125],
    ["soon", 0],
  ])("parses %s as %i minutes", (input, minutes) => {
    expect(parseMinutes(input)).toBe(minutes);
  });

  it("formats a journey's total time", () => {
    expect(formatJourneyTime({ modules: [mod("a"), mod("b")] })).toBe("40 min");
    expect(formatJourneyTime({ modules: [mod("a", [], { duration: "1 h" })] })).toBe("1 h");
    expect(formatJourneyTime({ modules: [mod("a", [], { duration: "1 h 15 min" })] })).toBe("1 h 15 min");
  });

  it("describes counts with singular and plural forms, leaving out zero labs and quizzes", () => {
    expect(describeJourney({ modules: [mod("a")] })).toBe("1 module · about 20 min");
    const lab = { title: "", intro: "", files: {}, steps: [] };
    const quiz = { title: "", intro: "", passingScore: 80, questions: [] };
    expect(describeJourney({ modules: [mod("a", [], { lab, quiz }), mod("b", [], { lab })] })).toBe(
      "2 modules · 2 labs · 1 quiz · about 40 min",
    );
  });
});

describe("titles", () => {
  it("falls back when a title is blank", () => {
    expect(journeyTitle({ title: "  " })).toBe("Untitled journey");
    expect(moduleTitle({ title: "" })).toBe("Untitled module");
    expect(moduleTitle({ title: "Git" })).toBe("Git");
  });
});

describe("rich documents", () => {
  const doc = [para("Hello there"), { type: "bulletListItem", content: [], children: [{ type: "video", props: {}, children: [] }] }];

  it("finds a block type anywhere in the tree", () => {
    expect(richDocHas(doc as never, "video")).toBe(true);
    expect(richDocHas(doc as never, "image")).toBe(false);
    expect(richDocHas(undefined, "video")).toBe(false);
  });

  it("counts words", () => {
    expect(richDocWordCount(doc as never)).toBe(2);
    expect(richDocWordCount(undefined)).toBe(0);
  });

  it("treats a document with media but no text as not empty", () => {
    expect(richDocIsEmpty([])).toBe(true);
    expect(richDocIsEmpty([para("")] as never)).toBe(true);
    expect(richDocIsEmpty([{ type: "image", props: { url: "x" }, children: [] }] as never)).toBe(false);
    expect(richDocIsEmpty([para("Hi")] as never)).toBe(false);
  });
});

describe("sameContent", () => {
  it("ignores key order, as Postgres jsonb reorders keys", () => {
    expect(sameContent({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  });

  it("treats undefined fields as absent", () => {
    expect(sameContent({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("notices changed values, array order and type mismatches", () => {
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameContent([1, 2], [2, 1])).toBe(false);
    expect(sameContent([1], { 0: 1 })).toBe(false);
    expect(sameContent(null, {})).toBe(false);
    expect(sameContent({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
