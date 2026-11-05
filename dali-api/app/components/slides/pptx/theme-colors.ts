const TOKENS: Record<string, string> = {
  "--color-navy-deep": "082330",
  "--color-brand-white": "FFFFFF",
  "--color-brand-off": "F1F3F4",
  "--color-brand-gray": "C6CACC",
  "--color-accent-coral": "FF8B81",
  "--color-accent-teal": "00ADAB",
};

const FONT_NAMES: Record<string, string> = {
  "var(--font-os-logo)": "Plus Jakarta Sans",
  "var(--font-os)": "Mulish",
};

const hex = (value: string): number[] => [
  parseInt(value.slice(0, 2), 16),
  parseInt(value.slice(2, 4), 16),
  parseInt(value.slice(4, 6), 16),
];

const toHex = (rgb: number[]): string =>
  rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  parts.push(current.trim());
  return parts;
}

/** A theme color (a `var(--color-*)`, a hex, or a `color-mix` of them) as six hex digits, or null when it can't be resolved. */
export function resolveThemeColor(css: string): string | null {
  const value = css.trim();
  const direct = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (direct) return direct[1].toUpperCase();
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  if (variable) return TOKENS[variable[1]] ?? null;
  const mix = /^color-mix\((.*)\)$/.exec(value);
  if (!mix) return null;
  const [, a, b] = splitTopLevel(mix[1]);
  if (!a || !b) return null;
  const first = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(a);
  if (!first) return null;
  const from = resolveThemeColor(first[1]);
  const to = resolveThemeColor(b);
  if (!from || !to) return null;
  const weight = Number(first[2]) / 100;
  const f = hex(from);
  const t = hex(to);
  return toHex(f.map((c, i) => c * weight + t[i] * (1 - weight)));
}

export function resolveThemeFont(css: string): string {
  return FONT_NAMES[css.trim()] ?? "Arial";
}
