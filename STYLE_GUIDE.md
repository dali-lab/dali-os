# DALI Lab — Brand & Website Style Guide

A comprehensive design reference describing the visual language, components, motion, and content patterns of the DALI Lab brand (the student-driven technology and design agency at Dartmouth College). The **Typography, Colors, Gradients, Elevation, Logos, and Icon System** sections track the *official Figma style guide* and are the source of truth. The **Layout, Motion, and Page Composition** sections describe the conventions used on the marketing website, which extend (and occasionally diverge from) the core brand spec.

---

## 1. Brand Identity at a Glance

**Personality.** Playful, modular, optimistic, hand-crafted, tech-forward but warm. The brand reads like a colorful sticker book: bold flat geometric shapes (squares, circles, pinwheels, four-pointed "sparkle" stars) cascade across sections, often overflowing their containers. Everything moves a little — entrances slide and bounce in, decorative shapes shake on hover, marquees scroll endlessly.

**Voice.** Confident, peer-to-peer, friendly. Section titles render in small caps (Open Sans). Headlines are short, often three-word stacked statements ("code, / laugh, / love").

**Core motifs.**
- Flat geometric blocks in the teal / coral / yellow primary palette, anchored by navy.
- 4-pointed "sparkle" stars and 5-petal pinwheel/flower shapes used as decorative confetti.
- Bouncing, rotating, sliding entry animations triggered when an element scrolls into view.
- Sectioned page composition with alternating white / soft / accent backgrounds, separated by overlapping graphics that bleed across the seams.

---

## 2. Typography (official)

| Role | Typeface | Weight / Style |
|---|---|---|
| **H1 Headline** | **Dosis** | Bold |
| **H2 Headline** | **Dosis** | Semi-Bold |
| **H3 Headline** | **Open Sans** | Light |
| **Body 1 / Body 2** | **Open Sans** | Regular |
| **Caption** | **Open Sans** | Regular |
| **Section Title** | **Open Sans** | Small Caps |

Both Dosis and Open Sans are available from Google Fonts. Suggested fallback stack:

```css
/* Headlines */
font-family: "Dosis", ui-sans-serif, system-ui, sans-serif;

/* Body, H3, captions, section titles */
font-family: "Open Sans", -apple-system, BlinkMacSystemFont,
             "Segoe UI", Roboto, sans-serif;
```

**Section titles** are rendered in small caps with mild letter-spacing — typical recipe:
```css
.section-title {
  font-family: "Open Sans", sans-serif;
  font-variant-caps: all-small-caps;   /* or: text-transform: uppercase + smaller size */
  letter-spacing: 0.08em;
  font-weight: 400;
}
```

### Recommended responsive scale

| Role | Mobile → Desktop |
|---|---|
| H1 | `2.25rem → 3rem → 3.75rem → 4.5rem` (36 → 72 px), Dosis Bold, tight line-height |
| H2 | `1.875rem → 2.25rem → 3rem` (30 → 48 px), Dosis Semi-Bold |
| H3 | `1.25rem → 1.5rem → 1.875rem` (20 → 30 px), Open Sans Light |
| Body 1 | `1rem → 1.125rem` (16 → 18 px), Open Sans Regular, `line-height: 1.6` |
| Body 2 | `0.875rem → 1rem` (14 → 16 px), Open Sans Regular |
| Caption | `0.75rem → 0.875rem` (12 → 14 px), Open Sans Regular |
| Section Title | `0.75rem → 0.875rem` (12 → 14 px), Open Sans small caps, `tracking-wider` |

> **Note on web implementation drift.** The current production site uses **Mulish** (body) and **Plus Jakarta Sans** (headings) instead of Open Sans / Dosis. New work should use the official Open Sans / Dosis pairing.

---

## 3. Colors (official)

### 3.1 Primary palette

| Token | Hex | Role |
|---|---|---|
| **Teal** | `#00ADAB` | Primary accent — buttons, links, brand accents |
| **Light Teal** | `#80D5CD` | Soft surfaces, secondary accents |
| **Coral / Sunrise** | `#FF8B81` | Energetic accent — CTAs, highlights |
| **Light Coral** | `#FFA991` | Hover / soft coral surfaces |
| **Yellow** | `#FFD461` | Warm accent, sparkle highlights |
| **Light Yellow** | `#FFE7A5` | Soft yellow surfaces |
| **Navy** | `#1E5779` | Headlines, dark logo, dark surfaces |

