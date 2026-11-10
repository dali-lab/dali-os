# DALI OS Style Guide

The design language of the DALI OS app (`dali-api/`): quiet, blue-tinted
surfaces, compact controls with soft 8px corners, and one accent per page taken
from the section you're in. This guide describes the **dali.os design system**
as it lives in code. When the guide and the code disagree, the code wins, so
update this file.

A visual version for designers is `STYLE_GUIDE.html` at the repo root (open it in a browser; it has a light/dark switch and every token in both modes). It is hand-maintained: when you change a token or a component rule here, update it there too.

Where it lives:

| File | What it holds |
|---|---|
| `dali-api/app/app.css` | The tokens (`--color-os-*`, `--radius-os-*`, `--font-os`), the light-mode palette, the accent, and the `.os-*` component rules |
| `dali-api/app/components/os-chrome.ts` | `useOsChrome()`, the page dress as class strings, and `modalCardClass(size)` |
| `dali-api/app/components/os-page.tsx` | Hub-page parts: `OsTabBar`, `DetailRow`, `DetailEditRow`, `OS_DETAIL_CARD`, `HeroClusterLabel` |
| `dali-api/app/components/ui/floating/styles.ts` | Popover, menu, select and filter-pill dress (`OS_SURFACE_CLASS`, `OS_PANEL_CLASS`, `OS_FILTER_PILL_CLASS`) |
| `dali-api/app/components/LayoutOS.tsx` | The member shell: rail, page bar, mobile top bar and drawer, and the per-page accent |
| `dali-api/app/components/shell/` | `Rail`, `PageBar` (+ `page-bar-slot.tsx`), `AreaTile`, `RailEdgeHandle`, `rail-model.ts` |
| `dali-api/app/lib/nav-areas.ts` | The nav sections and their area tones (`AREA_TONES`, `areaTint`, `areaInk`) |
| `dali-api/app/components/ui/` | Shared primitives: `Button`, `IconButton`, `SearchInput`, `Checkbox`, `Radio`, `Toggle`, `DateField`, `TimeField`, `Segmented`, `dialog`, `toast`, `floating/*` |

`app.css` states each value once. The only `html:root` rules left are the
utility patches at the end of the file (§2.3, §3); a test
(`app/__tests__/css-single-layer.test.ts`) fails if one ever shadows another
`app.css` rule again.

---

## 1. Principles

- **Soft, not round.** Cards and dialogs take a 12px corner, controls and
  fields 8px. Full pills are kept for status pills, avatars and toggles.
- **Compact.** The app sets the root to 15px, so every rem-based utility
  renders at 15/16 of its nominal size. Controls are 13px type, 32px tall.
- **One accent per page.** The accent is the tone of the page's section
  (§2.2, §2.6). A page never mixes two section tones, and status colors come
  from the status palettes, not from another section's tone.
- **Quiet chrome.** Cards carry no shadow; the ground does the work. Only
  floating things (popovers, dialogs, the mobile drawer) cast one.
- **Reuse, don't restyle.** Draw from `useOsChrome()`, the `.os-*` classes and
  the shared primitives instead of hand-rolling Tailwind. One-offs drift.

---

## 2. Color

All colors are tokens. Use the Tailwind utilities (`bg-os-card`,
`text-os-grey`, `border-os-container`) or the semantic aliases the shell maps
onto them (`bg-card`, `text-foreground`, `border-border`,
`text-muted-foreground`). Never hardcode a hex in a component.

### 2.1 Surface ramp

Three visible planes in both modes: the nav is recessed below the page. In
dark mode the card sits above the page; in light mode the page is pure white
and a card is a quiet cool step **darker** than it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `os-nav` | `#eef1f5` | `#24242a` | Rail and mobile top bar |
| `os-bg` | `#ffffff` | `#282830` | Page ground, page bar |
| `os-card` | `#f3f6f9` | `#2b2b36` | Cards, menus, dialogs |
| `os-card-hover` | `#eaf3f8` | `#323240` | Hovered card |
| `os-well` | `#eaeff5` | `#26262f` | Inputs, nested rows |
| `os-container` | `#ccd7e2` | `#3f3f48` | Hairlines, chips, active fill |
| `os-container-hi` | `#a9b9c9` | `#54545f` | Hover border |

