# DALI OS Style Guide

The design language of the DALI OS app (`dali-api/`): rounded, blue-tinted,
roomy surfaces with big titles and one accent. This guide describes the
**dali.os design system** as it lives in code. When the guide and the code
disagree, the code wins, so update this file.

Where it lives:

| File | What it holds |
|---|---|
| `dali-api/app/app.css` | The tokens (`--color-os-*`, `--radius-os-*`, `--font-os`), the light-mode palette, and the `.os-*` component rules |
| `dali-api/app/components/os-chrome.ts` | `useOsChrome()`, the page dress as class strings, and `modalCardClass(size)` |
| `dali-api/app/components/os-page.tsx` | Hub-page parts: `OsTabBar`, `DetailRow`, `DetailEditRow`, `OS_DETAIL_CARD`, `HeroClusterLabel` |
| `dali-api/app/components/ui/floating/styles.ts` | Popover, menu, select and filter-pill dress (`OS_SURFACE_CLASS`, `OS_PANEL_CLASS`, `OS_FILTER_PILL_CLASS`) |
| `dali-api/app/components/ui/` | Shared primitives: `Button`, `IconButton`, `SearchInput`, `Checkbox`, `Radio`, `Toggle`, `DateField`, `TimeField`, `dialog`, `toast`, `floating/*` |

---

## 1. Principles

- **Rounded.** Cards and dialogs take a 24px corner, items take 12px, fields
  10px, and every button and chip is a full pill.
- **Blue.** The light palette sits on a cool ~205° axis between DALI teal and
  navy. Grounds read as paper, ink is the brand's deep navy, and there is
  **one** accent (`os-accent`). Don't bring in coral or teal to mean a second
  thing; surfaces converted from the old brand dress collapse both to
  `os-accent`.
- **Big.** Page titles are 4xl, section titles 19px, body and controls 14px.
  Surfaces are roomy (`p-6` panels).
- **Quiet chrome.** Cards carry no border and no shadow; the ground does the
  work. Only floating things (popovers, dialogs) cast a shadow.
- **Reuse, don't restyle.** Draw from `useOsChrome()` and the `.os-*` classes
  instead of hand-rolling Tailwind. One-offs drift.

---

## 2. Color

All colors are tokens. Use the Tailwind utilities (`bg-os-card`,
`text-os-grey`, `border-os-container`) or the semantic aliases the shell maps
onto them (`bg-card`, `text-foreground`, `border-border`,
`text-muted-foreground`). Never hardcode a hex in a component.

### 2.1 Surface ramp

Three visible planes: the nav is recessed below the page, and the card sits
above it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `os-nav` | `#dde5ed` | `#24242a` | Sidebar and top bar |
| `os-bg` | `#e9eef3` | `#282830` | Page ground |
| `os-card` | `#ffffff` | `#2b2b36` | Cards, menus, dialogs |
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
| `os-accent` | `#0f6e7d` | `#a8d3de` | The one accent: primary buttons, focus, active state |
| `os-accent-hover` | `#0b5964` | `#bfe1e9` | Accent hover |
| `os-green` | `#0f7a4d` | `#9fe0a8` | Success, active |
| `os-amber` | `#8f5400` | `#f2b84b` | Warning, in progress |
| `--os-danger-ink` | `#c0362f` | `#ff6b6b` | Errors, required marks, destructive |

### 2.3 Washes and overlays

- `bg-os-hover` (quiet, list rows) and `bg-os-hover-strong` (a lone control)
  flip with the mode. Don't write `hover:bg-white/5`; it vanishes in light mode.
- `--color-os-overlay` is the scrim behind a dialog or the mobile nav.
- `--color-os-shadow` tints every cast shadow.

### 2.4 Category palettes

Record types and statuses carry fill/ink/edge sets defined in `app.css`. Use
the variables, not new hues:

