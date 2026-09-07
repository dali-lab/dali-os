import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";

// The dali.os page dress, in one place. Every page draws from the same handful
// of shapes — a card, a panel, a popover, an eyebrow heading, a pill action, a
// dressed form — so a page's settings rail can repeat them four times over and
// read from one source.

/**
 * A dialog's card. `.os-modal-card` carries the 24px corner, hairline and cast
 * shadow (and its own 24px padding). Pass the size — every dialog picks its own
 * — and nothing else.
 */
export function modalCardClass(size?: string) {
  return cn(
    "os-modal-card",
    // Cap the card to the viewport and let it scroll inside: a tall dialog (a
    // long edit form) was overflowing the centered overlay so its lower fields
    // and Save button were unreachable. The Select menus portal out, so an
    // overflow here doesn't clip their dropdowns.
    "w-full my-auto max-h-[85vh] overflow-y-auto",
    size,
  );
}

export function useOsChrome() {
  return {
    os: true as const,
    /** A panel surface: a settings card, an inline form, a section header. */
    card: "rounded-os-card bg-os-card",
    /** A page's large surfaces — a full-width table, a grid, a long form. */
    panel: "rounded-os-card bg-os-card",
    /** A hand-rolled popover: the dress the floating primitives wear. */
    popover: OS_SURFACE_CLASS,
    /** The page's own title. Every os page opens at the same size and weight. */
    pageTitle: "font-heading text-4xl font-medium text-foreground",
    /** A page section that is not itself a card. Drawn as a title on the page
     *  ground with its content on a surface below it (`.pd-section`), rather
     *  than boxing the whole thing — so a section that holds a card no longer
     *  shows two nested borders. */
    sectionShell: "flex flex-col gap-3",
    /** That section's title. A content page titles its sections at 19px, which
     *  is a different job from the uppercase eyebrow `heading` a settings panel
     *  wears — the two are not interchangeable. */
    sectionTitle: "font-heading text-[19px] font-semibold text-foreground",
    /** A panel's heading. The design labels its panels with an eyebrow. */
    heading:
      "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-os-grey",
    /** The glyph in that heading — the design keeps its panel labels monochrome. */
    headingIcon: "w-3.5 h-3.5 text-os-grey",
    /** The quiet action beside a heading ("Add Block", "Add Google Account"). */
    quietBtn: "os-add-btn os-add-btn--sm",
    /** Wraps a form so its inputs and textareas take the design's field dress
     *  (`.os-form` in app.css: a well fill, 10px corner, accent focus ring).
     *  One class instead of an os variant on every input on the page. */
    formClass: "os-form",
    /** A Select/menu trigger inside such a form. `.os-form` reaches inputs and
     *  textareas; a trigger is a button, so it copies that dress here. */
    formTrigger:
      "w-full rounded-[10px] border bg-os-well px-3.5 py-2.5 text-sm text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi",
    /** The same dress for a field that has to keep its tight metrics — a
     *  pinned toolbar row or a table cell, where `.os-form`'s roomier padding
     *  would break the alignment. Pair it with a border colour at the call
     *  site; it sets none, so an error state can't lose a specificity race. */
    compactField:
      "rounded-[10px] bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent",
    /** A stacked field label. The design sets its forms in 14px, not 12px. */
    fieldLabel: "text-sm text-os-grey flex flex-col gap-1.5",
    /** Corners for a nested well that isn't a field (a picker's result list). */
    fieldRadius: "rounded-os-item",
    /** Explanatory copy under a heading. The design sets its body at 14px. */
    bodyText: "text-sm text-os-grey",
    /** Panel padding. The design's surfaces are roomier than the brand shell's. */
    panelPad: "p-6",
    cardPad: "p-4",
    /** An icon-only control: week arrows, refresh, reset, remove. */
    iconBtn:
      "rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground",
    /** A control in a page's action row — the document top bar's favourite,
     *  comments and Share buttons, and anything else that sits beside them.
     *  Its pressed state is the design's accent. */
    actionBtn: (active = false) =>
      cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-os-accent/15 text-os-accent"
          : "text-os-grey hover:bg-os-container hover:text-foreground",
      ),
    /** The glyph inside `actionBtn`. The design draws its controls at 16px. */
    actionIcon: "h-4 w-4",
  };
}
