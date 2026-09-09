// Global chrome for active activities (specs/activities.md §7.5). Two mount
// points, mind the tab-mode iframe:
//   <ActivityBanner/>  → the shell (next to LaunchWelcome). Renders ONCE around
//                        the tabs, so it must NOT go inside pageContent.
//   <ActivityOverlay/> → inside pageContent, because in tab mode the routed page
//                        renders in an iframe and that's where on-page codes
//                        belong. In tabless mode both live in one document.
// Both read the live-for-me list from the provider and render nothing when it's
// empty — so when a window closes and the loader drops the activity, the site
// reverts on its own.

import { Link } from "react-router";
import { Sparkles } from "lucide-react";
import { useActiveActivities } from "./ActivitiesProvider";
import { mechanicClient } from "~/activities/mechanics/registry";

export function ActivityBanner() {
  const activities = useActiveActivities();
  if (activities.length === 0) return null;

  // One live activity → deep-link straight to it; several → the index.
  const single = activities.length === 1 ? activities[0] : null;
  const cta = single ? mechanicClient(single.kind)?.bannerCta ?? "Open →" : "View all →";
  const to = single ? `/activities/${single.id}` : "/activities";
  const label = single ? single.name : `${activities.length} activities are live`;

  return (
    <Link
      to={to}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur transition-colors hover:bg-muted"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-coral/10">
        <Sparkles className="h-3.5 w-3.5 text-accent-coral" />
      </span>
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-accent-coral">{cta}</span>
    </Link>
  );
}

export function ActivityOverlay() {
  const activities = useActiveActivities();
  if (activities.length === 0) return null;
  return (
    <>
      {activities.map((a) => {
        if (a.overlay == null) return null;
        const mech = mechanicClient(a.kind);
        if (!mech) return null;
        const Overlay = mech.Overlay;
        return (
          <Overlay key={a.id} activityId={a.id} name={a.name} overlay={a.overlay} />
        );
      })}
    </>
  );
}
