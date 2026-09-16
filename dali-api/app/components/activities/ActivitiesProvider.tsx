import { createContext, useContext, type ReactNode } from "react";
import type { ActiveActivity } from "~/lib/activities";

// The activities live for THIS user right now, resolved server-side in the
// layout loader (resolveActiveActivitiesForUser) and plumbed here — the same
// pattern as FeatureFlagsProvider. Each workspace iframe runs the layout loader
// itself, so mounting this in both the shell and the embedded branch covers the
// banner (shell) and the on-page overlay (inside the iframe's pageContent).
//
// Empty array = nothing live (or the `activities` flag is off) → the banner and
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
