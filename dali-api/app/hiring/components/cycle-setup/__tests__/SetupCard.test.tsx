import { describe, expect, it } from "vitest";
import * as setupCard from "../SetupCard";

describe("SetupCard", () => {
  it("does not re-export Pill; import it from ui/Pill", () => {
    expect(Object.keys(setupCard)).not.toContain("Pill");
  });
});
