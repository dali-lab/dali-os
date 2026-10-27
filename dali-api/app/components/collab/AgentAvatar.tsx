import { Bot } from "lucide-react";
import { AGENT_COLORS, type AgentKind } from "./agent";

export function AgentAvatar({ kind }: { kind: AgentKind }) {
  return (
    <span
      className="flex h-full w-full items-center justify-center rounded-full text-white"
      style={{ backgroundColor: AGENT_COLORS[kind] }}
      data-agent={kind}
    >
      <Bot className="h-[58%] w-[58%]" strokeWidth={2.25} aria-hidden />
    </span>
  );
}
