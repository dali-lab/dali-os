import { describe, it, expect } from "vitest";
import { eventSkin } from "~/calendar/lib/event-block";
import type { EventBlock } from "~/calendar/lib/types";

function block(over: Partial<EventBlock> = {}): EventBlock {
  return { startHour: 9, duration: 1, label: "Standup", className: "bg-accent-coral-light", ...over };
}

describe("eventSkin", () => {
  it("fills an event the viewer isn't a guest on", () => {
    const skin = eventSkin(block());
    expect(skin.outlined).toBe(false);
    expect(skin.className).toBe("bg-accent-coral-light");
    expect(skin.style).toEqual({});
  });

  it("fills an answered invite with its own colour", () => {
    const skin = eventSkin(block({ bgColor: "#0B8043", unanswered: false }));
    expect(skin.outlined).toBe(false);
    expect(skin.style.backgroundColor).toBe("#0B8043");
    expect(skin.style.borderColor).toBeUndefined();
  });

  it("moves a hex colour to the border when the invite is unanswered", () => {
    const skin = eventSkin(block({ bgColor: "#0B8043", unanswered: true }));
    expect(skin.outlined).toBe(true);
    expect(skin.style).toEqual({ borderColor: "#0B8043" });
    // No fill and no coloured ink: the body wears the page surface instead.
    expect(skin.className).toContain("bg-card");
    expect(skin.className).toContain("text-foreground");
  });

  it("uses the block's border class when it has no hex colour", () => {
    const skin = eventSkin(block({ borderClassName: "border-accent-coral-light", unanswered: true }));
    expect(skin.className).toContain("border-accent-coral-light");
    expect(skin.style).toEqual({});
  });

  it("falls back to the neutral border when a hollow block names no colour", () => {
    expect(eventSkin(block({ unanswered: true })).className).toContain("border-border");
  });
});
