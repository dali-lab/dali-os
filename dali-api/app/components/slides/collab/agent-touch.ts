import { useEffect, useState } from "react";
import { AgentTouchTracker, AGENT_TOUCH_FADE_MS, type AgentTouch } from "~/components/collab/agent";
import { u } from "~/components/slides/deck/units";

export interface AwarenessLike {
  clientID: number;
  getStates(): Map<number, unknown>;
  on(event: "change", fn: () => void): void;
  off(event: "change", fn: () => void): void;
}

/** The deck elements agents just changed, keyed `slideId/elementId`, gone once their fade ends. */
export function useAgentTouches(awareness: AwarenessLike | null, now?: () => number): AgentTouch[] {
  const [touches, setTouches] = useState<AgentTouch[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const tracker = new AgentTouchTracker(now);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const next = tracker.nextExpiryIn();
      if (next === null) return;
      timer = setTimeout(() => {
        timer = null;
        if (tracker.sweep()) setTouches(tracker.touches());
        schedule();
      }, next);
    };
    const onChange = () => {
      if (!tracker.update(awareness.getStates(), awareness.clientID)) return;
      setTouches(tracker.touches());
      schedule();
    };
    awareness.on("change", onChange);
    onChange();
    return () => {
      awareness.off("change", onChange);
      if (timer) clearTimeout(timer);
      setTouches([]);
    };
  }, [awareness, now]);
  return touches;
}

const SAFE_ID = /^[\w-]+$/;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

const KEYFRAMES = ["a", "b"]
  .map((v) => `@keyframes dali-slide-agent-${v}{0%,40%{outline-color:var(--dali-agent)}to{outline-color:transparent}}`)
  .join("");

/** Outlines on the stage's elements an agent touched on this slide; -a/-b alternate per batch so a re-touch restarts the fade. */
export function agentTouchCss(slideId: string, touches: AgentTouch[]): string {
  const rules: string[] = [];
  const prefix = `${slideId}/`;
  for (const touch of touches) {
    if (!touch.id.startsWith(prefix)) continue;
    const id = touch.id.slice(prefix.length);
    if (!SAFE_ID.test(id) || !SAFE_COLOR.test(touch.color)) continue;
    const variant = touch.batch % 2 ? "a" : "b";
    const target = `[data-agent-stage] [data-element="${id}"],[data-agent-stage] [data-slot="${id}"]`;
    rules.push(
      `${target}{--dali-agent:${touch.color};outline:${u(4)} solid var(--dali-agent);outline-offset:${u(6)}}`,
      `@media (prefers-reduced-motion:no-preference){${target}{animation:dali-slide-agent-${variant} ${AGENT_TOUCH_FADE_MS}ms ease-out forwards}}`,
    );
  }
  return rules.length ? KEYFRAMES + rules.join("") : "";
}
