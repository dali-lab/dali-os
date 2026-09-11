import { describe, it, expect } from "vitest";
import {
  normalizeCourseNumber,
  formatCourseTitle,
  formatCourseLocation,
} from "../class-format";

describe("normalizeCourseNumber", () => {
  it("strips leading zeros", () => {
    expect(normalizeCourseNumber("052")).toBe("52");
    expect(normalizeCourseNumber("001")).toBe("1");
    expect(normalizeCourseNumber("010")).toBe("10");
  });

  it("leaves decimals and suffixes intact", () => {
    expect(normalizeCourseNumber("32.16")).toBe("32.16");
    expect(normalizeCourseNumber("89")).toBe("89");
  });

  it("is idempotent", () => {
    expect(normalizeCourseNumber(normalizeCourseNumber("052"))).toBe("52");
  });
});

describe("formatCourseTitle", () => {
  it("joins subject, number, and title with an em dash", () => {
    expect(
      formatCourseTitle({ subject: "COSC", number: "052", title: "Full-Stack Web Development" }),
    ).toBe("COSC 52 — Full-Stack Web Development");
  });

  it("omits an empty title cleanly", () => {
    expect(formatCourseTitle({ subject: "COSC", number: "1", title: "" })).toBe("COSC 1");
  });
});

describe("formatCourseLocation", () => {
  it("joins building and room", () => {
    expect(formatCourseLocation({ building: "Kemeny Hall", room: "008" })).toBe("Kemeny Hall 008");
    expect(formatCourseLocation({ building: "Engineering & CS Center", room: "008" })).toBe(
      "Engineering & CS Center 008",
    );
  });

  it("tolerates a missing half", () => {
    expect(formatCourseLocation({ building: "Kemeny Hall", room: null })).toBe("Kemeny Hall");
    expect(formatCourseLocation({ building: "", room: "008" })).toBe("008");
    expect(formatCourseLocation({ building: null, room: null })).toBe("");
  });
});
