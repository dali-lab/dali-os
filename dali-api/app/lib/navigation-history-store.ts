// A single app-lifetime store for the tabless back/forward history stack.
//
// The stack must outlive the component that renders the arrows: those hosts
// (Layout's standalone bar, AreaPillNav/UnderlineTabButtons' inline arrows)
// mount and unmount as the user moves between pages with and without a subnav
// row, so holding the stack in their local state wiped the whole history on
// every such transition. Keeping it here — subscribed via useSyncExternalStore
// and fed by a single recording effect on the always-mounted shell — makes it
// the genuinely global stack the arrows assume.

import {
  navigateHistoryStacks,
  recordNavigation,
  type NavigationHistoryStacks,
} from "./navigation-history";

let stacks: NavigationHistoryStacks = { backStack: [], forwardStack: [] };
// Last URL the recorder saw. null until the first observation, so the landing
// page itself isn't recorded as a navigation.
let prevUrl: string | null = null;
// URL of an in-flight arrow-driven navigation. When the resulting location
// change comes back through observe(), we recognise it isn't a fresh
// navigation and skip re-recording it (stepHistory already moved the stacks).
let pendingTarget: string | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): NavigationHistoryStacks {
  return stacks;
}

// Fed every location change by the recording effect. Mirrors browser history
// semantics: a fresh push records the prior url onto the back stack and clears
// forward; replace/pop and arrow-driven moves don't.
export function observeNavigation(
  currentUrl: string,
  navigationType: "PUSH" | "REPLACE" | "POP",
): void {
  if (prevUrl === null) {
    prevUrl = currentUrl;
    return;
  }
  if (prevUrl === currentUrl) return;

  if (pendingTarget === currentUrl) {
    pendingTarget = null;
    prevUrl = currentUrl;
    return;
  }

  if (navigationType === "REPLACE" || navigationType === "POP") {
    prevUrl = currentUrl;
    return;
  }

  const next = recordNavigation(stacks, prevUrl, currentUrl);
  prevUrl = currentUrl;
  if (next !== stacks) {
    stacks = next;
    emit();
  }
}

// Walk the stack `steps` entries in `direction`. Moves the stacks immediately
// and returns the URL the caller should navigate to (or null if that many
// steps aren't available). The subsequent location change is recognised as the
// pending target by observeNavigation, so it isn't recorded as a new push.
export function stepHistory(
  currentUrl: string,
  direction: "back" | "forward",
  steps = 1,
): string | null {
  const result = navigateHistoryStacks(stacks, currentUrl, direction, steps);
  if (!result) return null;
  pendingTarget = result.target;
  stacks = result.stacks;
  emit();
  return result.target;
}
