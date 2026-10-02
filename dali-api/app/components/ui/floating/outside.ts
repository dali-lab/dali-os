// One predicate for every "was this click outside my card?" dismissal handler.
//
// Floating layers render into a portal at <body>, so they are NOT DOM
// descendants of the card that owns them. A handler that only asks
// `card.contains(target)` therefore counts a click on its own dropdown as an
// outside click and tears the card down mid-interaction — picking a role, a
// date or a time closed the whole form. Every such layer is tagged, so the
// hosts can share one answer instead of each maintaining its own selector list.
export const FLOATING_LAYER_SELECTOR =
  "[data-floating-ui-portal],[data-calendar-popover],[data-field-popover],[role='dialog']";

/** True when `target` sits inside any floating layer (a floating-ui portal from
 *  Select / Menu / Combobox / Popover, a calendar card, a DateField / TimeField
 *  picker, or a dialog). Such a click belongs to the card, not outside it. */
export function isInFloatingLayer(target: EventTarget | null): boolean {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  return !!el?.closest(FLOATING_LAYER_SELECTOR);
}
