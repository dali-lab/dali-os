import { Aperture, Bot, MousePointer2 } from "lucide-react";
import { AGENT_COLORS, type AgentKind } from "./agent";

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="12"
          x2="12"
          y2={i % 2 ? 4.5 : 2.5}
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}

const LUCIDE = { chatgpt: Aperture, cursor: MousePointer2, other: Bot } as const;

export function AgentAvatar({ kind }: { kind: AgentKind }) {
  const Icon = kind === "claude" ? null : LUCIDE[kind];
  return (
    <span
      className="flex h-full w-full items-center justify-center rounded-full text-white"
      style={{ backgroundColor: AGENT_COLORS[kind] }}
      data-agent={kind}
    >
      {Icon ? <Icon className="h-[58%] w-[58%]" strokeWidth={2.25} aria-hidden /> : <ClaudeMark />}
    </span>
  );
}
