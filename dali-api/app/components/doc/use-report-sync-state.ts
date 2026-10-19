import { useEffect, useRef } from "react";
import { WebSocketStatus } from "@hocuspocus/provider";
import type { CollabDocEntry } from "./collab-doc";
import type { DocSyncState } from "./types";

// Hocuspocus acks a keystroke in tens of ms, so the raw state flips
// saving→saved on every key. Only surface "saving" when a save is actually slow,
// and once surfaced keep it up long enough to read rather than flash.
export const SAVING_SHOW_DELAY_MS = 1000;
export const SAVING_MIN_VISIBLE_MS = 500;

type SyncProvider = Pick<CollabDocEntry["provider"], "on" | "off" | "hasUnsyncedChanges" | "synced"> & {
  configuration: { websocketProvider: { status: WebSocketStatus } };
};

export function useReportSyncState(provider: SyncProvider, onChange: ((state: DocSyncState) => void) | undefined) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  useEffect(() => {
    if (!cbRef.current) return;
    let connected = provider.configuration.websocketProvider.status === WebSocketStatus.Connected;
    let shown: DocSyncState | null = null;
    let savingShownAt = 0;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
      showTimer = hideTimer = null;
    };
    const show = (next: DocSyncState) => {
      clearTimers();
      if (next === shown) return;
      shown = next;
      if (next === "saving") savingShownAt = Date.now();
      cbRef.current?.(next);
    };
    const raw = (): DocSyncState =>
      !connected ? "offline" : provider.hasUnsyncedChanges || !provider.synced ? "saving" : "saved";

    const emit = () => {
      const next = raw();
      if (shown === null || next === "offline" || shown === "offline") return show(next);
      if (next === shown) return clearTimers();
      if (next === "saving") {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        showTimer ??= setTimeout(() => show("saving"), SAVING_SHOW_DELAY_MS);
        return;
      }
      const remaining = SAVING_MIN_VISIBLE_MS - (Date.now() - savingShownAt);
      if (remaining <= 0) return show(next);
      hideTimer ??= setTimeout(() => show(next), remaining);
    };
    const onStatus = (e: { status: WebSocketStatus }) => {
      connected = e.status === WebSocketStatus.Connected;
      emit();
    };
    const onConnect = () => {
      connected = true;
      emit();
    };
    const onDisconnect = () => {
      connected = false;
      emit();
    };
    emit();
    provider.on("status", onStatus);
    provider.on("synced", emit);
    provider.on("unsyncedChanges", emit);
    provider.on("connect", onConnect);
    provider.on("disconnect", onDisconnect);
    return () => {
      clearTimers();
      provider.off("status", onStatus);
      provider.off("synced", emit);
      provider.off("unsyncedChanges", emit);
      provider.off("connect", onConnect);
      provider.off("disconnect", onDisconnect);
    };
  }, [provider]);
}