- Levels: `--os-epic-*`, `--os-story-*`, `--os-task-*`, `--os-sprint-*`
- Task board columns: `--os-status-{backlog,todo,progress,review,done,cancelled}-{fill,ink,edge}`
- Categorical chips (see `DomainChips`): `--os-role-{amber,teal,violet,pink,blue,green,orange,magenta,slate,cyan,red,lime,indigo,sand}-{fill,ink}`

### 2.5 Light and dark

The design honors the Appearance setting (`html.light` / `html.dark`, see
`lib/theme.ts`). The light block in `app.css` redefines every `--color-os-*`
variable, so anything built from tokens works in both modes for free. Check
every new surface in both.

---

## 3. Typography

One face across the shell: **Mulish** (`--font-os`, which the shell also maps
onto `font-sans` and `font-heading`). The only exception is the wordmark,
which uses `font-os-logo` (Plus Jakarta Sans).

| Role | Class | Size / weight |
|---|---|---|
| Page title | `chrome.pageTitle` | `text-4xl`, medium |
| Section title | `chrome.sectionTitle` | 19px, semibold |
| Modal title | `.os-modal-title` | 22px, medium |
| Panel eyebrow | `chrome.heading` | `text-xs`, semibold, uppercase, `tracking-widest`, grey |
| Section header in a dialog | `.os-section-header` | 12px, bold, uppercase |
| Field caption | `.os-field-label` | 11px, bold, uppercase, 1px tracking, grey |
| Body | `chrome.bodyText` | 14px, grey |
| Controls, buttons, menus | | 14px |

A section title and a panel eyebrow are different jobs: content pages title
their sections at 19px, settings panels label theirs with the eyebrow.

---

## 4. Shape and spacing

| Token | Value | Use |
|---|---|---|
| `rounded-os-card` | 24px | Cards, panels, dialogs |
| `rounded-os-item` | 12px | Popovers, menu panels, icon buttons, nested wells |
| `rounded-[10px]` | 10px | Form fields, item rows, the open tab |
| `rounded-full` | pill | Every button, chip, badge and filter |

Padding: panels `p-6` (`chrome.panelPad`), smaller cards `p-4`
(`chrome.cardPad`), dialogs 24px (built into `.os-modal-card`). Fields sit 20px
apart, with 8px between a caption and its field.

Elevation: cards are flat. Popovers wear `OS_SURFACE_CLASS`
(`shadow-[0_16px_40px_var(--color-os-shadow)]`); dialogs wear
`0 24px 64px var(--color-os-shadow)`.

---

## 5. Page layout

- Open with the page title (`chrome.pageTitle`) directly on the page ground.
- Use **a few deliberate cards**, not one per section and not none. Title,
  badges and long prose sit on the ground; things that are objects (a facts
  summary, a sidebar list, a table) get a `chrome.panel`. Two blocks on a page
  read well; four do not.
- A section that is not a card is `chrome.sectionShell`: a 19px title on the
  ground with its content below. Don't nest a card inside a boxed section.
- Hub pages (project detail, member profile) use `OsTabBar` under the hero,
  `HeroClusterLabel` for labelled clusters, and `OS_DETAIL_CARD` with
  `DetailRow` / `DetailEditRow` for facts.
