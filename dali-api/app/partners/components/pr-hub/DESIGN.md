---
name: DALI Partner Relations Hub
description: A Crit Wall workspace for term planning, project mix, and relationships.
colors:
  hub-bg: "#292931"
  hub-surface: "#242429"
  hub-card: "#3b3b44"
  hub-line: "#45454e"
  hub-ink: "#f2f3f5"
  hub-muted: "#bcbcc4"
  hub-yellow: "#e4b936"
  hub-coral: "#f3978b"
  hub-teal: "#58b7b6"
  stage-rejected: "#bda1ce"
typography:
  display:
    fontFamily: 'Mulish, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: "clamp(46px, 4.7vw, 76px)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-.035em"
  headline:
    fontSize: "25px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.3
  body:
    fontSize: "15px"
    lineHeight: 1.6
  label:
    fontSize: "10px"
    fontWeight: 800
    letterSpacing: ".13em"
rounded:
  field: "6px"
  action: "7px"
  opportunity: "8px"
  panel: "10px"
  shell: "12px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  large: "20px"
  panel: "22px"
  gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.hub-yellow}"
    textColor: "{colors.hub-surface}"
    rounded: "{rounded.action}"
    padding: "12px 17px"
  button-secondary:
    textColor: "{colors.hub-ink}"
    rounded: "{rounded.action}"
    padding: "12px 17px"
  search:
    backgroundColor: "{colors.hub-surface}"
    textColor: "{colors.hub-ink}"
    rounded: "{rounded.field}"
  filter:
    backgroundColor: "{colors.hub-card}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
  filter-selected:
    backgroundColor: "{colors.hub-yellow}"
    textColor: "{colors.hub-surface}"
    rounded: "{rounded.field}"
  chart:
    backgroundColor: "{colors.hub-surface}"
    rounded: "{rounded.panel}"
    padding: "22px"
  opportunity:
    backgroundColor: "{colors.hub-card}"
    rounded: "{rounded.opportunity}"
    padding: "15px"
  term-current:
    backgroundColor: "{colors.hub-coral}"
    rounded: "{rounded.action}"
    padding: "14px"
---

# Design System: DALI Partner Relations Hub

## Overview

**Creative North Star: "Crit Wall"**

A charcoal working wall with bold white type, mustard actions, a faint square-grid hero, and coral and teal notation. The expression follows the user's supplied Crit Wall reference and keeps dense operational information legible.

This document applies only to the Partner Relations hub and its components, not the global DALI OS shell or sibling routes. It records the implementation in `partner-hub.css`, the hub route, and its components. Source inspection informed this capture; rendered desktop/mobile appearance and interactions have not been verified because browser permissions were unavailable.

**Key Characteristics:**

- Charcoal surfaces with strong white heading hierarchy.
- Yellow actions and keyboard focus; coral and teal informational accents.
- Grid-backed hero, diamond markers, compact charts, and bordered work cards.

## Colors

Warm mustard and coral balance cool teal against layered charcoal.

### Primary

- **Mustard action** (`hub-yellow`): primary planning action, active navigation/filter, focus outline, and small diamond accents.

### Secondary

- **Soft coral** (`hub-coral`): current-term bars and tiles, new-opportunity lane, rejection-in-progress border, and errors.
- **Working teal** (`hub-teal`): other term bars, accepted opportunities, and the current-term summary number.

### Tertiary

- **Muted lavender** (`stage-rejected`): rejected lane and stage marker. Domain charts cycle teal, coral, yellow, then additional categorical purple, green, and pale blue from `ProjectStats.tsx`; these are category notation, not actions.

### Neutral

- **Wall charcoal** (`hub-bg`): hub background and inset fields.
- **Deep charcoal** (`hub-surface`): chart, summary, term, and people panels.
- **Raised charcoal** (`hub-card`): opportunity cards and idle filters.
- **Graphite line** (`hub-line`): structural borders and dividers.
- **Chalk white** (`hub-ink`): primary text.
- **Soft grey** (`hub-muted`): supporting copy and metadata.

**The Action Color Rule.** Keep yellow as the hub's action and focus cue; retain text labels and counts alongside stage colors.

## Typography

Mulish is inherited through `--font-os` for the hub and its headings, with the system fallbacks specified above. Heavy headings and tightly tracked display type provide the wall's visual weight; small supporting copy keeps operational content compact.

Display is the hero title; headline is the main section heading; title is a chart heading; body describes hero copy; label is the uppercase eyebrow. Panel headings use a smaller headline size (21px), opportunity titles use 17px with 1.35 line height, and summary values use tabular numerals. Hero copy is limited to 48ch.

