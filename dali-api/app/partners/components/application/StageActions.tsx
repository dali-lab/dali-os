// Stage-aware footer actions for PartnerApplicationModal (and reusable from
// the full page). One primary CTA per specs/partner-crm.md §3's transition
// table, a "Request more info" secondary at Interview, and a destructive
// "Reject" available from any open stage. Drag moves on the board stay
// silent (no email) — these are the explicit, side-effecting actions.

import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import type { ApplicationDetail } from "../../lib/partner-application-detail";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
import { AcceptForm } from "./AcceptForm";
import { RejectForm } from "./RejectForm";

type Showing = "accept" | "reject" | "learn-more" | null;

// The smallest slice this needs — a Pick rather than the full ApplicationDetail
// so the full page (core.partners.applications.$id.tsx), whose loader shapes
// the rest of the application differently, can pass its own loader data
// directly instead of reshaping it to match the modal's type.
export type StageActionsApplication = Pick<ApplicationDetail, "id" | "stage" | "resultingProjectId">;

export function StageActions({
  application,
  canEdit,
  onOpenSchedule,
  onChanged,
}: {
  application: StageActionsApplication;
  canEdit: boolean;
  onOpenSchedule: () => void;
  onChanged: () => void;
}) {
  const [showing, setShowing] = useState<Showing>(null);
  const [whatWeNeed, setWhatWeNeed] = useState("");
  const [learnMoreBusy, setLearnMoreBusy] = useState(false);
  const [learnMoreError, setLearnMoreError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const dialog = useDialog();
  const navigate = useNavigate();

  if (!canEdit) return null;

  function toggle(next: Exclude<Showing, null>) {
    setShowing((cur) => (cur === next ? null : next));
  }

  async function sendLearnMore() {
    if (!whatWeNeed.trim()) {
      setLearnMoreError("Describe what you need from the partner.");
      return;
    }
    setLearnMoreBusy(true);
    setLearnMoreError(null);
    const res = await postPartnerApplicationIntent(application.id, "learn-more", {
      whatWeNeed: whatWeNeed.trim(),
    });
    setLearnMoreBusy(false);
    if (!res.ok) {
      setLearnMoreError(res.error ?? "Couldn't send that request.");
      return;
    }
    setShowing(null);
    setWhatWeNeed("");
    onChanged();
  }

  async function promote() {
    const ok = await dialog.confirm({
      title: "Create a project from this application?",
      description:
        "It will carry over the partner, start term, and per-domain role requests, and the two will be linked.",
      confirmLabel: "Create project",
    });
    if (!ok) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      const fd = new FormData();
      fd.set("intent", "promote");
      const res = await fetch(`/core/partners/applications/${application.id}`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      // Promotion redirects to the new project — follow it there.
      const url = new URL(res.url);
      navigate(url.pathname + url.search);
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : "Couldn't create the project.");
    } finally {
      setPromoting(false);
    }
  }

  const stage = application.stage;
  const canReject = stage !== "Rejected" && !application.resultingProjectId;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {stage === "New" && (
          <Button variant="primary" size="sm" onClick={onOpenSchedule}>
            Schedule interview
          </Button>
        )}

        {stage === "Interview" && (
          <>
            <Button variant="primary" size="sm" onClick={() => toggle("accept")}>
              Accept
            </Button>
            <button
              type="button"
              onClick={() => toggle("learn-more")}
              className="text-xs font-medium text-foreground hover:underline"
            >
              Request more info
            </button>
          </>
        )}

        {stage === "Accepted" && !application.resultingProjectId && (
          <Button variant="primary" size="sm" onClick={() => void promote()} disabled={promoting}>
            {promoting ? "Creating…" : "Create project"}
          </Button>
        )}

        {canReject && (
          <button
            type="button"
            onClick={() => toggle("reject")}
            className="text-xs font-medium text-destructive hover:underline"
          >
            Reject
          </button>
        )}
      </div>

      {promoteError && <p className="text-xs text-destructive">{promoteError}</p>}

      {showing === "accept" && (
        <AcceptForm
          applicationId={application.id}
          onDone={() => {
            setShowing(null);
            onChanged();
          }}
          onCancel={() => setShowing(null)}
        />
      )}

      {showing === "reject" && (
        <RejectForm
          applicationId={application.id}
          onDone={() => {
            setShowing(null);
            onChanged();
          }}
          onCancel={() => setShowing(null)}
        />
      )}

      {showing === "learn-more" && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">What do we need from them? *</span>
            <textarea
              value={whatWeNeed}
              onChange={(e) => setWhatWeNeed(e.target.value)}
              rows={2}
              placeholder="Describe the specific information or materials you need…"
              className="resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          {learnMoreError && <p className="text-xs text-destructive">{learnMoreError}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void sendLearnMore()} disabled={learnMoreBusy}>
              {learnMoreBusy ? "Sending…" : "Send request"}
            </Button>
            <button
              type="button"
              onClick={() => setShowing(null)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
