# Color & contrast

Targets: WCAG 2.1 AA. Body text 4.5:1, large/UI 3:1. Both light and dark modes.

## Use semantic tokens, not raw palette colors

Prefer `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-muted`,
`border-border`, `text-destructive` over Tailwind's raw palette
(`text-gray-700`, `bg-blue-50`, …). The raw palette is patched for dark mode
in `app/app.css` with `!important` overrides — that machinery is fragile and
doesn't help unsupported pairs. Semantic tokens flip cleanly.

If you must reach for a raw palette color (status surfaces, brand spots),
verify it in **both** modes before merging.

## Brand colors

`--color-accent-coral` and `--color-accent-teal` are tuned in light mode to
pass 4.5:1 against white as both foreground and as button surfaces with
`text-white`. Treat the *light* (`-light`, `-yellow`, `-pink`, `-green`)
variants as decorative-only — never use them for text or for icons that
convey state. `accent-coral-light` on a card surface is fine; pairing it
with text or an info icon is not.

## Status colors

| Use | Pair |
|---|---|
| Inline error text | `text-red-600` (not `-500`) |
| Inline warning text | `text-amber-700` (not `-600` / `-500`) |
| Success indicator | `text-green-700` (not `-500`) |
| Tertiary label / disabled hint | `text-muted-foreground` (not `text-gray-400`) |

`text-*-500` Tailwind colors are tuned for vibrancy on photo backgrounds and
generally do not pass 4.5:1 against white.

## Adding a new dark-mode override

Don't. Migrate the call site to a semantic token instead. New
`!important` overrides in `app.css` add specificity churn that the next
Tailwind upgrade can break silently.

## Regression check

`e2e/a11y-contrast.spec.ts` runs axe-core's `color-contrast` rule against
representative routes in both `light` and `dark` color schemes. Add a route
to that list when introducing a new top-level surface.
