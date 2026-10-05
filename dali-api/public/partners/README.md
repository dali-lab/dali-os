# Partner logos

Drop logo images here. The Partner Relations hero picks them up by filename.

## Naming

Filename = lowercased org name with non-alphanumeric characters replaced by `-`,
plus any image extension the browser can render (`.svg`, `.png`, `.webp`, `.jpg`).

Examples:

- `Hypertherm` → `hypertherm.svg`
- `Dartmouth Hitchcock Medical Center` → `dartmouth-hitchcock-medical-center.svg`
- `C. Everett Koop Institute` → `c-everett-koop-institute.png`

The hero tries each extension in this order: `svg`, `png`, `webp`, `jpg`. The
first one that loads wins. If none load, the chip falls back to a neutral
lucide icon so the layout stays intact.

## Visual guidance

- Prefer SVG with a transparent background. The chip paints a subtle
  frosted-glass tile behind the mark, so logos with their own white box
  break the unified look.
- Monochrome / single-color logos read best against the charcoal hero.
- Target ~128×128 for raster uploads; the chip renders at ~56–72px.