### 3.2 Neutrals (with paired elevation shadows)

Each neutral is paired with a specific drop-shadow recipe — together they form the brand's elevation system.

| Hex | Use | Shadow |
|---|---|---|
| `#FFFFFF` | Base surface (cards on light bg) | `0 2px 4px rgba(8, 35, 48, 0.25)` |
| `#F1F3F4` | Slightly recessed surface / page bg | `0 4px 6px rgba(8, 35, 48, 0.20)` |
| `#C6CACC` | Mid neutral / borders / disabled | `0 4px 8px rgba(198, 202, 204, 0.80)` |
| `#404040` | Dark surface / dark text | `0 4px 10px rgba(94, 99, 102, 0.50)` |

Implemented as CSS variables:
```css
:root {
  --color-white:   #FFFFFF;
  --color-off:     #F1F3F4;
  --color-gray:    #C6CACC;
  --color-charcoal:#404040;

  --shadow-1: 0 2px 4px  rgba(8,35,48,0.25);   /* on #FFFFFF */
  --shadow-2: 0 4px 6px  rgba(8,35,48,0.20);   /* on #F1F3F4 */
  --shadow-3: 0 4px 8px  rgba(198,202,204,0.80); /* on #C6CACC */
  --shadow-4: 0 4px 10px rgba(94,99,102,0.50);   /* on #404040 */
}
```

The shadow color `#082330` (used at 25% / 20%) is the brand's "shadow ink" — a near-black navy, not pure black. Reuse it for any custom shadow not in the table above.

### 3.3 Gradients

The Figma defines six gradient swatches. Three are **solid-to-tone** verticals on the primary accents (top = saturated, bottom = soft):

```css
--grad-teal:   linear-gradient(180deg, #00ADAB 0%, #80D5CD 100%);
--grad-yellow: linear-gradient(180deg, #FFD461 0%, #FFE7A5 100%);
--grad-coral:  linear-gradient(180deg, #FF8B81 0%, #FFA991 100%);
```

Three are **accent-to-white** soft fades used for backgrounds / hero washes:

```css
--grad-teal-fade:   linear-gradient(180deg, #80D5CD 0%, #FFFFFF 100%);
--grad-coral-fade:  linear-gradient(180deg, #FFA991 0%, #FFFFFF 100%);
--grad-sunset:      linear-gradient(180deg, #FFA991 0%, #80D5CD 100%); /* coral → teal */
```

Plus a navy bar gradient for accents / dividers:
```css
--grad-navy: linear-gradient(180deg, #1E5779 0%, #082330 100%);
```

Use solid gradients for sticker shapes; use fade gradients for full-section backgrounds; use the navy gradient sparingly for thin accent bars.

### 3.4 Extended palette (website-only)

The implemented site uses additional hues for SVG illustrations (greens, magentas, pinks). These are **not** in the official brand spec but are accepted on the website where the sticker-illustrations need more variety. Treat them as illustration-only accents, never as brand primaries.

| Hex | Where used |
|---|---|
| `#A2D483`, `#509C81`, `#B8D17C` | Greens — block shapes in About / Education / Partners illustrations |
| `#CA60AC`, `#E68FBE`, `#E8A5B8` | Magenta / pink — sparkles and circle accents |
| `#F9C679`, `#FAC27D` | Warm orange — secondary circle accents |
| `#D4EDFF`, `#EDF4FC` | Sky-blue section backgrounds (light-mode bands) |

If you are extending the palette for a new sticker composition, prefer pulling new hues from the *same hue family* as one of the official primaries and reserve high saturation for the canonical primaries.

### 3.5 Light & dark mode

- Light mode is canonical: white page, soft surfaces in `#F1F3F4`, navy headlines, accent CTAs.
- Dark mode (web-only convention): page background deep navy (≈`hsl(210 50% 12%)`), cards a lighter navy (≈`hsl(210 45% 18%)`), text white. The brand primaries (teal, coral, yellow) stay vivid; navy effectively inverts to white text. Mode is driven by `prefers-color-scheme` — no manual toggle.
- Always pair light & dark colors when authoring components.

