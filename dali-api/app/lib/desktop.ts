import { useEffect, useState } from "react";

type DesktopGlobal = { __DALI_DESKTOP?: { version?: string } };

// The desktop shell (desktop/src-tauri/src/window.rs) injects
// window.__DALI_DESKTOP into the top frame via a webview initialization
// script — the remote page has no IPC access, so a frozen global is the
// handoff. Workspace tabs render in same-origin iframes and read the top
// frame's copy.
export function desktopVersion(): string | null {
  try {
    const top = window.top as (Window & DesktopGlobal) | null;
    return top?.__DALI_DESKTOP?.version ?? null;
  } catch {
    return null; // cross-origin top — not our shell
  }
}

// null on the server and the first client render (effect-based so SSR markup
// matches hydration), then the shell version, or stays null in a browser.
export function useDesktopVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    setVersion(desktopVersion());
  }, []);
  return version;
}
