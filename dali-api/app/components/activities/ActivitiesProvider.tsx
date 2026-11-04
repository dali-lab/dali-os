import { createContext, useContext, type ReactNode } from "react";
import type { ActiveActivity } from "~/lib/activities";

// The activities live for THIS user right now, resolved server-side in the
// layout loader (resolveActiveActivitiesForUser) and plumbed here — the same
// pattern as FeatureFlagsProvider. Mounting this in both the shell and the
// embedded branch covers the banner (shell) and the on-page overlay.
//
// Empty array = nothing live → the banner and
// overlay render nothing.

const ActivitiesContext = createContext<ActiveActivity[]>([]);

export function ActivitiesProvider({
  activities,
  children,
}: {
  activities: ActiveActivity[];
  children: ReactNode;
}) {
  return (
    <ActivitiesContext.Provider value={activities}>
      {children}
    </ActivitiesContext.Provider>
  );
}

export function useActiveActivities(): ActiveActivity[] {
  return useContext(ActivitiesContext);
}