### 2.2 Ink and accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `os-fg` | `#13293a` | `#ffffff` | Primary text (navy in light) |
| `os-grey` | `#4d5c69` | `#bababa` | Secondary text, labels, icons |
| `os-muted` | `#78899a` | `#6a6a73` | Tertiary text, placeholders |
| `os-green` | `#0f7a4d` | `#9fe0a8` | Success, active |
| `os-amber` | `#8f5400` | `#f2b84b` | Warning, in progress |
| `--os-danger-ink` | `#c0362f` | `#ff6b6b` | Errors, required marks, destructive |

**The accent has two halves**, both keyed on the page's section. `LayoutOS`
sets `--mode-accent` (the area's tint) and `--mode-accent-ink` (its ink) from
the page's own area, or from the rail's selected section on the shared pages
(calendar, email, drive). Modeless pages (home) fall back to Lab blue.

| Token | Value inside the shell | Use |
|---|---|---|
| `--color-os-accent` (`bg-os-accent`) | The area tint mixed 70% over white, in both modes | Fills: primary buttons, the pressed edit toggle, checked controls |
| `--os-accent-ink` | The area tint in dark, the area ink in light (fallback `#8fb6f2` / `#2f5fb5`) | Text, borders, focus, thin selection washes |

The fill is pastel in both modes, so a label on it is never `os-bg`: primary
buttons print a near-black warmed by the area's hue. Pages outside the shell
(the certificate page) keep the older on-white accent in light.

### 2.3 Washes, overlays and the accent utilities

- `bg-os-hover` (quiet, list rows) and `bg-os-hover-strong` (a lone control)
  flip with the mode. Don't write `hover:bg-white/5`; it vanishes in light mode.
- `--color-os-overlay` is the scrim behind a dialog or the mobile nav.
- `--color-os-shadow` tints every cast shadow.
- `text-os-accent`, `border-os-accent` (and `/30`–`/60`) and `bg-os-accent/5`
  through `/25` resolve to `--os-accent-ink`, not the pastel fill, through a
  patch at the end of `app.css`. Only plain `bg-os-accent` is the fill. New
  code that wants the ink can write `text-[var(--os-accent-ink)]` and skip the
  patch.

### 2.4 Category palettes

Record types and statuses carry fill/ink/edge sets defined in `app.css`. Use
the variables, not new hues:

- Levels: `--os-epic-*`, `--os-story-*`, `--os-task-*`, `--os-sprint-*`
- Task board columns: `--os-status-{backlog,todo,progress,review,done,cancelled}-{fill,ink,edge}`.
  Kanban headers read them through `osStatusAccent()`, which prefers the
  tinted `--os-status-*-header` / `-header-ink` set (a wash of the stage hue
  over the card, with an 8px stage dot before the title via
  `.os-board-title`). Hiring views that read the raw set keep solid bands.
- Categorical chips (see `DomainChips`): `--os-role-{amber,teal,violet,pink,blue,green,orange,magenta,slate,cyan,red,lime,indigo,sand}-{fill,ink}`

### 2.5 Light and dark

The design honors the Appearance setting (`html.light` / `html.dark`, see
`lib/theme.ts`). The light block in `app.css` redefines every `--color-os-*`
variable, so anything built from tokens works in both modes for free. Check
every new surface in both.

### 2.6 Area tones

Each nav section carries a two-half tone in `AREA_TONES`
(`app/lib/nav-areas.ts`): a pale **tint** that reads on the dark nav, and a
deep **ink** for light mode.

| Area | Tint (dark) | Ink (light) |
|---|---|---|
| Projects | `#8FB6F2` | `#2F5FB5` |
| Community | `#80D5CD` | `#0f6e7d` |
| Education | `#FFD461` | `#8F6500` |
| Hiring | `#C9B2F5` | `#6B4AC2` |
| Core | `#FF8B81` | `#C13D33` |
| Admin | `#9FB8D1` | `#46637F` |

The shell sets both halves inline (`--area-tint` / `--area-ink`) and `app.css`
resolves `--area` per mode, so anything inside the shell colors from
`var(--area)`. `AreaTile` carries its own pair (`--tile-tint` / `--tile-ink` →
`--tile`) because a tile can show any area, not just the active one.

Washes of the area tone are `color-mix` with a mode-tuned share, never a fixed
alpha: `--os-rail-pill-mix` (the active rail row, mixed from `--area-tint`:
16% dark, 55% light) and `--os-area-wash-mix` / `--os-area-wash-mix-hover`
(the section switcher, mixed from `--area`: 9%/15% dark, 7%/11% light). Never
hardcode an area hex in a component; read it through `var(--area)`,
`AreaTile`, or `areaTint()` / `areaInk()`.

---

## 3. Typography

Two faces inside the shell: **Mulish** for body and controls (`--font-os`,
mapped onto `font-sans`) and **Plus Jakarta Sans** for headings
(`--font-os-logo`, mapped onto `font-heading`, so `h1`–`h6` pick it up). The
wordmark also uses Plus Jakarta Sans.

Sizes below are rendered pixels at the 15px root.

| Role | Class | Size / weight |
|---|---|---|
| Page title | `chrome.pageTitle` | `text-2xl` (22.5px), bold, Mulish |
| Section title | `chrome.sectionTitle` | `text-base` (15px), semibold, heading face |
| Modal title | `.os-modal-title` | 20px, medium |
| Panel eyebrow | `chrome.heading` | `text-xs`, semibold, uppercase, `tracking-widest`, grey |
| Section header in a dialog | `.os-section-header` | 12px, bold, uppercase |
| Field caption | `.os-field-label` | 14px, semibold, sentence case, grey |
| Body | `chrome.bodyText` | `text-sm` (13px), grey |
| Controls, buttons, menus | | 13px (12px for `--sm`) |

A section title and a panel eyebrow are different jobs: content pages title
their sections, settings panels label theirs with the eyebrow.

Older pages write titles as literal `font-heading text-4xl`, `text-[32px]` or
`text-[19px]`. A patch at the end of `app.css` renders those as the page or
section title above; use the `chrome` strings in new code.

---

## 4. Shape and spacing

| Token | Value | Use |
|---|---|---|
| `rounded-os-card` | 12px | Cards, panels, dialogs, popovers and menus (`OS_SURFACE_CLASS`) |
| `rounded-os-item` | 8px | Nested wells, icon buttons |
| `rounded-lg` / 8px | 8px | Buttons, fields, item rows, filter pills, rail rows, page-bar buttons |
| 10px | 10px | The segmented control's track, the open `OsTabBar` tab |
| 6px | 6px | Type badges, label chips |
| `rounded-full` | pill | Status pills, avatars, toggles, count badges |

Padding: panels `p-5` (`chrome.panelPad`), smaller cards `p-4`
(`chrome.cardPad`), dialogs 20px (built into `.os-modal-card`). Fields sit 20px
apart, with 8px between a caption and its field.

Elevation: cards are flat. Popovers wear `OS_SURFACE_CLASS`
(`shadow-[0_16px_40px_var(--color-os-shadow)]`); dialogs wear
`0 24px 64px var(--color-os-shadow)`.

---

## 5. The shell

`LayoutOS` lays out every member page: the rail on the left, then a sticky
header (the desktop tab strip when tabs are on, then the page bar), then the
page.

### 5.1 Page bar

`shell/PageBar.tsx`. A single row on `os-bg` with a container hairline
below: 54px tall, 44px under the tab strip.

- **Left:** back/forward (`TablessHistoryNav`), the section's 22px `AreaTile`,
  then the breadcrumb trail. The trail ends in the page's own title, so a page
  doesn't repeat its name as a big title unless it's a hub.
- **Right:** the recording pill, then the page's own actions, presence, the
  page-doc button, the favorite star and the overflow menu (Copy link, Open in
  desktop app).
- Pages put their actions into the bar through `page-bar-slot.tsx` rather than
  a toolbar row of their own. Bar buttons use `PAGE_BAR_BUTTON` (32px square,
  `rounded-lg`, grey icon, `bg-os-hover` on hover).

### 5.2 Mobile

Below `md` the rail becomes a 56px top bar on `os-nav` (menu, wordmark,
search, bell, avatar) and a 276px drawer that slides over an `os-overlay`
scrim.

### 5.3 Page layout

- Open with the content. Hub pages (project detail, member profile) put
  `chrome.pageTitle` on the ground under the bar, then `OsTabBar`,
  `HeroClusterLabel` for labelled clusters, and `OS_DETAIL_CARD` with
  `DetailRow` / `DetailEditRow` for facts.
- Use **a few deliberate cards**, not one per section and not none. Things
  that are objects (a facts summary, a sidebar list, a table) get a
  `chrome.panel`; prose sits on the ground. Two blocks on a page read well;
  four do not.
- A section that is not a card is `chrome.sectionShell`: a title on the ground
  with its content below. Don't nest a card inside a boxed section.
- One controls row per page: tabs or segmented switch, search, filters, then
  actions. No per-column Add buttons.
- **Sticky sidebars:** `position: sticky` does not work at page level (the
  shell's `overflow-x-hidden` becomes the scrollport). Set
  `handle.fitViewport = true` on the route (see `app/routes/layout.tsx` and
  `app/calendar/routes/calendar.tsx`), make the page
  `flex min-h-0 flex-1 flex-col`, and let one
  `min-h-0 flex-1 md:overflow-y-auto` child scroll.

---

## 6. Components

### 6.1 Buttons

Buttons are 13px with an 8px corner.

| Button | Class | Look |
|---|---|---|
| Primary | `.os-btn-primary` (`--sm` inline) | Pastel accent fill, near-black label |
| Ghost | `.os-btn-ghost` | Grey text, container fill on hover |
| Add | `.os-add-btn` (`--sm`, or `chrome.quietBtn`) | Bordered, heavy plus, for "make a new one" |
| Mode toggle | `.os-edit-btn` + `aria-pressed` | Outlined; fills with the accent when pressed |
| Page action | `chrome.actionBtn(active)` + `chrome.actionIcon` | 32px, bordered, `rounded-lg`; accent ink and wash when active |
| Page lead action | `chrome.actionBtnPrimary` | `actionBtn` filled with the accent |
| Page bar | `PAGE_BAR_BUTTON` | 32px icon square, borderless |
| Icon only | `IconButton` (`ui/IconButton.tsx`) | Label becomes the tooltip and accessible name |

`<Button>` from `ui/Button.tsx` is restyled inside the shell (`.dali-btn`):
8px corner, 13px, a fixed 32px height (36px for `size="md"`), primary on the
pastel accent, secondary outlined, ghost quiet. Use it freely.

Secondary actions on cards and list rows ("Open", "Mark as read") are
icon-only `IconButton`s in the card's top right. Choices the user must make
(Accept / Maybe / Decline) keep visible text; on dense task cards they are
26px chips (`.os-cta`).

### 6.2 Forms

- Wrap the form in `chrome.formClass` (`.os-form`). Inside the shell it dresses
  native inputs, selects, textareas and the `Select` / `DateField` popover
  triggers with the well fill, container hairline, 8px corner, 13px type and
  accent focus border. Fields then carry only sizing classes.
- `.os-form` matches inputs **by type**. Always write `type="text"`; an input
  with no type renders bare.
- Captions: `label > span:first-child` and `dt` inside `.os-form` get the
  caption style automatically (14px semibold, sentence case). A caption inside
  a `<div>` must name `.os-field-label`.
- Layout with `.os-field-group` (stacked caption and field) and
  `.os-field-row` (side-by-side groups). `.os-field-hint` for help text,
  `.os-required-mark` for the asterisk.
- Outside a form: `chrome.formTrigger` for a lone Select trigger,
  `chrome.compactField` for a field in a table cell or toolbar.
- Read-then-edit records: `.os-form-readonly` shows the same form as plain
  labels and values until the pencil flips it.
- Use the shared `SearchInput`, `Select`, `Combobox`, `MultiSelect`,
  `DateField`, `TimeField`, `Checkbox`, `Radio`, `Toggle`. No native `<select>`
  or `window.confirm` in new UI.

### 6.3 Dialogs

- Card: `modalCardClass(size)`, which is `.os-modal-card` (12px corner,
  hairline, cast shadow, 20px padding) capped at 85vh and scrolling inside.
- Dialogs portal to `<body>` and still get the shell dress: `useOsShellRoot`
  puts `.os-shell` on `<html>`. Write shell rules as `.os-shell .x` so they
  reach portals too.
- Furniture: `.os-modal-title`, `.os-modal-divider`, `.os-section-header`,
  `.os-modal-footer` (right-aligned, 12px gap), `.os-icon-btn` for close and
  edit.
- Confirm, alert and prompt go through `useDialog()` / `useConfirmSubmit()`;
  feedback through `useToast()`. Never a hand-rolled `<Modal>` confirm, an
  inline "Delete → Confirm delete" button swap, or a two-click armed button.

### 6.3.1 Destructive actions

**Every action that deletes data, revokes access, or can't be undone from the
UI confirms first, with `tone: "destructive"`.** That covers deletes, removals
from a roster or group, revoking a pass/session/invite, discarding unsaved or
in-progress work, and clearing a configured binding.

  Destructive tone is also right where an action can't be walked back and the
  consequence lands outside the lab — exposing a document or project to the
  public internet, putting an agreement in force, releasing a hiring decision.
  Nothing is deleted, but the red button and the focus-on-Cancel are the point.
- Reversible state moves use the **default** tone: a status change, moving an
  item, unlink-and-relink, and archive **where an unarchive exists** (a room
  archives reversibly, so it's default; an agreement doesn't, so it's
  destructive — check before you pick).
- Removing a row from an unsaved draft (a form-builder question, a rubric
  criterion being composed) needs no confirm at all. Removing one that carries
  written content does.
- Copy: the title is a question ending in `?`, naming the thing
  (`Delete "Weekly sync"?`). `confirmLabel` is the verb alone (`Delete`,
  `Remove`, `Revoke`) — never leave it as the `Confirm` default. `description`
  says what is lost and whether it comes back.
- Catastrophic and unrecoverable (a project, a database) escalates to
  `dialog.prompt` with `tone: "destructive"` and a `validate` that requires
  typing the name.
- When the action's failure has nowhere else to land, pass `onConfirm` so the
  dialog holds open and shows the error inline.

### 6.4 Popovers and menus

`Select`, `Menu`, `ContextMenu`, `Popover` and `Combobox` already wear
`OS_PANEL_CLASS` / `OS_MENU_ITEM_CLASS`. A hand-rolled popover uses
`chrome.popover` (`OS_SURFACE_CLASS`). Page toolbar filters use
`OS_FILTER_PILL_CLASS` plus a width.

### 6.5 Status badges and chips

- Status is **one neutral pill with a colored dot**: `Pill` from
  `app/hiring/components/cycle-setup/SetupCard.tsx` with `dot={tone}`. Don't
  tint the whole chip.
- Tones: `success` (accepted, submitted, completed, open), `accent` (invited,
  scheduled, in review), `warning` (waitlisted, in progress, awaiting),
  `danger` (rejected, cancelled), `neutral` (draft, unknown).
- The filled `tone` variant is reserved for a section header's readiness pill
  ("Ready", "Locked").
- Record type badges: `.os-type-badge--{epic,story,task}` (6px corner).

### 6.6 Lists, tabs and switches

- Linked item rows: `.os-item-list` of `.os-item-row`.
- Page tabs: `OsTabBar`. The open tab is a filled, top-rounded plate that
  meets the rule below it, not an underline.
- View switches: `Segmented` (`ui/Segmented.tsx`), a 10px track with 8px
  segments and the container fill on the active one.
- `.os-subtab-active` (container fill with an accent stripe) marks the active
  item in page-doc outlines. The rail uses the sliding area pill instead (§6.7).

### 6.7 Rail

The desktop sidebar is `Rail` (`app/components/shell/Rail.tsx`) on `os-nav`
with a container hairline at its edge, tinted by the active section's area
tone (§2.6).

- **Geometry.** 264px. It is drawn on the 16px grid the design was made on:
  `.os-rail-scale` restates Tailwind's spacing, text and radius variables at
  16px so the rail doesn't shrink with the 15px root. It can be hidden
  (`⌘\`, the edge handle, or the page-bar button), which leaves the toggle in
  the page bar or tab strip.
- **Icons.** 18px lucide at `strokeWidth={1.5}`. The lighter stroke is
  deliberate and stays inside the rail; everywhere else keeps the default.
- **Rows.** 32px tall, `rounded-lg`, 14px type. Inactive rows are grey and
  wash with `bg-os-hover` on hover; active rows carry the foreground ink.
- **Quick items** (Calendar, Email, pinned pages) are icon-only until active;
  the active row's label morphs open with a 0fr↔1fr grid-track animation.
  Unread state is a 7px accent dot on the icon's top-right corner, ringed in
  `os-nav`, not a dot floating in the row.
- **Search** is a bordered card button (`os-card` fill, container hairline,
  `rounded-lg`) with the ⌘K kbd plate at its right edge.
- **Section switcher.** A card washed with the area tone
  (`color-mix(var(--area) var(--os-area-wash-mix), var(--color-os-card))`,
  hover share `--os-area-wash-mix-hover`), bordered in `var(--area)`, led by
  the section's `AreaTile`.
- **Subtabs.** One sliding pill marks the active row:
  `color-mix(var(--area-tint) var(--os-rail-pill-mix), transparent)` with a
  3px round-ended `var(--area)` stripe on its left edge, animating between
  rows at 220ms. Row icons tint to `var(--area)` when active or hovered;
  labels stay in the ink.
- **User row.** The avatar is a circle, like every avatar (§6.8).

### 6.8 Avatars

People are circles. `Avatar`, `ProfilePhotoAvatar`, the `PhotoUploadField`
preview and the rail's user row all use `rounded-full`. Never use a rounded
square for a person. Initials fallbacks keep the same circle with the tinted
fill.

---

## 7. Icons

`lucide-react` line icons. 16px in controls (`chrome.actionIcon`), 17px in
detail rows (`OS_DETAIL_ICON`), 14px in eyebrows (`chrome.headingIcon`), 18px
in the page bar. Icons are monochrome grey (`text-os-grey`) and go to
`text-foreground` on hover. The rail is the exception twice over: its icons
run 18px at `strokeWidth={1.5}` (§6.7), and its subtab icons tint to the area
tone.

---

## 8. Motion

Keep it quiet. Hover responses run at 75ms (the default transition duration);
the `.os-*` buttons and fields keep their 0.15s color and border transitions.
Buttons press to `scale(0.97)`. The rail's pill and label morph at 220ms. No
entrance animations on app surfaces.

---

## 9. Copy

- Short and plain. Label-first; if a control needs explaining, put it in a
  tooltip, not helper text under the label.
- **No em dashes** in UI strings. Use a period or comma instead. A bare "—" as
  an empty table cell is fine.
- Sentence case for titles, buttons and field captions. Uppercase only comes
  from the eyebrow and dialog section-header classes.

---

## 10. Accessibility

- Focus: fields show the accent border, buttons a 2px accent ring. Never
  remove focus without a replacement.
- Icon-only controls need a label (`IconButton` requires one).
- Clickable cards are real links or buttons.
- Touch targets: `touch:min-h-[40px]` on dense controls (see `actionBtn`).
- Check contrast in both modes, and on more than one section tone: the accent
  changes per page. Tokens pass; custom colors might not.

---

## 11. Checklist for a new page

1. `const chrome = useOsChrome();`
2. Put page actions in the page bar (`page-bar-slot.tsx`), not a toolbar of
   their own. One controls row below it, at most.
3. Box only the objects, in `chrome.panel` with `chrome.panelPad`; sections
   with `chrome.sectionShell` and `chrome.sectionTitle`.
4. Forms in `chrome.formClass`, every input typed, shared field primitives.
5. Buttons from §6.1, icon-only secondary actions.
6. Status as a neutral `Pill` with a dot.
7. Tokens only, no hex. Accent from `bg-os-accent` (fill) or
   `--os-accent-ink` (text, borders). Check light and dark, and two sections.
8. Short copy, no em dashes.
