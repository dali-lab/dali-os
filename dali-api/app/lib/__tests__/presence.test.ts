import { describe, it, expect } from "vitest";
import { formatLastActive, derivePresenceState } from "../presence";

const NOW = new Date("2026-08-03T12:00:00Z");
const ms = (n: number) => new Date(NOW.getTime() - n);

describe("formatLastActive", () => {
  it("returns null for null input", () => {
    expect(formatLastActive(null, NOW)).toBeNull();
  });

  it("returns 'Active now' for < 60s ago", () => {
    expect(formatLastActive(ms(30_000), NOW)).toBe("Active now");
    expect(formatLastActive(ms(59_999), NOW)).toBe("Active now");
  });

  it("returns singular '1 minute ago'", () => {
    expect(formatLastActive(ms(60_000), NOW)).toBe("Active 1 minute ago");
    expect(formatLastActive(ms(119_999), NOW)).toBe("Active 1 minute ago");
  });

  it("returns plural minutes", () => {
    expect(formatLastActive(ms(2 * 60_000), NOW)).toBe("Active 2 minutes ago");
    expect(formatLastActive(ms(59 * 60_000 - 1), NOW)).toBe("Active 58 minutes ago");
  });

  it("returns singular '1 hour ago'", () => {
    expect(formatLastActive(ms(60 * 60_000), NOW)).toBe("Active 1 hour ago");
    expect(formatLastActive(ms(2 * 60 * 60_000 - 1), NOW)).toBe("Active 1 hour ago");
  });

  it("returns plural hours", () => {
    expect(formatLastActive(ms(3 * 60 * 60_000), NOW)).toBe("Active 3 hours ago");
  });

  it("returns singular '1 day ago'", () => {
    expect(formatLastActive(ms(24 * 60 * 60_000), NOW)).toBe("Active 1 day ago");
    expect(formatLastActive(ms(48 * 60 * 60_000 - 1), NOW)).toBe("Active 1 day ago");
  });

  it("returns plural days", () => {
    expect(formatLastActive(ms(3 * 24 * 60 * 60_000), NOW)).toBe("Active 3 days ago");
  });
});

describe("derivePresenceState", () => {
  it("returns away for null lastActiveAt", () => {
    expect(derivePresenceState(null, NOW)).toBe("away");
  });

  it("returns away when hideActivity is true even if recently active", () => {
    expect(derivePresenceState(ms(10_000), NOW, true)).toBe("away");
  });

  it("returns active for < 5 minutes", () => {
    expect(derivePresenceState(ms(4 * 60_000 + 59_999), NOW)).toBe("active");
  });

  it("returns recent for 5–60 minutes", () => {
    expect(derivePresenceState(ms(5 * 60_000), NOW)).toBe("recent");
    expect(derivePresenceState(ms(59 * 60_000 + 59_999), NOW)).toBe("recent");
  });

  it("returns away for >= 60 minutes", () => {
    expect(derivePresenceState(ms(60 * 60_000), NOW)).toBe("away");
  });
});
