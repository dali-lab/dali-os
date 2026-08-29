import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";

// The dali.os page dress, in one place. Every page under the `os-redesign`
// flag draws from the same handful of shapes — a card, a panel, a popover, an
// eyebrow heading, a pill action, a dressed form — and each value's non-os
// branch is exactly what the brand shell already had, so a page can adopt this
// without changing at all for unflagged viewers.

/**
 * The shapes that repeat down every panel of a page, in whichever shell it
 * is rendering in. Under dali.os they follow that design — flat cards with no
 * border or shadow, eyebrow panel labels, pill controls, no 6px corners — and
 * otherwise stay exactly the bordered, shadowed chrome the brand shell has
 * today. Read from one place because a single page's settings rail can repeat
 * them four times over.
 *
 * `card` and `panel` land on the same os surface and differ only off it, where
 * small cards and big sections took different corners.
 */
/**
 * A dialog's card. `.os-modal-card` carries the design's 24px corner, hairline
 * and cast shadow (and its own 24px padding, which is why the os branch sets
 * none); the brand shell keeps its rounded-2xl card. Pass the size — every
 * dialog picks its own — and nothing else.
 */
export function modalCardClass(os: boolean, size?: string) {
  return cn(
    os ? "os-modal-card" : "bg-card rounded-2xl shadow-brand-2 p-5 sm:p-6",
    // Cap the card to the viewport and let it scroll inside: a tall dialog (a
    // long edit form) was overflowing the centered overlay so its lower fields
    // and Save button were unreachable. The Select menus portal out, so an
    // overflow here doesn't clip their dropdowns.
    "w-full my-auto max-h-[85vh] overflow-y-auto",
    size,
  );
}

export function useOsChrome() {
  const os = useFeatureFlag("os-redesign");
  return {
    os,
    /** A panel surface: a settings card, an inline form, a section header. */
    card: os
      ? "rounded-os-card bg-os-card"
      : "bg-card border border-border shadow-brand-1 rounded-md",
    /** A page's large surfaces — a full-width table, a grid, a long form. */
    panel: os
      ? "rounded-os-card bg-os-card"
      : "bg-card border border-border shadow-brand-1 rounded-lg",
    /** A hand-rolled popover: the dress the floating primitives wear. */
    popover: os ? OS_SURFACE_CLASS : "rounded-lg border border-border bg-card shadow-xl",
    /** The page's own title. Every os page opens at the same size and weight. */
    pageTitle: os
      ? "font-heading text-4xl font-medium text-foreground"
      : "font-heading text-2xl font-bold text-foreground",
    /** A panel's heading. The os design labels its panels with an eyebrow. */
    heading: os
      ? "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-os-grey"
      : "inline-flex items-center gap-2 font-heading font-semibold text-foreground",
    /** The glyph in that heading — coral is the brand shell's accent, and the
     *  os design keeps its panel labels monochrome. */
    headingIcon: os ? "w-3.5 h-3.5 text-os-grey" : "w-4 h-4 text-accent-coral",
    /** The quiet action beside a heading ("Add Block", "Add Google Account"). */
    quietBtn: os
      ? "os-add-btn os-add-btn--sm"
      : "inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors",
    /** Wraps a form so its inputs and textareas take the design's field dress
     *  (`.os-form` in app.css: a well fill, 10px corner, accent focus ring).
     *  One class instead of an os variant on every input on the page. */
    formClass: os ? "os-form" : "",
    /** A Select/menu trigger inside such a form. `.os-form` reaches inputs and
     *  textareas; a trigger is a button, so it copies that dress here. */
    formTrigger: os
      ? "w-full rounded-[10px] border bg-os-well px-3.5 py-2.5 text-sm text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
      : "w-full px-3 py-2 text-sm border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40",
    /** The same dress for a field that has to keep its tight metrics — a
     *  pinned toolbar row or a table cell, where `.os-form`'s roomier padding
     *  would break the alignment. Pair it with a border colour at the call
     *  site; it sets none, so an error state can't lose a specificity race. */
    compactField: os
      ? "rounded-[10px] bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent"
      : "rounded-md bg-background text-foreground",
    /** A stacked field label. The os design sets its forms in 14px, not 12px. */
    fieldLabel: os
      ? "text-sm text-os-grey flex flex-col gap-1.5"
      : "text-xs text-muted-foreground flex flex-col gap-1",
    /** Corners for a nested well that isn't a field (a picker's result list). */
    fieldRadius: os ? "rounded-os-item" : "rounded-md",
    /** Explanatory copy under a heading. The design sets its body at 14px. */
    bodyText: os ? "text-sm text-os-grey" : "text-xs text-muted-foreground",
    /** Panel padding. The design's surfaces are roomier than the brand shell's. */
    panelPad: os ? "p-6" : "p-4",
    cardPad: os ? "p-4" : "p-3",
    /** An icon-only control: week arrows, refresh, reset, remove. */
    iconBtn: os
      ? "rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
      : "p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors",
  };
}
