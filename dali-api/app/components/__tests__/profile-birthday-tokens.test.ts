import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe.each(["app/members/components/MemberProfileView.tsx", "app/components/home/BirthdayLine.tsx"])("%s", (file) => {
  it("uses tokens instead of literal colors", () => {
    const source = readFileSync(file, "utf8");
    expect(source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull();
  });
});
