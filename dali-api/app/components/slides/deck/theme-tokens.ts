import { THEME_TOKENS } from "~/components/slides/pptx/theme-colors";
import { TEXT_STYLE_IDS, THEMES } from "./themes";

const VAR = /var\((--color-[\w-]+)\)/g;

/** Every `--color-*` token any theme refers to, so the print CSS defines all of them and none can drift. */
export function themeTokenNames(): string[] {
  const names = new Set<string>();
  for (const theme of THEMES) for (const value of Object.values(theme.colors)) for (const m of value.matchAll(VAR)) names.add(m[1]);
  return [...names].sort();
}

/** Declarations for those tokens with the hex values the app defines, for a page that does not load app.css. */
export function themeTokenCss(): string {
  return themeTokenNames()
    .map((name) => {
      const hex = THEME_TOKENS[name];
      if (!hex) throw new Error(`No value for theme token ${name}`);
      return `${name}: #${hex};`;
    })
    .join(" ");
}

const FAMILIES = [
  { family: "Mulish", font: "body" as const, extra: [400, 700] },
  { family: "Plus Jakarta Sans", font: "display" as const, extra: [700] },
];

/** The Google Fonts stylesheet for the theme fonts at the weights the themes and bold text use, drawn with display=block. */
export function themeFontsHref(): string {
  const parts = FAMILIES.map(({ family, font, extra }) => {
    const weights = new Set<number>(extra);
    for (const theme of THEMES) for (const id of TEXT_STYLE_IDS) if (theme.textStyles[id].font === font) weights.add(theme.textStyles[id].weight);
    return `family=${family.replace(/ /g, "+")}:wght@${[...weights].sort((a, b) => a - b).join(";")}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=block`;
}
