import { describe, expect, it } from "vitest";
import { parseJourneyContent } from "../content-schema";
import { createJourneyContent, createLab, createQuiz } from "../journey-edit";
import { createSlide } from "~/components/slides/slide-edit";
import { mod } from "./fixtures";

describe("parseJourneyContent", () => {
  it("accepts everything the editor can produce", () => {
    const content = createJourneyContent();
    content.modules[0] = { ...content.modules[0], lab: createLab(), quiz: createQuiz(), slides: [createSlide("title"), createSlide("split")] };
    expect(parseJourneyContent(content)).toEqual(content);
  });

  it("rejects duplicate module ids", () => {
    expect(parseJourneyContent({ title: "J", description: "", modules: [mod("a"), mod("a")] })).toBeNull();
  });

  it("rejects malformed shapes", () => {
    expect(parseJourneyContent(null)).toBeNull();
    expect(parseJourneyContent({ title: "J", description: "", modules: [{ ...mod("a"), position: { x: "1", y: 0 } }] })).toBeNull();
    expect(parseJourneyContent({ title: "J", description: "", modules: [{ ...mod("a"), slides: [{ id: "s", layout: "bogus", title: "" }] }] })).toBeNull();
  });

  it("caps quiz passing scores at 0 to 100 whole percent", () => {
    const quiz = { ...createQuiz(), passingScore: 101 };
    expect(parseJourneyContent({ title: "J", description: "", modules: [mod("a", [], { quiz })] })).toBeNull();
  });

  it("caps labs at 100 files", () => {
    const files = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`f${i}.js`, ""]));
    const lab = { ...createLab(), files };
    expect(parseJourneyContent({ title: "J", description: "", modules: [mod("a", [], { lab })] })).toBeNull();
  });
});
