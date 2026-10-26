import { cn } from "~/lib/cn";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { useFeatureFlag } from "~/components/FeatureFlags";

// The dali.os page dress, in one place. Every page draws from the same handful
// of shapes — a card, a panel, a popover, an eyebrow heading, a pill action, a
// dressed form — so a page's settings rail can repeat them four times over and
// read from one source.

/**
 * A dialog's card. `.os-modal-card` carries the 24px corner, hairline and cast
 * shadow (and its own padding: 24px, or 20px under the v2 design). Pass the
 * size — every dialog picks its own — and nothing else.
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
  // The v2 design (the sidebar redesign's scale and dress) rides the
  // desktop-tabs flag — the same gate as html[data-v2] in app.css. Outside the
  // member shell (portal, partner, auth) there is no provider, the flag reads
  // false, and every key below keeps the pre-redesign dress.
  const v2 = useFeatureFlag("desktop-tabs");
  return {
    os: true as const,
    /** A panel surface: a settings card, an inline form, a section header. */
    card: "rounded-os-card bg-os-card",
    /** A page's large surfaces — a full-width table, a grid, a long form. */
    panel: "rounded-os-card bg-os-card",
    /** A hand-rolled popover: the dress the floating primitives wear. */
    popover: OS_SURFACE_CLASS,
    /** The page's own title. v2: bold in the sidebar's own face (Mulish, the
     *  shell body font), not the heading font. */
    pageTitle: v2
      ? "text-2xl font-bold text-foreground"
      : "font-heading text-4xl font-medium text-foreground",
    /** A page section that is not itself a card. Drawn as a title on the page
     *  ground with its content on a surface below it (`.pd-section`), rather
     *  than boxing the whole thing — so a section that holds a card no longer
     *  shows two nested borders. */
    sectionShell: "flex flex-col gap-3",
    /** That section's title — a different job from the uppercase eyebrow
     *  `heading` a settings panel wears; the two are not interchangeable. */
    sectionTitle: v2
      ? "font-heading text-base font-semibold text-foreground"
      : "font-heading text-[19px] font-semibold text-foreground",
    /** A panel's heading. The design labels its panels with an eyebrow. */
    heading:
      "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-os-grey",
    /** The glyph in that heading — the design keeps its panel labels monochrome. */
    headingIcon: "w-3.5 h-3.5 text-os-grey",
    /** The quiet action beside a heading ("Add Block", "Add Google Account"). */
    quietBtn: "os-add-btn os-add-btn--sm",
    /** Wraps a form so its inputs and textareas take the design's field dress
     *  (`.os-form` in app.css: a well fill, accent focus ring). One class
     *  instead of an os variant on every input on the page. */
    formClass: "os-form",
    /** A Select/menu trigger inside such a form. `.os-form` reaches inputs and
     *  textareas; a trigger is a button, so it copies that dress here. */
    formTrigger: v2
      ? "w-full rounded-lg border bg-os-well px-[12px] py-[8px] text-[13px] text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi"
      : "w-full rounded-[10px] border bg-os-well px-3.5 py-2.5 text-sm text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:border-os-container-hi",
    /** The same dress for a field that has to keep its tight metrics — a
     *  pinned toolbar row or a table cell, where `.os-form`'s roomier padding
     *  would break the alignment. Pair it with a border colour at the call
     *  site; it sets none, so an error state can't lose a specificity race. */
    compactField: v2
      ? "rounded-lg bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent"
      : "rounded-[10px] bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent",
    /** A stacked field label. v2 sets its labels at 14px semibold. */
    fieldLabel: v2
      ? "text-sm font-semibold text-os-grey flex flex-col gap-1.5"
      : "text-sm text-os-grey flex flex-col gap-1.5",
    /** Corners for a nested well that isn't a field (a picker's result list). */
    fieldRadius: "rounded-os-item",
    /** Explanatory copy under a heading. The design sets its body at 14px. */
    bodyText: "text-sm text-os-grey",
    /** Panel padding. The design's surfaces are roomier than the brand shell's. */
    panelPad: v2 ? "p-5" : "p-6",
    cardPad: "p-4",
    /** An icon-only control: week arrows, refresh, reset, remove. */
    iconBtn:
      "rounded-os-item p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground",
    /** A control in a page's action row — the document top bar's favourite,
     *  comments and Share buttons, and anything else that sits beside them.
     *  Outlined, like the design's other secondary actions (`.os-edit-btn`);
     *  its pressed state is the design's accent. */
    actionBtn: (active = false) =>
      cn(
        // touch: enlarge the hit area to ~40px on hover-less devices (phones);
        // desktop pointer sizing is unchanged.
        v2
          ? "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm transition-colors touch:min-h-[40px] touch:min-w-[40px]"
          : "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors touch:min-h-[40px] touch:min-w-[40px]",
        active
          ? "border-os-accent/30 bg-os-accent/15 text-os-accent"
          : v2
            ? "border-os-container text-os-grey hover:border-os-container-hi hover:bg-os-hover hover:text-foreground"
            : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
      ),
    /** The same control filled with the accent, for the row's lead actions (a
     *  meeting note's Attendance and Record). */
    actionBtnPrimary: v2
      ? "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-os-accent bg-os-accent px-3 text-sm font-semibold text-os-bg transition-colors hover:border-os-accent-hover hover:bg-os-accent-hover touch:min-h-[40px] touch:min-w-[40px]"
      : "inline-flex items-center justify-center gap-1.5 rounded-full border border-os-accent bg-os-accent px-3 py-1.5 text-sm font-semibold text-os-bg transition-colors hover:border-os-accent-hover hover:bg-os-accent-hover touch:min-h-[40px] touch:min-w-[40px]",
    /** The glyph inside `actionBtn`. The design draws its controls at 16px. */
    actionIcon: "h-4 w-4",
  };
}