- **Sticky sidebars:** `position: sticky` does not work at page level (the
  shell's `overflow-x-hidden` becomes the scrollport). Set
  `handle.fitViewport = true` on the route (see `app/routes/layout.tsx` and
  `app/calendar/routes/calendar.tsx`), make the page
  `flex min-h-0 flex-1 flex-col`, and let one
  `min-h-0 flex-1 md:overflow-y-auto` child scroll.

---

## 6. Components

### 6.1 Buttons

Every button is a pill in 14px type.

| Button | Class | Look |
|---|---|---|
| Primary | `.os-btn-primary` (`--sm` inline) | Accent fill, page-colored text |
| Ghost | `.os-btn-ghost` | Grey text, container fill on hover |
| Add | `.os-add-btn` (`--sm`, or `chrome.quietBtn`) | Bordered pill with a heavy plus, for "make a new one" |
| Mode toggle | `.os-edit-btn` + `aria-pressed` | Outlined pill that fills with accent when pressed |
| Page action row | `chrome.actionBtn(active)` + `chrome.actionIcon` | Borderless pill, accent tint when active |
| Icon only | `IconButton` (`ui/IconButton.tsx`) | Label becomes the tooltip and accessible name |
| Top bar | `.os-topbar-btn` | 40px container plate |

`<Button>` from `ui/Button.tsx` is restyled inside the shell
(`.dali-btn--primary`, `--secondary`, `--ghost`), so use it freely.

Secondary actions on cards and list rows ("Open", "Mark as read") are
icon-only `IconButton`s in the card's top right. Choices the user must make
(Accept / Maybe / Decline) keep visible text.

### 6.2 Forms

- Wrap the form in `chrome.formClass` (`.os-form`). It dresses native inputs,
  selects, textareas and the `Select` / `DateField` popover triggers with the
  well fill, container hairline, 10px corner and accent focus border. Fields
  then carry only sizing classes.
- `.os-form` matches inputs **by type**. Always write `type="text"`; an input
  with no type renders bare.
- Captions: `label > span:first-child` inside `.os-form` gets the caption style
  automatically. A caption inside a `<div>` must name `.os-field-label`.
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

- Card: `modalCardClass(size)`, which is `.os-modal-card` capped at 85vh and
  scrolling inside.
- Furniture: `.os-modal-title`, `.os-modal-divider`, `.os-section-header`,
  `.os-modal-footer` (right-aligned, 12px gap), `.os-icon-btn` for close and
  edit.
- Confirm, alert and prompt go through `useDialog()` / `useConfirmSubmit()`;
  feedback through `useToast()`.

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
- Record type badges: `.os-type-badge--{epic,story,task}`.

### 6.6 Lists and tabs

- Linked item rows: `.os-item-list` of `.os-item-row`.
- Page tabs: `OsTabBar`. The open tab is a filled, top-rounded plate that
  meets the rule below it, not an underline.
- Sidebar sub-tab: `.os-subtab-active` (container fill with an accent stripe).

---

## 7. Icons

`lucide-react` line icons. 16px in controls (`chrome.actionIcon`), 17px in
detail rows (`OS_DETAIL_ICON`), 14px in eyebrows (`chrome.headingIcon`). Icons
are monochrome grey (`text-os-grey`) and go to `text-foreground` on hover.

---

## 8. Motion

Keep it quiet. Color and border transitions at `0.15s ease`; pill buttons
press to `scale(0.97)`. No entrance animations on app surfaces.

---

## 9. Copy

- Short and plain. Label-first; if a control needs explaining, put it in a
  tooltip, not helper text under the label.
- **No em dashes** in UI strings. Use a period or comma instead. A bare "—" as
  an empty table cell is fine.
- Sentence case for titles and buttons. Uppercase only comes from the eyebrow
  and caption classes.

---

## 10. Accessibility

- Focus: fields show the accent border, buttons a 2px accent ring. Never
  remove focus without a replacement.
- Icon-only controls need a label (`IconButton` requires one).
- Clickable cards are real links or buttons.
- Touch targets: `touch:min-h-[40px]` on dense controls (see `actionBtn`).
- Check contrast in both modes. Tokens pass; custom colors might not.

---

## 11. Checklist for a new page

1. `const chrome = useOsChrome();`
2. Title with `chrome.pageTitle`, sections with `chrome.sectionShell` and
   `chrome.sectionTitle`.
3. Box only the objects, in `chrome.panel` with `chrome.panelPad`.
4. Forms in `chrome.formClass`, every input typed, shared field primitives.
5. Pill buttons from §6.1, icon-only secondary actions.
6. Status as a neutral `Pill` with a dot.
7. Tokens only, no hex. Check light and dark.
8. Short copy, no em dashes.
