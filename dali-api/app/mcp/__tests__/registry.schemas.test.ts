import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import { registryToolDefs } from "../registry";

describe("MCP registered tool definitions", () => {
  it("keeps every tool name, description, scope and input schema stable", () => {
    const defs = registryToolDefs().map((d) => JSON.stringify(d, null, 2));
    expect(defs.join("\n")).toMatchSnapshot();
  });
});
