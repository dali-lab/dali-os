import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOT_TONES } from "~/components/ui/Pill";
import { PROJECT_STATUS_TONES, StatusBadge } from "../StatusBadge";

describe("project StatusBadge", () => {
  it.each([
    ["Active", "success"],
    ["Paused", "warning"],
    ["Archived", "neutral"],
  ] as const)("shows %s as a neutral chip with a %s dot and the same label", (status, tone) => {
    expect(PROJECT_STATUS_TONES[status]).toBe(tone);
    const html = renderToStaticMarkup(<StatusBadge status={status} />);
    expect(html).toContain(DOT_TONES[tone]);
    expect(html).toContain(`>${status}</span>`);
  });
});
