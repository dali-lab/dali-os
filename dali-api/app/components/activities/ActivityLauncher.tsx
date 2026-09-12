// Activity launcher (specs/activities.md §7.5): the "an activity is live" entry
// point + the surface modal, mounted in the shell (LayoutOS) next to
// DesktopBanner. Two pieces, one owner of open state:
//   • A top-bar bar (DesktopBanner's slot/styling) announcing what's live.
//   • A Modal that renders the mechanic's Surface, fetched from the
//     /api/activities/:id endpoint. The surface floats over whatever page the
//     member is exploring — the activity's whole point is to roam the site — so
//     it's a modal, not a page.
// The on-page code Overlay is separate (ActivityChrome → pageContent) because in
// tab mode the routed page lives in an iframe. This bar/modal are the shell.
//
// Reads the live-for-me list from ActivitiesProvider; renders nothing when it's
// empty, so the bar and modal disappear on their own once a window closes.

import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Sparkles } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { activityKindLabel } from "~/lib/activities";
import { useActiveActivities } from "./ActivitiesProvider";
import { mechanicClient } from "~/activities/mechanics/registry";

// Mirrors the /api/activities/:id loader return.
type ActivityData = {
  activityId: string;
  name: string;
  kind: string;
  active: boolean;
  currentUserId: string;
  nameByUserId: Record<string, string>;
  progress: unknown;
  results: unknown;
};

type View = { mode: "closed" } | { mode: "picker" } | { mode: "surface"; id: string };

const TITLE_ID = "activity-modal-title";

export function ActivityLauncher() {
  const activities = useActiveActivities();
  const [view, setView] = useState<View>({ mode: "closed" });
  const data = useFetcher<ActivityData>();

  if (activities.length === 0) return null;

  const openSurface = (id: string) => {
    setView({ mode: "surface", id });
    data.load(`/api/activities/${id}`);
  };
  const close = () => setView({ mode: "closed" });

  const single = activities.length === 1 ? activities[0] : null;
  const cta = single ? mechanicClient(single.kind)?.bannerCta ?? "Open" : "View";
  const onOpen = () => (single ? openSurface(single.id) : setView({ mode: "picker" }));

  return (
    <>
      {/* Top-bar bar — matches DesktopBanner's slot + styling. */}
      <div className="flex flex-none items-center gap-2 border-b border-border bg-card px-4 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-accent-coral" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {single ? (
            <>
              <span className="font-medium">{single.name}</span>
              <span className="text-muted-foreground">
                {" "}
                is live{single.progressLabel ? ` · ${single.progressLabel}` : ""}
              </span>
            </>
          ) : (
            <span className="font-medium">{activities.length} activities are live</span>
          )}
        </span>
        <button type="button" onClick={onOpen} className={buttonClasses("primary", "sm")}>
          {cta}
        </button>
      </div>

      {view.mode !== "closed" && (
        <Modal
          open
          onClose={close}
          labelledBy={TITLE_ID}
          containerClassName={modalCardClass("max-w-lg")}
        >
          {view.mode === "picker" ? (
            <>
              <ModalHeader titleId={TITLE_ID} title="Activities" onClose={close} />
              <ul className="flex flex-col gap-2">
                {activities.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => openSurface(a.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-coral/10">
                        <Sparkles className="h-4 w-4 text-accent-coral" />
                      </span>
                      <span className="flex flex-col">
                        <span className="font-medium text-foreground">{a.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {activityKindLabel(a.kind)}
                          {a.progressLabel ? ` · ${a.progressLabel}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <SurfaceView
              id={view.id}
              data={data.data?.activityId === view.id ? data.data : null}
              loading={data.state === "loading"}
              onClose={close}
              onChanged={() => data.load(`/api/activities/${view.id}`)}
            />
          )}
        </Modal>
      )}
    </>
  );
}

function SurfaceView({
  id,
  data,
  loading,
  onClose,
  onChanged,
}: {
  id: string;
  data: ActivityData | null;
  loading: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const title = data?.name ?? "Activity";
  const mech = data ? mechanicClient(data.kind) : undefined;

  // Live updates: while this surface is open, subscribe to the activity's SSE
  // stream and refetch on any push so the leaderboard reflects everyone's
  // submissions, not just this viewer's. Keyed on id only; the latest onChanged
  // is read through a ref so reconnecting isn't tied to render identity.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/activities/${id}/stream`, { withCredentials: true });
    const onPush = () => onChangedRef.current();
    es.addEventListener("change", onPush);
    es.addEventListener("sync", onPush);
    return () => es.close();
  }, [id]);

  return (
    <>
      <ModalHeader
        titleId={TITLE_ID}
        title={title}
        subtitle={data && !data.active ? "This activity has ended." : undefined}
        onClose={onClose}
      />
      {!data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "Couldn’t load this activity."}
        </p>
      ) : mech ? (
        <mech.Surface
          activityId={data.activityId}
          name={data.name}
          active={data.active}
          currentUserId={data.currentUserId}
          nameByUserId={data.nameByUserId}
          progress={data.progress}
          results={data.results}
          submitAction={`/api/activities/${id}`}
          onChanged={onChanged}
        />
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          This activity type isn’t supported here.
        </p>
      )}
    </>
  );
}