---

## 4. Logos

### 4.1 Mark

The DALI mark is a custom display wordmark of the letters **D · A · L · I** drawn in a tall, geometric, slightly condensed serif/display face (the **A** has a flat apex; the **I** is a straight vertical with no serifs). Beneath the wordmark, the letters **L · A · B** are spaced wide and centered.

The wordmark sits inside a **single continuous swash**: one fine-weight curl spirals up from the lower-left, sweeps horizontally **under** the entire wordmark forming a long, smile-shaped underbow, then mirrors with a second spiral curl on the lower-right. The "L · A · B" letters sit *on top of* this swash, with the swash passing between them. The whole composition is bilaterally symmetric.

Treat the wordmark as a single atomic asset. Never re-type "DALI" in another font as a substitute; never separate the swash from the wordmark; never recolor the swash to a different value from the letters within a single lockup.

### 4.2 Wordmark lockups

| Lockup | Composition | Use | Asset |
|---|---|---|---|
| **Logo Blue** (primary) | Navy `#1E5779` wordmark + swash, transparent background | Default lockup on white / light surfaces | `/assets/logos/logo-blue.png` |
| **Logo White** | All-white wordmark + swash, transparent background | On dark / navy / photo backgrounds | `/assets/logos/logo-white.png` |
| **Logo Attribution** | "BUILT IN COLLABORATION WITH THE" (Dosis, all caps, navy, letter-spaced) stacked above the navy wordmark | **Required** on third-party / partner surfaces crediting DALI | `/assets/logos/logo-attribution.png` |

**Clear-space.** Maintain padding equal to the cap-height of the "L·A·B" subline on all four sides. The swash counts as part of the mark — do not crop into the spirals.

**Minimum size.** Wordmark should never appear narrower than **120 px** on screen (or ~1 in / 25 mm in print). Below that, switch to the icon mark.

**Don'ts.** Don't recolor the wordmark to non-brand hexes; don't rotate, skew, or outline it; don't drop-shadow the wordmark itself (the Standard White *icon* has a soft shadow on its circle, but the bare wordmark stays flat); don't place the navy wordmark on saturated brand colors (coral, teal, yellow) — use the white wordmark there.

### 4.3 Icon system

The brand also ships an **icon mark** — the wordmark contained inside a perfect circle. Six official variants split into two tiers:

**Everyday icons** (use freely):

| Variant | Circle fill | Wordmark color | Asset |
|---|---|---|---|
| **Icon Blue** (default) | Solid navy `#1E5779` | White | `/assets/logos/icon-blue.png` |
| **Icon White** | White, with brand drop-shadow `--shadow-1` | Navy `#1E5779` | `/assets/logos/icon-white.png` |
| **Icon Night** | Vertical gradient navy (`#1E5779` top → `#082330` bottom) | White | `/assets/logos/icon-night.png` |

**Limited icons** (special/seasonal use — events, social campaigns, partner spotlights — not the default brand voice):

| Variant | Circle fill (gradient, top → bottom) | Wordmark color | Asset |
|---|---|---|---|
| **Icon Teal** | `#80D5CD` → `#00ADAB` | White | `/assets/logos/icon-limited-teal.png` |
| **Icon Sunrise** | `#FFA991` → `#FF8B81` | White | `/assets/logos/icon-limited-sunrise.png` |
| **Icon Yellow** | `#FFE7A5` → `#FFD461` | White | `/assets/logos/icon-limited-yellow.png` |

The original Figma filenames distinguish tiers (`DALI Icon_*` for everyday, `DALI Limited_*` for themed). Default to **Icon Blue** for favicons, app icons, social avatars, and small footprint placements (≤ 64 px). Pull from the Limited set only for themed contexts.

For headers and page-scale lockups, prefer the horizontal wordmark over the icon.

---

## 5. Iconography & Decorative Shapes

### 5.1 The "DALI sticker" vocabulary

A small alphabet of flat geometric shapes appears across every page as decorative confetti. They are always **inline SVG** so they can be motion-animated and recolored. Common shapes:

