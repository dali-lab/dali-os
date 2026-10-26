import { useEffect, useState } from "react";
import { desktopVersion } from "~/lib/desktop";
import { isMobileDevice } from "~/lib/device";

export function isBrowserDesktopCandidate(): boolean {
  return desktopVersion() === null && !isMobileDevice();
}

// False on the server and the first client render so SSR markup matches hydration.
export function useIsBrowserDesktopCandidate(): boolean {
  const [candidate, setCandidate] = useState(false);
  useEffect(() => {
    setCandidate(isBrowserDesktopCandidate());
  }, []);
  return candidate;
}
