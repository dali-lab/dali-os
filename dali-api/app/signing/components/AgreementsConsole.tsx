import { useState, type ReactNode } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { TermFilter } from "~/components/TermFilter";
import { IssueTermAgreementsButton } from "~/signing/components/IssueTermAgreementsButton";
import {
  FileSignature,
  Zap,
  Send,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  PenLine,
} from "lucide-react";
import type { loader } from "~/signing/routes/core.agreements";
import {
  SCOPE_SHORT,
  AUDIENCE_SHORT,
  CADENCE_SHORT,
} from "~/signing/lib/document-config";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime } from "~/lib/display";

// The "sign request goes to whom" line for the activation confirm. Turns the
// resolved audience (null = not enumerable) into a short, honest sentence —
// including the empty-audience case (e.g. a term-group agreement before staffing
// is finalized), which would otherwise silently notify no one.
function recipientSummary(pendingRecipients: string[] | null): string {
  if (pendingRecipients === null) return "everyone in this agreement's audience";
  const n = pendingRecipients.length;
  if (n === 0) return "no one right now — the audience is empty (is staffing finalized?)";
  const shown = pendingRecipients.slice(0, 8).join(", ");
  const more = n > 8 ? `, +${n - 8} more` : "";
  return `${n} ${n === 1 ? "person" : "people"} (${shown}${more})`;
}
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// Console shapes derived from the loader (not imported from console.server, so
// no server module crosses into the client bundle) — these match exactly what
// useLoaderData returns, serialization included.
type ConsoleData = Extract<Awaited<ReturnType<typeof loader>>, { mode: "console" }>;
type ConsoleAgreement = ConsoleData["agreements"][number];
type ConsoleBinding = ConsoleAgreement["bindings"][number];

const DAY_MS = 24 * 60 * 60 * 1000;
const driveHref = (id: string) => `/documents/agreement/${id}`;

function recentlyReminded(at: string | Date | null): boolean {
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < DAY_MS;
}