- **Square / rectangle** — flat, often nested.
- **Circle / ellipse** — sometimes concentric ring patterns ("target").
- **4-pointed sparkle star** — used as larger corner accent.
- **5-petal pinwheel / flower** — quasi-curved mask. Used as smaller corner accent.
- **Globe / latitudes pattern** — for "partners / global" illustrations.
- **Code/IDE-window stack** — for "engineering / hands-on" illustrations.

Each shape is rendered in a brand hex (§3) and typically composed as 4–10 shapes per illustration, animated independently.

### 5.2 Composition rules

- 3–6 shapes per illustration block; one large anchor square + 1–2 mid circles + 2–3 small confetti pieces.
- Mix one brand primary (teal / coral / yellow) + one light variant + one dark dot (navy or `#082330`).
- Let shapes overflow the illustration's viewBox / container — they should look like they were "dropped in" rather than centered.
- Animate each shape in independently with staggered delays.

### 5.3 UI icons

Use a clean line-icon set (e.g. `lucide-react` or similar). Reserve line icons for *utility* (hamburger, close X, chevrons, video controls). Brand illustrations should always be hand-built inline SVGs, never icon-font glyphs.

---

## 6. Elevation

Pair each surface with the shadow defined in §3.2. Quick reference:

| Surface | Background | Shadow | Typical use |
|---|---|---|---|
| Level 1 | `#FFFFFF` | `--shadow-1` | Default card on a colored page |
| Level 2 | `#F1F3F4` | `--shadow-2` | Slightly recessed card, soft modals |
| Level 3 | `#C6CACC` | `--shadow-3` | Mid-emphasis surface, disabled card |
| Level 4 | `#404040` | `--shadow-4` | Dark callout, dark-mode card |

Border radius across surfaces is consistent: small `4 px`, default `8 px`, large `16 px`, pill `9999 px`.

---

## 7. Layout System

### 7.1 Page shell

```
[ page root: full-height, page background, horizontal overflow clipped ]
  ├── Navbar (fixed, auto-hide on scroll-down)
  ├── one or more <section> blocks
  └── Footer (dark slab)
```

`overflow-x-clip` on the page root is critical because decorative SVGs intentionally overflow horizontally on each section (sections themselves use `overflow-visible`).

### 7.2 Section recipe

```
section
  width: 100%
  background: alternating (white / soft / accent / dark)
  horizontal padding: 16 → 24 → 32 → 48 px (responsive)
  vertical padding:   32 → 40 → 48 → 64 → 80 px (responsive)
  position: relative; overflow: visible

  └── inner wrapper
        max-width: 1152px (text-heavy) or 1280px (graphic-heavy)
        centered, grid-cols-1 → md:grid-cols-2
        gap: 24 → 32 → 40 → 48 px
        items: center
```

Alternate backgrounds across a page: `white` → `#F1F3F4` (or `--grad-teal-fade`) → an accent overlay band → repeat. Section seams are intentionally bridged by decorative SVGs that bleed via negative margins.

### 7.3 Breakpoints

Standard responsive scale: `sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1400`. Container is centered with `2rem` padding, capped at `1400 px`.

Mobile order swap is common: text/graphic columns reverse on small screens (`order-1` / `order-2 md:order-1`) so graphics sit above text on mobile, beside it on desktop.

### 7.4 Navbar

- Fixed top, full-width, high z-index.
- Light mode: white background, teal (`#00ADAB`) links. Dark mode: navy background, white links.
- Logo (horizontal **Standard Blue** lockup) on the far left, height ≈ 48 px.
- Active link: coral `#FF8B81`, semibold. Hover: shift toward coral.
- **Auto-hide on scroll-down, reveal on scroll-up** (transform `translateY(0)` ↔ `translateY(-100%)`, 300 ms ease-in-out). Threshold: only hide once user has scrolled past ~80 px.
- Mobile: hamburger toggle, full-width dropdown menu below the bar; menu closes on route change.

### 7.5 Footer

Dark slab (`background: #111827` / text white), two columns on desktop:

- **Left:** street address, contact email (`hover:underline`), and social links (LinkedIn / Instagram / Facebook / Twitter), indented ~64 px on ≥sm. Social links: `hover:color: #00ADAB`.
- **Right (hidden on mobile):** decorative block-illustration PNG, max width ~350 px, `pointer-events-none`.