At widths up to 1100px, the display is 58px; at widths up to 700px it is 56px. Hero body text becomes 17px from 1600px upward and 14px at the mobile breakpoint.

## Layout

The hub is a full-width, bordered, clipped container. Its hero uses a 1.2:1 split with a 48px gap and a 40px square background grid. Desktop content has 32px side gutters. Planning leads the content: term/project charts, term ribbon, opportunity pipeline, then organizations and personal follow-ups. The primary hero action anchors the planning section.

Charts use a 1.35:1 split; people panels use equal columns. The pipeline has four lanes. At 1100px and below, pipeline lanes become two columns, charts become equal columns, and content gutters become 24px. At 700px and below, hero, charts, pipeline, and people panels stack; content gutters become 18px. At 1600px and above, main gutters expand to 44px.

Navigation and the term ribbon scroll horizontally. Term tiles have a 140px minimum width. Domain rows and people lists have their own vertical scrolling regions. Filtered pipeline cards use an auto-filling grid with a 240px preferred minimum constrained to available width.

## Elevation & Depth

Tonal separation and thin borders establish depth at rest. Opportunity cards gain a small shadow on hover (`0 5px 12px #16161c40`). Slide-over sheets carry a stronger leftward shadow and a dimmed, lightly blurred backdrop. Scoped hub rules replace their inherited navy/textured surface with deep charcoal.

State transitions use 160ms ease. Sheets enter with a 320ms transform transition and retain content through a 260ms exit lifecycle. Reduced-motion rules disable transitions and use automatic scrolling; the sheet lifecycle still retains its content during close.

## Shapes

Use softly squared rectangles: compact controls, slightly rounder opportunity cards, and larger panel/shell corners follow the frontmatter scale. The shell becomes an 8px radius on mobile. Thin strokes separate surfaces. Diamond markers are rotated squares, usually 8px with 6px variants in chart keys and domain rows. Chart bars have slightly rounded upper corners and flat baselines.

## Components

### Buttons

Primary actions are mustard with charcoal text, secondary actions use white type and a grey outline. Both have a 46px minimum height and heavy 13px labels. Primary hover brightens the fill; secondary hover adds a card surface. Keyboard focus uses a 2px yellow outline with 4px offset. Disabled buttons fade to 55% opacity and show a waiting cursor.

### Inputs / Fields

Search fields are dark, compact rounded rectangles with a leading search glyph. The shared search component also supplies its inherited coral focus ring; the hub supplies the yellow keyboard outline. Pipeline search can grow to 300px on desktop and fills available width on mobile. The loose-end composer uses a yellow border on focus-within.

### Navigation and Filters

Navigation is a horizontal text strip with muted idle labels; the current page has yellow text and an underline. Stage filters use a card fill, count, and stage diamond; selection switches to mustard fill and dark text. Expose selection through `aria-current` and `aria-pressed`.

### Cards / Containers

Summary and chart panels use deep charcoal, a thin graphite border, and compact internal spacing. Opportunities use the lighter card surface, a lane-colored hover border, a title button that opens the drawer, update metadata, and a native stage selector for authorized editors. Drag handles are an additional movement control. Pending rejection reveals a charcoal rationale popover with coral border; changing to rejection from a filtered view returns to all stages so the card remains visible.

### Term Planning

Term bars are buttons that open the term matrix, with numeric counts and explicit accessible labels. Coral marks the current term; other bars are teal. Current-term tiles use coral fill and dark text. Domain charts combine labels and counts with thin proportional bars and expose empty states when no data exists.

### Sheets and Follow-ups

Term details and opportunity details use right-side sheets. Hub overrides preserve charcoal surfaces and yellow primary footer links. Organizations and personal follow-ups sit in paired, scrollable panels below the pipeline; delete controls remain discoverable at reduced opacity and brighten on hover or focus.

## Do's and Don'ts

### Do:

- Do keep term planning and project mix first in this hub's content hierarchy.
- Do preserve the Crit Wall charcoal, bold white type, square-grid hero, and mustard actions.
- Do pair stage and chart colors with labels or counts.
- Do retain keyboard stage selection, visible focus, and reduced-motion support.

### Don't:

- Don't apply this scoped visual system to unrelated DALI OS routes without a separate decision.
- Don't let inherited navy textures or coral primary actions override the hub's sheet treatment.
- Don't describe this source capture as rendered or interaction-tested verification.

