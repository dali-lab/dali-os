// Desktop app tabs: a tab is a record (url, history, scroll), not a frame. The
// one router renders the active tab; the others are just state. Pure functions
// so every transition is unit-testable; desktop-tabs-store.ts holds the live
// state and persists it.

import { HISTORY_CAP } from "~/lib/navigation-history";

export interface DesktopTab {
  id: string;
  url: string;
  origin: string;
  label: string;
  emoji?: string;
  pinned: boolean;
  ephemeral: boolean;
  lastActivatedAt: number;
  scrollY: number;
  backStack: string[];
  forwardStack: string[];
}

export interface ClosedDesktopTab {
  url: string;
  origin: string;
  label: string;
  backStack: string[];
  forwardStack: string[];
}

export interface DesktopTabsState {
  tabs: DesktopTab[];
  activeId: string | null;
  closed: ClosedDesktopTab[];
}

export interface OpenTabRequest {
  url: string;
  label: string;
  emoji?: string | null;
}

export const MAX_TABS = 20;
export const CLOSED_CAP = 10;

export function emptyTabsState(): DesktopTabsState {
  return { tabs: [], activeId: null, closed: [] };
}

export function sameUrl(a: string, b: string): boolean {
  return a.split("#")[0] === b.split("#")[0];
}

export function activeTab(state: DesktopTabsState): DesktopTab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null;
}

function newTab(req: OpenTabRequest, id: string, now: number, ephemeral: boolean): DesktopTab {
  return {
    id,
    url: req.url,
    origin: req.url,
    label: req.label,
    ...(req.emoji ? { emoji: req.emoji } : {}),
    pinned: false,
    ephemeral,
    lastActivatedAt: now,
    scrollY: 0,
    backStack: [],
    forwardStack: [],
  };
}

function pinnedFirst(tabs: DesktopTab[]): DesktopTab[] {
  const pinned = tabs.filter((t) => t.pinned);
  return pinned.length === 0 ? tabs : [...pinned, ...tabs.filter((t) => !t.pinned)];
}

function evictOverCap(tabs: DesktopTab[], keepId: string): DesktopTab[] {
  if (tabs.length <= MAX_TABS) return tabs;
  let victim: DesktopTab | null = null;
  for (const t of tabs) {
    if (t.id === keepId || t.pinned) continue;
    if (!victim || t.lastActivatedAt < victim.lastActivatedAt) victim = t;
  }
  return victim ? tabs.filter((t) => t !== victim) : tabs;
}

function updateTab(
  state: DesktopTabsState,
  id: string,
  fn: (t: DesktopTab) => DesktopTab,
): DesktopTabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id) return t;
    const next = fn(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

export function activateTab(state: DesktopTabsState, id: string, now: number): DesktopTabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  const next = updateTab(state, id, (t) => ({ ...t, lastActivatedAt: now }));
  return { ...next, activeId: id };
}

/**
 * Open `req`. A tab already showing that url is focused instead. An ephemeral
 * (preview) open reuses the one preview tab rather than stacking, so skimming
 * the sidebar never piles up tabs. `background` adds the tab without focusing it.
 */
export function openTab(
  state: DesktopTabsState,
  req: OpenTabRequest,
  opts: { id: string; now: number; ephemeral?: boolean; background?: boolean },
): DesktopTabsState {
  const existing = state.tabs.find((t) => sameUrl(t.url, req.url));
  if (existing) return opts.background ? state : activateTab(state, existing.id, opts.now);

  const ephemeral = opts.ephemeral === true && !opts.background;
  const tab = newTab(req, opts.id, opts.now, ephemeral);
  const preview = ephemeral ? state.tabs.find((t) => t.ephemeral) : undefined;
  let tabs: DesktopTab[];
  if (preview) {
    tabs = state.tabs.map((t) => (t.id === preview.id ? tab : t));
  } else {
    const at = state.tabs.findIndex((t) => t.id === state.activeId);
    tabs = at < 0 ? [...state.tabs, tab] : [...state.tabs.slice(0, at + 1), tab, ...state.tabs.slice(at + 1)];
  }
  tabs = evictOverCap(pinnedFirst(tabs), tab.id);
  return {
    ...state,
    tabs,
    activeId: opts.background ? (state.activeId ?? tab.id) : tab.id,
  };
}

/**
 * Apply a location change to the active tab. Only a PUSH (a link or navigate()
 * from the page) is a new history entry; the tab's own moves (switch, open,
 * back/forward) all navigate with replace, so they never touch the stacks.
 * Navigating inside a preview tab is engagement, so it becomes a kept tab.
 */