Padding `py-8 sm:py-10 md:py-12 px-4 sm:px-6 md:px-8`.

---

## 8. Components

### 8.1 Buttons / CTAs

**Pill CTA — Primary (Sunrise).**
```
padding: 16px 32px
border-radius: 9999px
font: Open Sans, 600
background: #FF8B81
color: #FFFFFF
box-shadow: var(--shadow-1)
:hover { background: #FFA991; box-shadow: var(--shadow-2); }
transition: all 200ms;
```

**Pill CTA — Teal variant.** Same recipe with `background: #00ADAB` and hover `#80D5CD`.

**Pill CTA — Outline.**
```
padding: 16px 32px
border-radius: 9999px
font: Open Sans, 600
border: 2px solid #1E5779
color: #1E5779
background: transparent
:hover { background: #1E5779; color: #FFFFFF; }
```

**Icon button.** Circular, `background: rgba(255,255,255,0.9)`, `backdrop-filter: blur(8px)`, `border-radius: 9999px`.

**Tag / badge.** Small, rounded full, uppercase Open Sans small-caps; rotate through teal / light teal / coral / light coral / yellow / light yellow so adjacent tags differ.

### 8.2 Cards

**Content card.**
```
background: #FFFFFF
border-radius: 12px
box-shadow: var(--shadow-1)
overflow: hidden
:hover { box-shadow: var(--shadow-2); }
  – image area uses object-cover and group-hover:scale-105 over 300 ms
```

**Person / profile card.** Square photo on top, name in Dosis Semi-Bold, role badges below in role-coded brand colors, year/term badges in `#C6CACC`.

**Role / expertise card.** `border-radius: 24px`, large padding, a 4-px top "stripe" in the brand color owning that role (coral / teal / yellow / navy). Hover: `transform: translateY(-8px)` over 500 ms.

**Stat card.** Lives inside an accent band — no card chrome, just centered columns with a giant Dosis Bold number and a small Open Sans Regular label below.

### 8.3 Forms & inputs

Inputs use the neutral system: `background: #F1F3F4`, `border: 1px solid #C6CACC`, `border-radius: 8px`, focus ring in teal `#00ADAB`. Keep them understated — DALI is not a form-heavy brand.

### 8.4 Toaster / notifications

Small floating toast anchored to a screen corner. Inherit brand radius (`8 px`) and shadow scale (`--shadow-2`).

---

## 9. Motion & Interaction

### 9.1 Signature easing

The brand uses **one cubic-bezier almost everywhere**:

```
cubic-bezier(0.25, 0.46, 0.45, 0.94)        // smooth ease-out feel
```

For "spring-bounce" entrances (boxes dropping into place):
```
cubic-bezier(0.34, 1.56, 0.64, 1)           // slight overshoot
```

Default duration `0.6 s`; longer hero / page transitions `0.8 s – 1.2 s`; micro-interactions `120 – 200 ms`.

### 9.2 Entry patterns

All scroll-revealed SVG fragments use scroll-triggered motion components configured to re-fire when the section re-enters view (`once: false`, `amount: 0.3`).

| Pattern | initial → animate | When |
|---|---|---|
| Slide from left | `{ x: -200, opacity: 0 }` → `{ x: 0, opacity: 1 }` | Left-side illustrations |
| Slide from right | `{ x:  200, opacity: 0 }` → `{ x: 0, opacity: 1 }` | Right-side illustrations |
| Fly in + rotate | `{ x: 200, y: 150, rotate: 180, opacity: 0 }` → `{ x:0, y:0, rotate:0, opacity:1 }` | Corner sparkle stars / pinwheels |
| Pop / scale | `{ scale: 0, opacity: 0 }` → `{ scale: 1, opacity: 1 }` | Badges, small chips |
| Fall-in bounce | CSS keyframe `translateY(-100px) → bounce → settle` | Hero boxes |

Stagger by giving each child a `delay` ramped in 0.1 s increments (`0`, `0.1`, `0.2`, …).

### 9.3 Ambient / loop animations

