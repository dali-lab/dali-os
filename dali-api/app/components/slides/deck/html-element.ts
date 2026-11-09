import { CODE_SANDBOX, codeSrcDoc } from "~/components/doc/components/kinds";
import { resolveThemeColor } from "~/components/slides/pptx/theme-colors";
import { themeFontsHref } from "./theme-tokens";
import { themeById, type ThemeDef } from "./themes";

export const HTML_THEME_VARS = [
  "--slide-accent",
  "--slide-fg",
  "--slide-muted",
  "--slide-surface",
  "--slide-ground",
  "--slide-rule",
  "--slide-font-display",
  "--slide-font-body",
] as const;

const FONT_STACKS: Record<string, string> = {
  "var(--font-os-logo)": '"Plus Jakarta Sans", "Mulish", ui-sans-serif, system-ui, sans-serif',
  "var(--font-os)": '"Mulish", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const FALLBACK_FONT = "system-ui, sans-serif";

/** The deck theme as plain values for a sandboxed frame, which cannot see the app's CSS variables. */
export function htmlThemeVars(theme: ThemeDef | string): Record<(typeof HTML_THEME_VARS)[number], string> {
  const def = typeof theme === "string" ? themeById(theme) : theme;
  const color = (css: string) => `#${resolveThemeColor(css) ?? "808080"}`;
  return {
    "--slide-accent": color(def.colors.accent),
    "--slide-fg": color(def.colors.fg),
    "--slide-muted": color(def.colors.muted),
    "--slide-surface": color(def.colors.surface),
    "--slide-ground": color(def.colors.ground),
    "--slide-rule": color(def.colors.rule),
    "--slide-font-display": FONT_STACKS[def.fonts.display] ?? FALLBACK_FONT,
    "--slide-font-body": FONT_STACKS[def.fonts.body] ?? FALLBACK_FONT,
  };
}

/** The document a custom HTML element runs in: the docs custom-code policy, then theme variables and a reset, then the author's source. */
export function htmlSrcDoc(source: string, theme: ThemeDef | string): string {
  const vars = Object.entries(htmlThemeVars(theme))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  const fonts = `<link rel="stylesheet" href="${themeFontsHref().replace(/&/g, "&amp;")}">`;
  const base = `${fonts}<style>:root{${vars}}html,body{margin:0;height:100%}body{color:var(--slide-fg);font-family:var(--slide-font-body)}</style>`;
  return codeSrcDoc(`${base}${source}`);
}

export const slideHasHtml = (slides: Array<{ elements: Array<{ kind: string }> }>): boolean => slides.some((s) => s.elements.some((e) => e.kind === "html"));

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** A page holding only the sandboxed frame at w by h, for drawing a custom HTML element as a picture. */
export function htmlFrameDocument(source: string, theme: ThemeDef | string, w: number, h: number): string {
  const frame = `<iframe data-html-print title="Custom HTML" sandbox="${CODE_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${escapeAttr(htmlSrcDoc(source, theme))}" style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;border:0;background:transparent"></iframe>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>${frame}</body></html>`;
}
