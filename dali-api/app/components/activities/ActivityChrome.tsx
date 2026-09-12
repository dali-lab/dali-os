// On-page activity chrome (specs/activities.md §7.5). The mechanic's scattered
// codes/clues for the CURRENT route. Mounted inside pageContent (layout.tsx) —
// NOT the shell — because in tab mode the routed page renders in an iframe and
// that's where on-page codes belong. In tabless mode both the page and this live
// in one document. The "an activity is live" bar + surface modal are the shell's
// job and live in ActivityLauncher (mounted next to DesktopBanner).
//
// Reads the live-for-me list from the provider and renders nothing when it's
// empty — so when a window closes and the loader drops the activity, the on-page
// clues vanish on their own.

import { useActiveActivities } from "./ActivitiesProvider";
import { mechanicClient } from "~/activities/mechanics/registry";

export function ActivityOverlay() {
  const activities = useActiveActivities();
  if (activities.length === 0) return null;
  return (
    <>
      {activities.map((a) => {
        if (a.overlay == null) return null;
        const Overlay = mechanicClient(a.kind)?.Overlay;
        if (!Overlay) return null;
        return (
          <Overlay key={a.id} activityId={a.id} name={a.name} overlay={a.overlay} />
        );
      })}
    </>
  );
}