```css
@keyframes dali-shake {
  0%   { transform: translate3d(0,0,0) rotate(0); }
  30%  { transform: translate3d(-1px, 0, 0) rotate(-1.5deg); }
  60%  { transform: translate3d(1.5px, 0, 0) rotate(1.5deg); }
  100% { transform: translate3d(0,0,0) rotate(0); }
}

@keyframes fallIn {
  0%   { opacity: 0; transform: translateY(-100px) scale(0.8); }
  60%  {              transform: translateY(10px)  scale(1.05); }
  80%  {              transform: translateY(-5px)  scale(0.98); }
  100% { opacity: 1; transform: translateY(0)     scale(1); }
}

@keyframes marquee-left {
  0%   { transform: translateX(0); }
  100% { transform: translateX(calc(-100% - 1rem)); }
}
```

Always wrap motion in a reduced-motion guard:
```css
@media (prefers-reduced-motion: reduce) {
  .shake-on-hover, .shake-on-hover:hover, .shake-on-hover:focus-visible {
    animation: none !important;
    transition: none !important;
  }
}
```

### 9.4 Page-level interactions

- **Landing → next-page scroll-jack.** On the splash route, the first wheel-down or 50-px upward touch-swipe routes to the next page with a `fromScroll` flag. The receiving page locks `body { overflow: hidden }`, starts content at `translateY(100vh)` and slides it to `0` over `0.8 s cubic-bezier(0.33, 0, 0.2, 1)`, then unlocks scroll (~1 s total).
- **Hero overlay reveal.** A white gradient overlays the hero video for ~15 s, then slides off-screen (`translateX(-100%)`, 1800 ms). Re-hovering the left edge slides it back.
- **Navbar auto-hide** (see §7.4).
- **Marquee drag.** Photo / logo marquees are click-and-drag scrubbable; release resumes the auto-scroll after ~2 s (touch) or instantly (mouse leave).
- **Video player.** Custom controls float bottom-center inside videos, `background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); border-radius: 9999px;`, with a coral progress bar and a white draggable thumb that scales on hover.

### 9.5 Hover affordances

- Links: color shift to coral `#FF8B81` (or teal `#00ADAB` in secondary contexts).
- Cards: shadow promotes one level + image `scale(1.05)` + dark gradient veil fade-in.
- Role cards: `translateY(-8px)` lift over 500 ms.
- Stickers / chips: `.shake-on-hover` micro-shake (160 ms).

---

## 10. Imagery & Assets

### 10.1 Asset categories

Organize assets by page / section:

- **`logos/`** — wordmark in Standard Blue, Standard White, Attribution Mark; icon mark in 6 color variants. SVG preferred.
- **`landingpage/`** — splash hero illustration, footer illustration, mission/edu/partners thumbnails, decorative squiggles, hero video poster.
- **`about/`** — photo collage stills (JPG + WebP), code-window illustration, "glance" graphics.
- **`team/`** — group photos by role (designers, engineers, PMs), lab photo.
- **`projects/`** — per-project cover images, decorative project-blocks SVG.
- **`education/`** — testimonial portraits, program card backgrounds, hero illustration.
- **`sponsors/` or `partners/`** — partner logos in monochrome-equivalent weight.
- **`<event-name>/`** — event-specific brand assets (often co-branded with Dartmouth schools).

### 10.2 Asset rules

- **Provide WebP + JPG** for photos using `<picture>` with `<source srcSet="*.webp" type="image/webp">` and an `<img src="*.jpg">` fallback.
- **SVG for illustrations and logos**; inline if it needs to be animated.
- **MP4 for video**, with a poster JPG alongside.
- Large hero loops belong on a CDN, not in-repo.
- Photo collages: 5-column grid on desktop, 2–3 columns on mobile, all `object-cover`, often with an 80% coral overlay for stat bands.
- Logo lockups: pair **Standard Blue** with white/light backgrounds, **Standard White** with dark/navy backgrounds, and the **Attribution Mark** with partner / sponsor surfaces only.

---

## 11. Page Composition Patterns

A typical marketing page strings these blocks in order:

