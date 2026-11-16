import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DOT_TONES, Pill, PILL_TONES, type PillTone } from "./Pill";
import { Pill as AdminPill } from "~/admin/components/console-ui";
import { HIRING_STATUS, HiringStatusPill } from "~/hiring/components/HiringStatusPill";

const TONES = Object.keys(PILL_TONES) as PillTone[];

describe("Pill", () => {
  it.each(TONES)("draws a %s dot on a neutral chip", (tone) => {
    const html = renderToStaticMarkup(<Pill dot={tone}>Label</Pill>);
    expect(html).toContain(DOT_TONES[tone]);
    expect(html).toContain("bg-os-container");
  });

  it.each(TONES)("tints the whole chip for tone %s without a dot", (tone) => {
    const html = renderToStaticMarkup(<Pill tone={tone}>Label</Pill>);
    expect(html).toContain(PILL_TONES[tone]);
    expect(html).not.toContain("h-2 w-2");
  });

  it("outline drops the fill for a hairline", () => {
    const html = renderToStaticMarkup(<Pill outline dot="success">Label</Pill>);
    expect(html).toContain("border-os-container");
    expect(html).not.toContain("bg-os-container");
  });

  it("sizes md and sm differently and adds className", () => {
    expect(renderToStaticMarkup(<Pill>x</Pill>)).toContain("px-3 py-1 text-sm");
    const sm = renderToStaticMarkup(<Pill size="sm" className="extra">x</Pill>);
    expect(sm).toContain("px-2.5 py-0.5 text-xs");
    expect(sm).toContain("extra");
  });

  it("xs keeps the 10px infra badge look and stays tinted", () => {
    const xs = renderToStaticMarkup(<Pill size="xs" tone="success">x</Pill>);
    expect(xs).toContain("px-1.5 py-0.5 text-[10px]");
    expect(xs).toContain("bg-os-green/15");
  });

  it("keeps a tinted tone tinted at size sm", () => {
    expect(renderToStaticMarkup(<Pill size="sm" tone="success">x</Pill>)).toContain("bg-os-green/15");
  });
});

describe("admin Pill", () => {
  it.each([
    ["ok", "bg-[var(--os-status-done-edge)]"],
    ["warn", "bg-[var(--os-status-review-edge)]"],
    ["bad", "bg-os-red"],
    ["idle", "bg-os-grey"],
  ] as const)("maps %s to its dot", (tone, dotClass) => {
    expect(renderToStaticMarkup(<AdminPill tone={tone}>Label</AdminPill>)).toContain(dotClass);
  });

  it("renders no dot without a tone", () => {
    expect(renderToStaticMarkup(<AdminPill>Label</AdminPill>)).not.toContain("h-2 w-2");
  });
});

describe("HiringStatusPill", () => {
  it.each(Object.entries(HIRING_STATUS))("keeps the label for %s", (status, { label, tone }) => {
    const html = renderToStaticMarkup(<HiringStatusPill status={status} />);
    expect(html).toContain(label);
    if (tone !== "neutral") expect(html).toContain(PILL_TONES[tone]);
  });

  it("shows an unknown status as its own text", () => {
    expect(renderToStaticMarkup(<HiringStatusPill status="Mystery" />)).toContain("Mystery");
  });
});
