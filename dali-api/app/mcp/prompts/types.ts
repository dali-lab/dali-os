// Shared prompt envelope. MCP `prompts/list` advertises argument metadata;
// `prompts/get` returns a message array the client seeds the conversation
// with. We keep prompts as plain pure functions: `build(args) → Message[]`,
// no I/O at prompt-render time. Each prompt is a *recipe* — it instructs the
// model to call our existing MCP tools and synthesize the result.

export type PromptArgumentSpec = {
  name: string;
  description: string;
  required: boolean;
};

export type PromptMessage = {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
};

export type PromptDefinition = {
  name: string;
  description: string;
  arguments: PromptArgumentSpec[];
  build(args: Record<string, string>): PromptMessage[];
};