1. **Hero band** (full-viewport or `h-screen`). Either: (a) full-bleed video / photo with a soft gradient on the left holding a 2–3 line color-stacked headline, or (b) split layout with a 1/4 text column and 3/4 photo/video column. Decorative blocks overlap the seams.
2. **"WHO WE ARE" intro band** — soft surface (`#F1F3F4` or `--grad-teal-fade`), two-column (text left, illustration right) on desktop, stacked on mobile. Open Sans small-caps section title sits above the Dosis heading.
3. **"AT A GLANCE" stat band** — full-width coral overlay (`#FF8B81` at 80%) on a 5-cell photo collage, three big Dosis Bold numbers (e.g. years / projects / students), sparkle stars and pinwheels in opposite corners flying in from the diagonal.
4. **Feature trio** — three alternating-side sections (image-left / image-right / image-left). Each illustration is a hand-composed SVG of squares + circles + sparkles, animated one element at a time.
5. **Marquee strip** — horizontally scrolling photo or keyword strip; click-and-drag scrubbable.
6. **CTA band / callout** — coral or teal solid color, large Dosis heading, one or two pill buttons.
7. **Footer** (§7.5).

Hold this rhythm when adding new pages. Re-mix order, but keep the alternating-background discipline and the decorative overflow between sections.

---

## 12. Accessibility & Quality Bar

- **Reduced motion:** wrap every long animation in `prefers-reduced-motion: reduce` overrides.
- **Focus styles:** interactive elements get a visible `:focus-visible` outline in teal `#00ADAB` (or white `rgba(255,255,255,0.5)` on dark surfaces), `outline-offset: 2px`.
- **Color contrast:** Body text on white uses navy `#1E5779` (passes AA). Body on coral uses white. Never put body text directly on light yellow `#FFE7A5` — reserve yellow for decorative blocks and large headings only.
- **Alt text:** decorative SVGs get `alt=""` / `aria-hidden`; informative photos get descriptive alt; numeric stats use `aria-label="N years"` so screen readers always read a real number.
- **Keyboard:** all card-shaped clickable areas must be real links/buttons, not divs with onClick.
- **Dark mode:** every color decision must include a dark counterpart. The dark palette is muted but not black — preserve color identity. The brand primaries (teal, coral, yellow) remain vivid; navy effectively inverts to white text.
- **Touch:** mirror any wheel-based interaction (scroll-jack, scrubbable marquee) with a touch-swipe equivalent (≥ 50 px threshold).

---

## 13. Quick-start checklist for a new "DALI-brand" page

1. Wrap in a page shell: full-height, page background, `overflow-x-clip`; render Navbar + sections + Footer.
2. Load **Dosis** and **Open Sans** from Google Fonts. Set body to Open Sans Regular; all headings to Dosis (Bold for H1, Semi-Bold for H2). H3 is Open Sans Light.
3. Open with a hero — either full-bleed media with a corner color-stacked H1 (color words pulled from teal / coral / yellow), or a split 1/4 + 3/4 layout. Drop at least one decorative block cluster in a corner so something bleeds across the section seam.
4. Use the section recipe (§7.2). Alternate `#FFFFFF` ↔ `#F1F3F4` (or a soft brand gradient).
5. Every illustrative SVG should use the official brand hexes from §3.1 (extended palette from §3.4 only when the composition demands more variety). Animate child shapes with scroll-triggered motion, staggered by 0.1 s, easing `cubic-bezier(0.25, 0.46, 0.45, 0.94)`, duration `0.6 s`.
6. Include an Open Sans small-caps section title above each H2.
7. Headings: Dosis, bold/semibold, navy `#1E5779` on light bg (or color-stacked for hero).
8. Body: Open Sans Regular, `1rem → 1.125rem`, line-height ~1.6, navy `#1E5779` on light bg, white on dark.
9. CTAs: pill, **Sunrise (coral `#FF8B81`)** primary, **navy outline** secondary; promote shadow one elevation level on hover.
10. Cards: `border-radius: 12px` (or `24px` for role cards), one of the four neutral surfaces (§3.2) paired with its matching shadow, hover lift + image scale.
11. Always provide dark-mode variants and respect `prefers-reduced-motion`.
12. Logos: use **Standard Blue** on white, **Standard White** on dark, **Attribution Mark** on partner pages only. Use the circular icon mark for ≤ 64 px contexts.

Match this rhythm and the page will feel like part of the DALI brand family.