export function recordLocation(
  state: DesktopTabsState,
  url: string,
  navigationType: "PUSH" | "REPLACE" | "POP",
): DesktopTabsState {
  const tab = activeTab(state);
  if (!tab || tab.url === url) return state;
  if (navigationType !== "PUSH") return updateTab(state, tab.id, (t) => ({ ...t, url }));
  return updateTab(state, tab.id, (t) => {
    const backStack = [...t.backStack, t.url].slice(-HISTORY_CAP);
    return { ...t, url, backStack, forwardStack: [], ephemeral: false };
  });
}

/** Walk the active tab's history. Returns the url to navigate to, or null. */
export function stepTabHistory(
  state: DesktopTabsState,
  direction: "back" | "forward",
  steps = 1,
): { state: DesktopTabsState; target: string } | null {
  const tab = activeTab(state);
  if (!tab) return null;
  const source = direction === "back" ? tab.backStack : tab.forwardStack;
  if (steps < 1 || steps > source.length) return null;
  const consumed = source.slice(source.length - steps);
  const target = consumed[0];
  const opposite = [tab.url, ...consumed.slice(1).reverse()];
  const next = updateTab(state, tab.id, (t) =>
    direction === "back"
      ? {
          ...t,
          url: target,
          backStack: t.backStack.slice(0, t.backStack.length - steps),
          forwardStack: [...t.forwardStack, ...opposite].slice(-HISTORY_CAP),
        }
      : {
          ...t,
          url: target,
          backStack: [...t.backStack, ...opposite].slice(-HISTORY_CAP),
          forwardStack: t.forwardStack.slice(0, t.forwardStack.length - steps),
        },
  );
  return { state: next, target };
}

/** Close a tab. When it was active, focus moves to its right-hand neighbour. */
export function closeTab(state: DesktopTabsState, id: string): DesktopTabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const closing = state.tabs[idx];
  const tabs = state.tabs.filter((t) => t.id !== id);
  const activeId =
    state.activeId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : state.activeId;
  const closed = [
    ...state.closed,
    {
      url: closing.url,
      origin: closing.origin,
      label: closing.label,
      backStack: closing.backStack,
      forwardStack: closing.forwardStack,
    },
  ].slice(-CLOSED_CAP);
  return { tabs, activeId, closed };
}

export function closeOtherTabs(state: DesktopTabsState, keepId: string): DesktopTabsState {
  let next = state;
  for (const t of state.tabs) {
    if (t.id !== keepId && !t.pinned) next = closeTab(next, t.id);
  }
  return next.tabs.some((t) => t.id === keepId) ? { ...next, activeId: keepId } : next;
}

export function reopenClosedTab(
  state: DesktopTabsState,
  opts: { id: string; now: number },
): DesktopTabsState {
  const last = state.closed[state.closed.length - 1];
  if (!last) return state;
  const opened = openTab({ ...state, closed: state.closed.slice(0, -1) }, last, opts);
  return updateTab(opened, opts.id, (t) => ({
    ...t,
    origin: last.origin,
    backStack: last.backStack,
    forwardStack: last.forwardStack,
  }));
}

export function togglePin(state: DesktopTabsState, id: string): DesktopTabsState {
  const next = updateTab(state, id, (t) => ({ ...t, pinned: !t.pinned, ephemeral: false }));
  return next === state ? state : { ...next, tabs: pinnedFirst(next.tabs) };
}

export function promoteTab(state: DesktopTabsState, id: string): DesktopTabsState {
  return updateTab(state, id, (t) => (t.ephemeral ? { ...t, ephemeral: false } : t));
}

export function saveScroll(state: DesktopTabsState, id: string, scrollY: number): DesktopTabsState {
  return updateTab(state, id, (t) => (t.scrollY === scrollY ? t : { ...t, scrollY }));
}

/** A tab opened from a section keeps that section's label on the section page
 *  itself; anywhere deeper it takes the page's own title. */
export function labelTab(state: DesktopTabsState, url: string, title: string): DesktopTabsState {
  const tab = activeTab(state);
  if (!tab || !title || !sameUrl(tab.url, url) || sameUrl(tab.origin, url)) return state;
  return updateTab(state, tab.id, (t) => (t.label === title ? t : { ...t, label: title }));
}

