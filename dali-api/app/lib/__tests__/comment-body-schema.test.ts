import { describe, expect, it } from "vitest";
import { bodySegmentSchema, bodySegmentsSchema } from "../comment-body-schema";

const mention = { type: "mention", userId: "u1", label: "Ada" };

describe("bodySegmentSchema", () => {
  it("accepts text and mention segments", () => {
    expect(bodySegmentSchema.safeParse({ type: "text", text: "hello" }).success).toBe(true);
    expect(bodySegmentSchema.safeParse(mention).success).toBe(true);
  });

  it("accepts text up to 5000 characters and no more", () => {
    expect(bodySegmentSchema.safeParse({ type: "text", text: "a".repeat(5000) }).success).toBe(true);
    expect(bodySegmentSchema.safeParse({ type: "text", text: "a".repeat(5001) }).success).toBe(false);
  });

  it("rejects a mention with an empty or oversized user id or an oversized label", () => {
    expect(bodySegmentSchema.safeParse({ ...mention, userId: "" }).success).toBe(false);
    expect(bodySegmentSchema.safeParse({ ...mention, userId: "u".repeat(257) }).success).toBe(false);
    expect(bodySegmentSchema.safeParse({ ...mention, label: "a".repeat(257) }).success).toBe(false);
    expect(bodySegmentSchema.safeParse({ ...mention, userId: "u".repeat(256), label: "" }).success).toBe(true);
  });

  it("rejects unknown segment types and missing fields", () => {
    expect(bodySegmentSchema.safeParse({ type: "image", url: "x" }).success).toBe(false);
    expect(bodySegmentSchema.safeParse({ type: "text" }).success).toBe(false);
    expect(bodySegmentSchema.safeParse({ type: "mention", userId: "u1" }).success).toBe(false);
    expect(bodySegmentSchema.safeParse("text").success).toBe(false);
  });
});

describe("bodySegmentsSchema", () => {
  it("accepts an empty list and up to 500 segments", () => {
    expect(bodySegmentsSchema.safeParse([]).success).toBe(true);
    expect(bodySegmentsSchema.safeParse(Array.from({ length: 500 }, () => ({ type: "text", text: "x" }))).success).toBe(true);
  });

  it("rejects more than 500 segments or any bad segment", () => {
    expect(bodySegmentsSchema.safeParse(Array.from({ length: 501 }, () => ({ type: "text", text: "x" }))).success).toBe(false);
    expect(bodySegmentsSchema.safeParse([{ type: "text", text: "ok" }, { type: "nope" }]).success).toBe(false);
    expect(bodySegmentsSchema.safeParse({ type: "text", text: "x" }).success).toBe(false);
  });
});
