import { cn } from '~/lib/cn'

// The dali.os *shell* dress, in one place — the rail and its menus, as opposed
// to os-chrome.ts, which dresses what a page puts inside them. Two shells wear
// it now (the member shell and the portal shell), so a change to the rail's
// resting, hover or active state has to land in both at once rather than
// leaving one looking subtly unlike the other.

// Every floating panel in the design is one material: the card fill, a hairline
// container border, 14px corners and a cast shadow. Not the card *hover* fill —
// that's a state a card takes on under the pointer, so a panel painted with it
// reads as a different surface from the card it drops out of, which is what
// made the account menu look out of place against the rail.
export const osMenuClass =
  'rounded-[14px] border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]'

// A row inside one. Full-strength text — a menu's rows are all equally
// available, so greying them is a state that isn't true of any of them.
export const osMenuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container'

// A rail row. The active state is the design's marker: a filled well whose
// left border is the accent stripe, square on that edge so it reads as
// attached to the rail rather than as a floating pill.
export function railRowClass(active: boolean, collapsed: boolean) {
  return cn(
    'flex items-center gap-3 text-base text-left transition-colors',
    collapsed ? 'justify-center px-3 py-2 rounded-os-item' : 'px-3 py-2',
    active
      ? cn('font-medium text-foreground', !collapsed && 'os-subtab-active pl-[10px]')
      : cn(
          'font-normal text-os-grey hover:bg-os-hover hover:text-foreground',
          // Match the active state / sub-tabs: right-rounded hover, square on
          // the left where the rail accent sits (not a bare rectangle).
          !collapsed && 'rounded-r-os-item',
        ),
    collapsed && active && 'bg-os-container text-foreground',
  )
}
