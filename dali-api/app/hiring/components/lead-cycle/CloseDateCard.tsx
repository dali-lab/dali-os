import { useState, useEffect, useRef } from "react";
import { cn } from "~/lib/cn";
import { Form, useLocation } from "react-router";
import { Select } from "~/components/ui/floating";
import { type Timeline } from "~/hiring/lib/cycle-timeline";
import { Modal } from "~/components/Modal";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { CheckCircle, X } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { Pill } from "~/components/ui/Pill";
import { SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { APPLICATION_TZ, APPLICATION_TZ_LABEL } from "~/lib/timezone";

export function CloseDateNotice() {
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // Re-read on every navigation: an action's redirect lands on this same page
  // without remounting it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const n = url.searchParams.get("notice");
    if (!n) return;
    setNotice(n);
    setAdded(url.searchParams.get("added"));
    url.searchParams.delete("notice");
    url.searchParams.delete("added");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [location.search]);
  if (!notice) return null;
  const messages: Record<string, { text: string; tone: "ok" | "warn" }> = {
    "deadline-set": { text: "Close date saved.", tone: "ok" },
    "deadline-set-reopened": {
      text: "Close date saved and applications reopened — applicants can submit again until the new deadline.",
      tone: "warn",
    },
    "deadline-cleared": { text: "Close date cleared.", tone: "ok" },
    "open-date-set": { text: "Open date saved.", tone: "ok" },
    "applicants-changed": { text: "Applicants changed.", tone: "ok" },
    "timeline-saved": { text: "Timeline saved.", tone: "ok" },
    "mentors-added": { text: `Added ${added} mentor${added === "1" ? "" : "s"}.`, tone: "ok" },
    "mentors-already": { text: "Everyone's already on the roster.", tone: "ok" },
    "mentors-none": { text: "This domain has no mentors yet.", tone: "warn" },
    "timeline-reset": { text: "Timeline reset.", tone: "ok" },
    "term-dates-saved": { text: "Term and dates saved.", tone: "ok" },
    "open-date-cleared": { text: "Open date cleared.", tone: "ok" },
    "deadline-past": { text: "That date has passed. Pick a future date, or use Close applications at the top.", tone: "warn" },
    "extended": { text: "Extension saved. Applicants will see an “Extended deadline” notice on the portal during the window.", tone: "ok" },
    "extended-reopened": {
      text: "Extension saved and applications reopened — applicants can submit again until the new effective close.",
      tone: "warn",
    },
    "extension-removed": { text: "Extension removed — the close date is back to the original.", tone: "ok" },
    "extension-notice-sent": { text: "Extension notice email sent to applicants who haven't submitted yet.", tone: "ok" },
    "extension-notice-partial": { text: "Extension notice sent — some recipients failed (see server logs).", tone: "warn" },
    "extension-notice-noop": { text: "No extension notice sent — no draft applicants in this cycle.", tone: "warn" },
    "extension-notice-all-sent": { text: "Every draft applicant has already received the extension notice — nothing to resend.", tone: "ok" },
    "extension-notice-no-extension": { text: "No extension is currently set on this cycle. Set an extension first.", tone: "warn" },
    "extension-notice-not-configured": { text: "Extension notice not sent — no template is bound to the “Deadline Extension Notice” slot, or the gmail account isn't configured.", tone: "warn" },
    "domain-added-notice-sent": { text: "Email sent to everyone in this cycle.", tone: "ok" },
    "domain-added-notice-partial": { text: "Email sent. Some recipients failed, see server logs.", tone: "warn" },
    "domain-added-notice-noop": { text: "No email sent. There are no applicants in this cycle yet.", tone: "warn" },
    "domain-added-notice-all-sent": { text: "Everyone in this cycle already received this email. Nothing to resend.", tone: "ok" },
    "domain-added-notice-not-configured": { text: "Email not sent. Write the “Domain added to an open cycle” template on Setup first.", tone: "warn" },
  };
  const m = messages[notice];
  if (!m) return null;
  const toneCls = m.tone === "warn"
    ? "bg-os-amber/10 border-os-amber/40 text-os-amber"
    : "bg-os-green/10 border-os-green/40 text-os-green";
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${toneCls}`} role="status">
      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">{m.text}</div>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="text-xs text-foreground/60 hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function formatCloseInstant(d: Date): string {
  return `${d.toLocaleString("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ${APPLICATION_TZ_LABEL}`;
}

export function describeExtension(deltaMs: number): { amount: number; unit: "hours" | "days" } {
  if (deltaMs <= 0) return { amount: 48, unit: "hours" };
  // Round to nearest hour, then express in days if it's a whole-day multiple.
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours > 0 && hours % 24 === 0) return { amount: hours / 24, unit: "days" };
  return { amount: hours, unit: "hours" };
}

// Extending the close date, and when applications actually stop. The close
// date itself is set on the Term and dates card; this card only renders once
// one exists.
export function CloseDateCard({ cycle, cycleStatus }: { cycle: any; cycleStatus: string }) {
  const closeDate = new Date(cycle.closeDate);
  const originalCloseDate = cycle.originalCloseDate ? new Date(cycle.originalCloseDate) : null;
  const anchor = originalCloseDate ?? closeDate;
  const extensionMs = originalCloseDate ? closeDate.getTime() - originalCloseDate.getTime() : 0;
  const extensionActive = extensionMs > 0;

  return (
    <SetupCard
      title="Deadline extension"
      description="Adds time after the close date. Applicants see a deadline-extended notice."
      action={extensionActive ? <Pill tone="accent">Active</Pill> : null}
    >
      <ExtensionSection
        cycleId={cycle.id}
        anchor={anchor}
        extensionMs={extensionMs}
        extensionActive={extensionActive}
        cycleStatus={cycleStatus}
        extensionNoticeSentAt={cycle.extensionNoticeSentAt ? new Date(cycle.extensionNoticeSentAt) : null}
      />

      {/* Effective close (read-only) */}
      <div className="flex flex-col gap-1 rounded-os-item bg-os-well px-4 py-3">
        <span className="text-sm text-os-grey">Effective close</span>
        <span className="text-base font-semibold text-foreground">{formatCloseInstant(closeDate)}</span>
        <span className="text-xs text-os-grey">
          Applications stop and the cycle moves to Under Review.
          {extensionActive && originalCloseDate && <> Extended from {formatCloseInstant(originalCloseDate)}.</>}
        </span>
      </div>
    </SetupCard>
  );
}

export function ExtensionSection({
  cycleId,
  anchor,
  extensionMs,
  extensionActive,
  cycleStatus,
  extensionNoticeSentAt,
}: {
  cycleId: string;
  anchor: Date;
  extensionMs: number;
  extensionActive: boolean;
  cycleStatus: string;
  extensionNoticeSentAt: Date | null;
}) {
  const initial = describeExtension(extensionMs);
  const [amount, setAmount] = useState<number>(initial.amount);
  const [unit, setUnit] = useState<"hours" | "days">(initial.unit);
  const [showConfirm, setShowConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = `extend-confirm-heading-${cycleId}`;
  const confirmSubmit = useConfirmSubmit();

  const ms = unit === "hours" ? amount * 3_600_000 : amount * 86_400_000;
  const nextClose = new Date(anchor.getTime() + ms);
  const willReopen = cycleStatus === "UnderReview" && nextClose.getTime() > Date.now();
  const stillInPast = nextClose.getTime() <= Date.now();
  const os = useOsChrome();

  return (
    <>
      <Form
        method="post"
        preventScrollReset
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          setShowConfirm(true);
        }}
        className={cn(os.formClass, "flex flex-wrap items-end gap-3")}
        aria-label={`Set deadline extension for cycle ${cycleId}`}
      >
        <input type="hidden" name="intent" value="extend-close-date" />
            <label className={cn(os.fieldLabel, "w-24")} htmlFor={`extend-amount-${cycleId}`}>
              Amount
              <input
                id={`extend-amount-${cycleId}`}
                type="number"
                name="amount"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="h-9 w-full"
              />
            </label>
            <div className={cn(os.fieldLabel, "w-28")}>
              Unit
              <Select
                name="unit"
                value={unit}
                onChange={(value) => setUnit(value as "hours" | "days")}
                options={[
                  { value: "hours", label: "hours" },
                  { value: "days", label: "days" },
                ]}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </div>
          <button
            type="submit"
            disabled={!Number.isFinite(amount) || amount <= 0}
            className={buttonClasses("primary", "md", "h-9")}
          >
            {extensionActive ? "Update extension" : "Set extension"}
          </button>
      </Form>
      {extensionActive && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Form
            method="post"
            preventScrollReset
            aria-label="Resend deadline-extension email to draft applicants"
          >
            <input type="hidden" name="intent" value="resend-extension-notice" />
            <button type="submit" className={buttonClasses("secondary", "sm")}>
              {extensionNoticeSentAt ? "Resend extension notice" : "Send extension notice now"}
            </button>
          </Form>
          {extensionNoticeSentAt && (
            <span className="text-xs text-os-grey">
              Last sent {formatCloseInstant(extensionNoticeSentAt)}
            </span>
          )}
          <Form
            method="post"
            preventScrollReset
            aria-label="Remove deadline extension"
            onSubmit={confirmSubmit({
              title: "Remove the deadline extension?",
              description:
                "The cycle goes back to its original close time. If that time has passed, applications close immediately.",
              confirmLabel: "Remove extension",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="remove-extension" />
            <button type="submit" className={buttonClasses("ghost", "sm", "text-destructive")}>
              Remove extension
            </button>
          </Form>
        </div>
      )}
      {showConfirm && (
        <Modal
          open
          onClose={() => setShowConfirm(false)}
          labelledBy={headingId}
          containerClassName="bg-card rounded-os-card shadow-xl max-w-md w-full mx-4 p-5"
        >
          <div className="space-y-4">
            <h2 id={headingId} className="text-lg font-bold text-foreground">
              {extensionActive ? "Update" : "Set"} extension to {amount} {unit}?
            </h2>
            <div className="text-sm text-muted-foreground space-y-3">
              <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                <div>
                  <span className="font-medium text-foreground/80">Original close: </span>
                  <span>{formatCloseInstant(anchor)}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground/80">New effective close: </span>
                  <span className="font-semibold text-foreground">{formatCloseInstant(nextClose)}</span>
                </div>
              </div>
              {willReopen && (
                <div className="bg-os-amber/10 border border-os-amber/40 rounded-lg p-3 text-xs text-os-amber">
                  This cycle is currently <span className="font-semibold">closed</span> (Under Review). Confirming
                  will <span className="font-semibold">reopen applications</span> to applicants until the new
                  close time.
                </div>
              )}
              {stillInPast && (
                <div className="bg-destructive/10 border border-destructive/40 rounded-lg p-3 text-xs text-destructive">
                  The new effective close is still in the past, so applications stay closed.
                </div>
              )}
              <p>
                Applicants will see a &ldquo;Deadline extended&rdquo; notice on the portal between the original
                close and the new effective close.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfirm(false)} className={buttonClasses("secondary")}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  formRef.current?.submit();
                }}
                className={buttonClasses("primary")}
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
