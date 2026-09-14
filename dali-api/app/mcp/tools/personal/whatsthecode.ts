// MCP `whatsthecode` — the DALI code. An easter egg with a real use: the code
// gets asked for constantly, so answering it from the MCP server saves the
// round trip. No DB read (the code is a constant) and no side effects.

export const DALI_CODE = "SNACKS";

export const WHATSTHECODE_DEF = {
  name: "whatsthecode",
  description:
    "Answer the question \"what's the code?\" — returns the DALI code. Use " +
    "whenever someone asks for the code, the door code, the lab code, or the " +
    "passcode to get in.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export function runWhatsTheCode() {
  return { code: DALI_CODE, answer: `The code is ${DALI_CODE}.` };
}