export function setTabEmoji(state: DesktopTabsState, url: string, emoji: string | null): DesktopTabsState {
  const tab = activeTab(state);
  if (!tab || !sameUrl(tab.url, url) || (tab.emoji ?? null) === emoji) return state;
  return updateTab(state, tab.id, ({ emoji: _, ...rest }) => (emoji ? { ...rest, emoji } : rest));
}

/** A looked-up emoji for a tab that hasn't shown its page yet. Dropped if the
 *  tab has moved on or already has one. */
export function fillTabEmoji(state: DesktopTabsState, id: string, url: string, emoji: string | null): DesktopTabsState {
  if (!emoji) return state;
  return updateTab(state, id, (t) => (t.emoji || !sameUrl(t.url, url) ? t : { ...t, emoji }));
}

/** Move a tab to `toIndex`, keeping pinned tabs clustered on the left. */
export function moveTab(state: DesktopTabsState, id: string, toIndex: number): DesktopTabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0 || from === toIndex) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, moved);
  return { ...state, tabs: pinnedFirst(tabs) };
}

/**
 * Reconcile restored tabs with the url the window loaded on. The app opened at
 * "/" (a cold launch) restores the last active tab; any other url (a reload, a
 * deep link) is focused if a tab shows it, or opened in the preview slot.
 * Returns the url to navigate to when it isn't the current one.
 */
export function arriveAt(
  state: DesktopTabsState,
  url: string,
  label: string,
  opts: { id: string; now: number },
): { state: DesktopTabsState; navigateTo: string | null } {
  const current = activeTab(state);
  if (url === "/" && current && current.url !== "/") {
    return { state, navigateTo: current.url };
  }
  if (current && sameUrl(current.url, url)) return { state, navigateTo: null };
  return { state: openTab(state, { url, label }, { ...opts, ephemeral: state.tabs.length > 0 }), navigateTo: null };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string");
}

function readTab(raw: unknown): DesktopTab | null {
  const t = raw as Partial<DesktopTab> | null;
  if (!t || typeof t.id !== "string" || typeof t.url !== "string" || typeof t.label !== "string") {
    return null;
  }
  return {
    id: t.id,
    url: t.url,
    origin: typeof t.origin === "string" ? t.origin : t.url,
    label: t.label,
    pinned: t.pinned === true,
    ephemeral: t.ephemeral === true,
    lastActivatedAt: typeof t.lastActivatedAt === "number" ? t.lastActivatedAt : 0,
    scrollY: typeof t.scrollY === "number" ? t.scrollY : 0,
    backStack: isStringArray(t.backStack) ? t.backStack : [],
    forwardStack: isStringArray(t.forwardStack) ? t.forwardStack : [],
  };
}

function readClosed(raw: unknown): ClosedDesktopTab | null {
  const tab = readTab({ id: "", label: "", ...(raw as object) });
  return tab
    ? { url: tab.url, origin: tab.origin, label: tab.label, backStack: tab.backStack, forwardStack: tab.forwardStack }
    : null;
}

export function parseTabsState(raw: unknown): DesktopTabsState {
  const s = raw as { tabs?: unknown; activeId?: unknown; closed?: unknown } | null;
  if (!s || !Array.isArray(s.tabs)) return emptyTabsState();
  const tabs = s.tabs.map(readTab).filter((t): t is DesktopTab => t !== null);
  const activeId =
    typeof s.activeId === "string" && tabs.some((t) => t.id === s.activeId)
      ? s.activeId
      : (tabs[0]?.id ?? null);
  const closed = Array.isArray(s.closed)
    ? s.closed.map(readClosed).filter((c): c is ClosedDesktopTab => c !== null).slice(-CLOSED_CAP)
    : [];
  return { tabs: pinnedFirst(tabs), activeId, closed };
}

/** The iframe workspace's saved state (`dali:tabworkspace:v4`): its focused
 *  pane's tabs carry over; a second split pane's do not. */
export function migrateWorkspaceState(raw: unknown): DesktopTabsState {
  const s = raw as
    | { panes?: { id?: unknown; tabs?: unknown; activeTabId?: unknown }[]; focusedPaneId?: unknown; closedTabs?: unknown }
    | null;
  if (!s || !Array.isArray(s.panes) || s.panes.length === 0) return emptyTabsState();
  const pane = s.panes.find((p) => p?.id === s.focusedPaneId) ?? s.panes[0];
  return parseTabsState({ tabs: pane?.tabs, activeId: pane?.activeTabId, closed: s.closedTabs });
}
