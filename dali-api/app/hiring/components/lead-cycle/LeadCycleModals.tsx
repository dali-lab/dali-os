import { useState, useEffect } from "react";
import { renderEmail } from "~/lib/email";
import { lintTemplate, type TemplateSlot } from "~/hiring/lib/email-variables";
import type { RoomHoldConflict, RoomHoldConflictItem } from "~/hiring/lib/lead-cycle-types";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { type DecisionEmailDates } from "~/hiring/lib/decision-email-vars";
import { AlertTriangle } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { formatInTimeZone } from "~/lib/timezone";
import { decisionEmailVars } from "~/hiring/lib/decision-email-vars";
import type { PendingDecision } from "~/hiring/lib/lead-cycle-types";

export function PreviewLintWarning({ unknown, unfilled }: { unknown: string[]; unfilled: string[] }) {
  return (
    <div className="rounded-md border border-os-amber/40 bg-os-amber/10 px-3 py-2 text-xs text-os-amber space-y-1">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5" />
        Template warnings
      </div>
      {unknown.length > 0 && (
        <p>
          Unknown placeholder{unknown.length > 1 ? 's' : ''}:{' '}
          {unknown.map((t, i) => (
            <span key={t}>
              {i > 0 && ', '}
              <code className="font-mono bg-os-amber/15 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will ship as literal text.
        </p>
      )}
      {unfilled.length > 0 && (
        <p>
          Not populated for this slot:{' '}
          {unfilled.map((t, i) => (
            <span key={t}>
              {i > 0 && ', '}
              <code className="font-mono bg-os-amber/15 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will render as empty.
        </p>
      )}
    </div>
  );
}

export function DecisionEmailPreviewModal({ decision, email, slot, dates, onClose }: {
  decision: PendingDecision;
  /** The decision's shared email, or null when none is written. */
  email: { subject: string; body: string } | null;
  slot: TemplateSlot;
  dates: DecisionEmailDates;
  onClose: () => void;
}) {
  const firstName = decision.domainApplication.application.user.firstName ?? ''
  const domain =
    decision.domainApplication.domain?.name ??
    ''
  const tmpl = email
  const rendered = tmpl
    ? renderEmail(tmpl, { firstName, domain, ...decisionEmailVars(decision.type, dates) })
    : null
  const lint = tmpl
    ? (() => {
        const subj = lintTemplate(tmpl.subject, slot)
        const body = lintTemplate(tmpl.body, slot)
        return {
          unknown: Array.from(new Set([...subj.unknown, ...body.unknown])),
          unfilled: Array.from(new Set([...subj.unfilled, ...body.unfilled])),
        }
      })()
    : null

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="email-preview-title"
      containerClassName="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto my-auto"
    >
      <>
        <ModalHeader
          titleId="email-preview-title"
          title="Email preview"
          subtitle={
            <>
              {decision.domainApplication.application.user.firstName} {decision.domainApplication.application.user.lastName}
              {' · '}
              {domain}
              {' · '}
              <span className="font-medium">{decision.type}</span>
            </>
          }
          onClose={onClose}
          closeLabel="Close preview"
          className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border mb-0"
        />
        <div className="px-4 sm:px-6 py-4 space-y-4">
          {tmpl ? (
            <>
              {lint && (lint.unknown.length > 0 || lint.unfilled.length > 0) && (
                <PreviewLintWarning unknown={lint.unknown} unfilled={lint.unfilled} />
              )}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</h3>
                <p className="mt-1 text-sm text-foreground">applications@dali.dartmouth.edu</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</h3>
                <p className="mt-1 text-sm text-foreground">
                  {decision.domainApplication.application.user.dartmouthEmail
                    ?? (decision.domainApplication.application.user.netId
                      ? `${decision.domainApplication.application.user.netId}@dartmouth.edu`
                      : '(no address on file)')}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</h3>
                <p className="mt-1 text-sm text-foreground">{rendered?.subject ?? ''}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</h3>
                <div
                  className="mt-1 prose prose-sm dark:prose-invert max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }}
                />
              </div>
            </>
          ) : (
            <div className="rounded-lg bg-[var(--os-role-orange-fill)] border border-[var(--os-role-orange-ink)]/30 p-4 text-sm text-[var(--os-role-orange-ink)]">
              <p className="font-medium">No email is written for {decision.type}.</p>
              <p className="mt-1">Releasing it sends nothing. Write one on Setup under Decision emails.</p>
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-border bg-muted/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
          >
            Close
          </button>
        </div>
      </>
    </Modal>
  )
}

export function RoomHoldConflictModal({ conflicts, timezone, saving, onKeep, onOverride }: {
  conflicts: RoomHoldConflict[];
  timezone: string;
  saving: boolean;
  onKeep: () => void;
  onOverride: () => void;
}) {
  const when = (item: RoomHoldConflictItem) => {
    const start = formatInTimeZone(item.start, timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const end = formatInTimeZone(item.end, timezone, { hour: 'numeric', minute: '2-digit' })
    return `${start} to ${end}`
  }
  const who = (item: RoomHoldConflictItem) =>
    [item.organizer.firstName, item.organizer.lastName].filter(Boolean).join(' ') || 'Unknown'

  return (
    <Modal open onClose={onKeep} labelledBy="room-hold-conflict-title">
      <ModalHeader
        titleId="room-hold-conflict-title"
        title="These bookings overlap the hold"
        onClose={onKeep}
      />
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {conflicts.map(conflict => (
          <div key={conflict.roomId}>
            <h3 className="text-sm font-medium text-foreground">{conflict.roomName}</h3>
            <ul className="mt-1 space-y-1">
              {conflict.items.map(item => (
                <li key={`${item.kind}-${item.id}-${item.start}`} className="text-sm text-muted-foreground">
                  {item.title} · {when(item)} · {who(item)}
                  {item.recurring && <span className="ml-1 text-xs">(Repeats)</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <ModalFooter onCancel={onKeep} cancelLabel="Keep their bookings">
        <button
          type="button"
          onClick={onOverride}
          disabled={saving}
          className={buttonClasses('destructive', 'md')}
        >
          {saving ? 'Releasing…' : 'Release them and hold the rooms'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

export function CompleteConfirmModal({ cycleId, onClose, onCompleted, onError }: {
  cycleId: string;
  onClose: () => void;
  onCompleted: (forced: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [pendingInterviews, setPendingInterviews] = useState(0);
  const [undecidedApps, setUndecidedApps] = useState(0);
  const [hasBlockers, setHasBlockers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Try without force first to check for blockers
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'Completed', force: false }),
      });
      if (res.ok) {
        // No blockers — cycle completed
        onCompleted(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && (body.pendingInterviews > 0 || body.undecidedApplications > 0)) {
        setPendingInterviews(body.pendingInterviews ?? 0);
        setUndecidedApps(body.undecidedApplications ?? 0);
        setHasBlockers(true);
      } else {
        onError(body.error ?? 'Failed to complete cycle.');
      }
      setChecking(false);
    })();
  }, [cycleId]);

  async function forceComplete() {
    setSubmitting(true);
    const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStatus: 'Completed', force: true }),
    });
    if (res.ok) {
      onCompleted(true);
    } else {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? 'Failed to force-complete cycle.');
    }
    setSubmitting(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="complete-confirm-title"
      disableEscape={submitting}
      containerClassName="bg-card rounded-lg shadow-xl w-full max-w-md p-6 space-y-4 my-auto"
    >
      <>
        {checking ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Checking cycle readiness...</p>
          </div>
        ) : hasBlockers ? (
          <>
            <h2 id="complete-confirm-title" className="text-lg font-semibold text-foreground">Cycle has unfinished work</h2>
            <div className="space-y-2">
              {pendingInterviews > 0 && (
                <div className="flex items-center gap-2 text-sm bg-os-amber/10 border border-os-amber/40 rounded-lg px-4 py-3">
                  <span className="font-semibold text-os-amber">{pendingInterviews}</span>
                  <span className="text-os-amber">interview{pendingInterviews !== 1 ? 's' : ''} not yet completed</span>
                </div>
              )}
              {undecidedApps > 0 && (
                <div className="flex items-center gap-2 text-sm bg-os-amber/10 border border-os-amber/40 rounded-lg px-4 py-3">
                  <span className="font-semibold text-os-amber">{undecidedApps}</span>
                  <span className="text-os-amber">applicant{undecidedApps !== 1 ? 's' : ''} without a released decision</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Resolve these before completing the cycle, or force-close if you're sure.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              >
                Go back
              </button>
              <button
                onClick={forceComplete}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/40 rounded-md hover:bg-destructive/15 disabled:opacity-50"
              >
                {submitting ? 'Closing...' : 'Force Close'}
              </button>
            </div>
          </>
        ) : null}
      </>
    </Modal>
  );
}