function timeAgo(at: string | Date): string {
  const ms = Date.now() - new Date(at).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// One binding row's completion, shared by the board + non-enumerable count case.
function completionPct(b: ConsoleBinding): number | null {
  if (b.total == null || b.total === 0) return null;
  return Math.round((b.signedCount / b.total) * 100);
}

export function AgreementsConsole() {
  const data = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const [showPast, setShowPast] = useState(false);

  // The route renders this only in console mode; guard keeps the types honest.
  if (data.mode !== "console") return null;
  const { agreements, activity, termId, termCode, terms, selected } = data;

  const needsAttention = agreements.filter((a) => a.needsActivation || a.draftPending);

  // Flat board of binding rows across every agreement, least-complete first.
  // Term-scoped bindings for past terms are hidden until "Show past terms".
  type Row = { agreement: ConsoleAgreement; binding: ConsoleBinding };
  const rows: Row[] = agreements
    .flatMap((agreement) => agreement.bindings.map((binding) => ({ agreement, binding })))
    .filter((r) => showPast || r.binding.isCurrent)
    .sort((a, z) => {
      const pa = completionPct(a.binding);
      const pz = completionPct(z.binding);
      // Enumerable + incomplete float up; count-only (null) sink below them.
      const ka = pa == null ? 101 : pa;
      const kz = pz == null ? 101 : pz;
      if (ka !== kz) return ka - kz;
      return a.agreement.name.localeCompare(z.agreement.name);
    });
  const pastCount = agreements.reduce(
    (n, a) => n + a.bindings.filter((b) => !b.isCurrent).length,
    0,
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agreements</h1>
          <p className="mt-1 text-muted-foreground">
            Signing status across every agreement
            {termCode ? ` · ${termCode}` : ""}. Author versions, place fields, and publish in the{" "}
            <Link to="/drive?type=agreement" className="text-accent-coral hover:underline">
              Drive
            </Link>
            ; issue, track completion, and nudge signers here.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Focus term: switch which term the console manages (issue an upcoming
              term's agreements early, track its completion). */}
          {terms.length > 0 && termId && (
            <TermFilter terms={terms} selected={selected} includeAll={false} replace />
          )}
          {/* Bulk: issue every per-term agreement for the focus term at once. */}
          {termId && (
            <IssueTermAgreementsButton
              termId={termId}
              label={`Issue all${termCode ? ` for ${termCode}` : ""}`}
            />
          )}
          <Link
            to="/drive?type=agreement"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-foreground/80 bg-card border border-border hover:bg-muted/50"
          >
            <FileSignature className="w-4 h-4" /> Open in Drive
          </Link>
        </div>
      </div>

      {needsAttention.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Needs attention
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {needsAttention.map((a) => (
              <NeedsAttentionCard key={a.id} agreement={a} termCode={termCode} termId={termId} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Completion
          </h2>
          {pastCount > 0 && (
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              {showPast ? "Hide past terms" : `Show past terms (${pastCount})`}
            </button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing in force{termCode ? ` for ${termCode}` : ""} yet. Publish a
            version in the Drive and put it in force.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map(({ agreement, binding }) => (
              <BindingRow key={binding.bindingId} agreement={agreement} binding={binding} tz={tz} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            Recent activity
          </h2>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No signatures yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {activity.map((s) => (
                <li key={s.signatureId} className="text-sm text-muted-foreground">
                  <span className="text-foreground">{s.signerName}</span> signed{" "}
                  <Link to={driveHref(s.documentId)} className="text-accent-coral hover:underline">
                    {s.documentName}
                  </Link>{" "}
                  · <span title={formatDateTime(s.signedAt, tz)}>{timeAgo(s.signedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
            All agreements
          </h2>
          {agreements.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No agreements yet. Create one in the Drive.
            </p>
          ) : (
            <ul className="space-y-2">
              {agreements.map((a) => (
                <li key={a.id}>
                  <Link
                    to={driveHref(a.id)}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 hover:bg-muted/40 group"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:text-accent-coral transition-colors">
                        {a.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <Pill>{AUDIENCE_SHORT[a.audience] ?? a.audience}</Pill>
                        <Pill>{CADENCE_SHORT[a.cadence] ?? a.cadence}</Pill>
                        <Pill>{SCOPE_SHORT[a.gateScope] ?? a.gateScope}</Pill>
                        {a.draftPending && <Pill tone="amber">Draft pending</Pill>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent-coral transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone?: "amber" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 ${
        tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

function NeedsAttentionCard({
  agreement,
  termCode,
  termId,
}: {
  agreement: ConsoleAgreement;
  termCode: string | null;
  termId: string | null;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const activating = fetcher.state !== "idle";
  const confirmSubmit = useConfirmSubmit();
  const scopeSuffix =
    agreement.cadence === "PerTerm" && termCode ? ` for ${termCode}` : "";
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link
            to={driveHref(agreement.id)}
            className="font-medium text-foreground hover:text-accent-coral truncate block"
          >
            {agreement.name}
          </Link>
          {agreement.needsActivation ? (
            <p className="mt-0.5 text-xs text-amber-800">
              Nothing in force{termCode ? ` for ${termCode}` : ""}.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-amber-800">
              An unpublished draft is waiting to be published.
            </p>
          )}
          <div className="mt-2">
            {agreement.needsActivation && agreement.latestPublishedVersionId ? (
              <fetcher.Form
                method="post"
                onSubmit={confirmSubmit({
                  title: "Put in force & send sign requests?",
                  description: `“${agreement.name}” will go in force${scopeSuffix} and send a sign request to ${recipientSummary(agreement.pendingRecipients)}.`,
                  confirmLabel: "Send",
                })}
              >
                <input type="hidden" name="intent" value="activate" />
                <input type="hidden" name="documentId" value={agreement.id} />
                <input type="hidden" name="termId" value={termId ?? ""} />
                <input
                  type="hidden"
                  name="versionId"
                  value={agreement.latestPublishedVersionId}
                />
                <button
                  type="submit"
                  disabled={activating}
                  className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-coral/90 disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" /> {activating ? "Activating…" : "Put in force"}
                </button>
              </fetcher.Form>
            ) : (
              <Link
                to={driveHref(agreement.id)}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/50"
              >
                <PenLine className="w-3.5 h-3.5" /> Open in Drive
              </Link>
            )}
          </div>
          {fetcher.data?.error && (
            <p className="mt-1.5 text-xs text-red-600">{fetcher.data.error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BindingRow({
  agreement,
  binding,
  tz,
}: {
  agreement: ConsoleAgreement;
  binding: ConsoleBinding;
  tz: string;
}) {
  const pct = completionPct(binding);
  const complete = pct === 100;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={driveHref(agreement.id)}
            className="font-medium text-foreground hover:text-accent-coral truncate"
          >
            {agreement.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Pill>{binding.scopeLabel}</Pill>
            <span>v{binding.versionNumber}</span>
          </div>
        </div>
        <RemindButton binding={binding} tz={tz} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        {pct == null ? (
          <p className="text-sm text-muted-foreground">
            {binding.signedCount} signature{binding.signedCount !== 1 ? "s" : ""}
          </p>
        ) : (
          <>
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${complete ? "bg-green-500" : "bg-accent-coral"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-sm text-foreground/80 shrink-0 tabular-nums">
              {binding.signedCount}/{binding.total}{" "}
              <span className="text-muted-foreground">({pct}%)</span>
            </p>
          </>
        )}
      </div>

      {binding.outstanding.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer text-xs font-medium text-amber-700 marker:content-none inline-flex items-center gap-1">
            <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
            {binding.outstanding.length} outstanding
          </summary>
          <ul className="mt-1.5 pl-4 space-y-0.5">
            {binding.outstanding.map((n) => (
              <li key={n} className="text-xs text-muted-foreground truncate">
                {n}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RemindButton({ binding, tz }: { binding: ConsoleBinding; tz: string }) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const sending = fetcher.state !== "idle";
  const throttled = recentlyReminded(binding.lastRemindedAt);
  // Reminders only make sense when we can enumerate an audience with unsigned
  // people left (non-enumerable audiences resolve to no recipients).
  const canRemind = binding.total != null && binding.outstanding.length > 0;
  const justSent = fetcher.data?.ok;

  if (!canRemind) return null;

  return (
    <div className="shrink-0 text-right">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remind" />
        <input type="hidden" name="bindingId" value={binding.bindingId} />
        <button
          type="submit"
          disabled={sending || throttled || justSent}
          title={
            throttled && binding.lastRemindedAt
              ? `Reminded ${timeAgo(binding.lastRemindedAt)} (${formatDateTime(
                  binding.lastRemindedAt,
                  tz,
                )})`
              : `Remind the ${binding.outstanding.length} outstanding signer${
                  binding.outstanding.length !== 1 ? "s" : ""
                }`
          }
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted/50 disabled:opacity-50 disabled:hover:bg-card"
        >
          {justSent ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <Send className="w-3.5 h-3.5" />}
          {sending ? "Sending…" : justSent ? "Sent" : "Remind"}
        </button>
      </fetcher.Form>
      {throttled && binding.lastRemindedAt && !justSent && (
        <p className="mt-1 text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Clock className="w-3 h-3" /> {timeAgo(binding.lastRemindedAt)}
        </p>
      )}
      {fetcher.data?.error && <p className="mt-1 text-[11px] text-red-600">{fetcher.data.error}</p>}
    </div>
  );
}
