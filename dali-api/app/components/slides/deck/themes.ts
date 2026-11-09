export type TextStyleId = "title" | "heading" | "body" | "kicker";

export const TEXT_STYLE_IDS: readonly TextStyleId[] = ["title", "heading", "body", "kicker"];

export const TEXT_STYLE_LABELS: Record<TextStyleId, string> = {
  title: "Title",
  heading: "Heading",
  body: "Body",
  kicker: "Kicker",
};

export interface TextStyleDef {
  /** Pixels on the 1920 by 1080 stage. */
  size: number;
  weight: number;
  leading: number;
  tracking: string;
  uppercase: boolean;
  font: "display" | "body";
  color: "fg" | "muted" | "accent";
}

export interface ThemeDef {
  id: string;
  name: string;
  colors: {
    ground: string;
    surface: string;
    fg: string;
    muted: string;
    accent: string;
    rule: string;
  };
  fonts: { display: string; body: string };
  textStyles: Record<TextStyleId, TextStyleDef>;
}

const FONTS = { display: "var(--font-os-logo)", body: "var(--font-os)" };

const TEXT_STYLES: Record<TextStyleId, TextStyleDef> = {
  title: { size: 120, weight: 700, leading: 1.05, tracking: "-0.02em", uppercase: false, font: "display", color: "fg" },
  heading: { size: 72, weight: 700, leading: 1.1, tracking: "-0.015em", uppercase: false, font: "display", color: "fg" },
  body: { size: 40, weight: 500, leading: 1.4, tracking: "0", uppercase: false, font: "body", color: "fg" },
  kicker: { size: 28, weight: 700, leading: 1.2, tracking: "0.12em", uppercase: true, font: "display", color: "accent" },
};

export const THEMES: readonly ThemeDef[] = [
  {
    id: "dali-dark",
    name: "DALI Dark",
    colors: {
      ground: "var(--color-navy-deep)",
      surface: "color-mix(in srgb, var(--color-brand-white) 8%, var(--color-navy-deep))",
      fg: "var(--color-brand-white)",
      muted: "color-mix(in srgb, var(--color-brand-white) 70%, var(--color-navy-deep))",
      accent: "var(--color-accent-coral)",
      rule: "color-mix(in srgb, var(--color-brand-white) 18%, var(--color-navy-deep))",
    },
    fonts: FONTS,
    textStyles: TEXT_STYLES,
  },
  {
    id: "dali-light",
    name: "DALI Light",
    colors: {
      ground: "var(--color-brand-white)",
      surface: "var(--color-brand-off)",
      fg: "var(--color-navy-deep)",
      muted: "color-mix(in srgb, var(--color-navy-deep) 65%, var(--color-brand-white))",
      accent: "var(--color-accent-teal)",
      rule: "var(--color-brand-gray)",
    },
    fonts: FONTS,
    textStyles: TEXT_STYLES,
  },
];

export const DEFAULT_THEME = THEMES[0];

export function themeById(id: unknown): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

const COLOR_VAR: Record<TextStyleDef["color"], string> = {
  fg: "var(--slide-fg)",
  muted: "var(--slide-muted)",
  accent: "var(--slide-accent)",
};

/** Every value a deck draws with, as `--slide-*` custom properties for the stage root. */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const vars: Record<string, string> = {
    "--slide-ground": theme.colors.ground,
    "--slide-surface": theme.colors.surface,
    "--slide-fg": theme.colors.fg,
    "--slide-muted": theme.colors.muted,
    "--slide-accent": theme.colors.accent,
    "--slide-rule": theme.colors.rule,
    "--slide-font-display": theme.fonts.display,
    "--slide-font-body": theme.fonts.body,
  };
  for (const id of TEXT_STYLE_IDS) {
    const s = theme.textStyles[id];
    vars[`--slide-${id}-size`] = `calc(${s.size} * var(--slide-u))`;
    vars[`--slide-${id}-weight`] = String(s.weight);
    vars[`--slide-${id}-leading`] = String(s.leading);
    vars[`--slide-${id}-tracking`] = s.tracking;
    vars[`--slide-${id}-transform`] = s.uppercase ? "uppercase" : "none";
    vars[`--slide-${id}-font`] = s.font === "display" ? "var(--slide-font-display)" : "var(--slide-font-body)";
    vars[`--slide-${id}-color`] = COLOR_VAR[s.color];
  }
  return vars;
}

export function textStyleCss(id: TextStyleId): Record<string, string> {
  return {
    fontSize: `var(--slide-${id}-size)`,
    fontWeight: `var(--slide-${id}-weight)`,
    lineHeight: `var(--slide-${id}-leading)`,
    letterSpacing: `var(--slide-${id}-tracking)`,
    textTransform: `var(--slide-${id}-transform)`,
    fontFamily: `var(--slide-${id}-font)`,
    color: `var(--slide-${id}-color)`,
  };
}
