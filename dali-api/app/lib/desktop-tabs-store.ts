// The live desktop tab set: one app-lifetime store, subscribed via
// useSyncExternalStore and fed every location change by one recorder on the
// shell. Tab moves navigate the single router through the navigator the shell
// registers, always with `replace`, so the router's history only ever holds
// page navigations (see recordLocation).

import {
  activateTab,
  activeTab,
  arriveAt,
  closeOtherTabs,
  closeTab,
  emptyTabsState,
  labelTab,
  setTabEmoji,
  migrateWorkspaceState,
  moveTab,
  openTab,
  parseTabsState,
  promoteTab,
  recordLocation,
  reopenClosedTab,
  saveScroll,
  stepTabHistory,
  togglePin,
  type DesktopTabsState,
  type OpenTabRequest,
} from "~/lib/desktop-tabs";
import { writeTabsSnapshotCookie } from "~/lib/desktop-tabs-pref";

export const TABS_STORAGE_KEY = "dali:desktop-tabs:v1";
export const LEGACY_WORKSPACE_KEY = "dali:tabworkspace:v4";

type Navigator = (url: string, opts?: { tabSwitch: true }) => void;

const TAB_SWITCH = { tabSwitch: true } as const;

let state: DesktopTabsState = emptyTabsState();
let navigator: Navigator | null = null;
let pendingScroll: { url: string; y: number } | null = null;
const listeners = new Set<() => void>();

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota / disabled storage: tabs just won't survive a relaunch
  }
  writeTabsSnapshotCookie(state);
}

function set(next: DesktopTabsState) {
  if (next === state) return;
  state = next;
  persist();
  emit();
}

function emit() {
  for (const l of listeners) l();
}

function currentScrollY(): number {
  return typeof window === "undefined" ? 0 : Math.round(window.scrollY);
}

// Leave the active tab: remember where it was scrolled, then apply `next` and
// show whatever tab it made active.
function moveTo(next: DesktopTabsState) {
  const leaving = activeTab(state);
  const withScroll = leaving ? saveScroll(next, leaving.id, currentScrollY()) : next;
  const target = activeTab(withScroll);
  set(withScroll);
  if (!target || target.id === leaving?.id) return;
  pendingScroll = { url: target.url, y: target.scrollY };
  navigator?.(target.url, TAB_SWITCH);
}

export function getTabsSnapshot(): DesktopTabsState {
  return state;
}

export function subscribeTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function tabsActive(): boolean {
  return navigator !== null;
}

// Whether the tab strip itself is on screen — distinct from tabsActive(),
// which only says the store took the navigator. The loading bar docks under
// the strip while one is mounted.
let stripCount = 0;
const stripListeners = new Set<() => void>();

export function markTabStripMounted(): () => void {
  stripCount++;
  stripListeners.forEach((l) => l());
  return () => {
    stripCount--;
    stripListeners.forEach((l) => l());
  };
}

export function subscribeTabStrip(listener: () => void): () => void {
  stripListeners.add(listener);
  return () => {
    stripListeners.delete(listener);
  };
}

export function tabStripShowing(): boolean {
  return stripCount > 0;
}

/**
 * Start tabs for this window: restore the saved set (or the iframe workspace's,
 * the first time), reconcile it with the url the window loaded on, and take the
 * navigator every tab move goes through. Returns the stop function.
 */
export function startTabs(
  arrival: { url: string; label: string },
  navigate: Navigator,
): () => void {
  const saved = read(TABS_STORAGE_KEY);
  const restored = saved ? parseTabsState(saved) : migrateWorkspaceState(read(LEGACY_WORKSPACE_KEY));
  const { state: arrived, navigateTo } = arriveAt(restored, arrival.url, arrival.label, {
    id: newId(),
    now: Date.now(),
  });
  navigator = navigate;
  state = arrived;
  persist();
  emit();
  if (navigateTo) navigate(navigateTo);
  return () => {
    navigator = null;
  };
}

export const tabActions = {
  open(req: OpenTabRequest, opts: { ephemeral?: boolean; background?: boolean } = {}) {
    moveTo(openTab(state, req, { id: newId(), now: Date.now(), ...opts }));
  },
  newTab() {
    tabActions.open({ url: "/", label: "Home" });
  },
  activate(id: string) {
    moveTo(activateTab(state, id, Date.now()));
  },
  close(id: string) {
    const next = closeTab(state, id);
    moveTo(next.tabs.length > 0 ? next : openTab(next, { url: "/", label: "Home" }, { id: newId(), now: Date.now() }));
  },
  closeActive() {
    if (state.activeId) tabActions.close(state.activeId);
  },
  closeOthers(id: string) {
    moveTo(closeOtherTabs(state, id));
  },
  reopenClosed() {
    moveTo(reopenClosedTab(state, { id: newId(), now: Date.now() }));
  },
  activateIndex(index: number) {
    const tab = index < 0 ? state.tabs[state.tabs.length - 1] : state.tabs[index];
    if (tab) tabActions.activate(tab.id);
  },
  cycle(delta: 1 | -1) {
    const at = state.tabs.findIndex((t) => t.id === state.activeId);
    if (at < 0 || state.tabs.length < 2) return;
    tabActions.activate(state.tabs[(at + delta + state.tabs.length) % state.tabs.length].id);
  },
  step(direction: "back" | "forward", steps = 1) {
    const result = stepTabHistory(state, direction, steps);
    if (!result) return;
    set(result.state);
    navigator?.(result.target, TAB_SWITCH);
  },
  togglePin(id: string) {
    set(togglePin(state, id));
  },
  promote(id: string) {
    set(promoteTab(state, id));
  },
  promoteActive() {
    if (state.activeId) set(promoteTab(state, state.activeId));
  },
  move(id: string, toIndex: number) {
    set(moveTab(state, id, toIndex));
  },
  /** Fed every router location change by the shell's recorder. Returns the
   *  scroll offset to restore when the change landed a tab switch. */
  record(url: string, navigationType: "PUSH" | "REPLACE" | "POP"): number | null {
    set(recordLocation(state, url, navigationType));
    const pending = pendingScroll;
    pendingScroll = null;
    return pending?.url === url ? pending.y : null;
  },
  label(url: string, title: string) {
    set(labelTab(state, url, title));
  },
  emoji(url: string, emoji: string | null) {
    set(setTabEmoji(state, url, emoji));
  },
};
