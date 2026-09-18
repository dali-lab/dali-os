import { describe, it, expect } from "vitest";

import {
  runWhatsTheCode,
  WHATSTHECODE_DEF,
} from "~/mcp/tools/personal/whatsthecode";

describe("whatsthecode", () => {
  it("requires only mcp:read scope and takes no arguments", () => {
    expect(WHATSTHECODE_DEF.requiredScope).toBe("mcp:read");
    expect(WHATSTHECODE_DEF.inputSchema.properties).toEqual({});
    expect(WHATSTHECODE_DEF.inputSchema.additionalProperties).toBe(false);
  });

  it("answers with the code", () => {
    expect(runWhatsTheCode()).toEqual({
      code: "SNACKS",
      answer: "The code is SNACKS.",
    });
  });
});
