import { describe, it, expect } from "vitest";
import routes from "~/routes";

describe("routes config", () => {
  it("does not register auth/link-member", () => {
    const serialized = JSON.stringify(routes);
    expect(serialized).not.toContain("auth/link-member");
    expect(serialized).not.toContain("auth.link-member");
  });
});
