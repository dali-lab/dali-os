import { Check, FileSignature, GraduationCap, TriangleAlert, UserCheck } from "lucide-react";
import { Link } from "react-router";
import { InfoTip } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { ProfilePageData } from "~/members/lib/profile-page.server";

// The paperwork side of a profile: the CE credit the term requires, the
// agreements this member has actually signed, and the cycle's staffing forms
// (the surface that used to be its own /projects/my-staffing page).
//
// Only rendered for the member themselves and for Core/Admin — the loader
// returns null for anyone else, so this component never has to decide who may
// look. It sits under Profile with the other facts about this member, with an
// action attached when a requirement is unmet.

const AGREEMENT_ROW =
  "flex items-baseline justify-between gap-2 rounded-os-item bg-os-well px-2.5 py-1.5";

export function ComplianceBlock({
  compliance,
  isSelf,
}: {
  compliance: ProfilePageData["compliance"];
  isSelf: boolean;
}) {
  const { panel, sectionShell, sectionTitle } = useOsChrome();
  if (!compliance) return null;
  const { ce, agreements } = compliance;
  // Only forms the member has actually submitted. An outstanding form is a
  // to-do, and a to-do belongs where the member is asked to do it — this
  // section states standing, not chores.
  const staffingForms = compliance.staffingForms.filter((f) => f.submitted);
  // Nothing to say: not staffed this term, never signed anything, nothing filed.
  if (!ce && agreements.length === 0 && staffingForms.length === 0) return null;

  return (
    <section className={sectionShell}>
      <h2 className={sectionTitle}>Standing</h2>
      <div className={cn(panel, "p-5 flex flex-col gap-4")}>
        {ce && (
          <div
            className={`flex items-start gap-2.5 rounded-os-item border px-3 py-2.5 ${
              ce.compliant
                ? "border-accent-green/40 bg-accent-green/10"
                : "border-accent-yellow/50 bg-accent-yellow/10"
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {ce.compliant ? (
                <Check className="h-4 w-4 text-accent-green" aria-hidden />
              ) : (
                <TriangleAlert className="h-4 w-4 text-amber-600" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground inline-flex items-center gap-1">
                {ce.compliant
                  ? `CE credit met for ${ce.termCode}`
                  : `CE credit outstanding for ${ce.termCode}`}
                <InfoTip content="DALI requires 1 Continuing Education credit per term for all staffed members. Attend a course or workshop in the Education section to earn it." />
              </p>
              <p className="text-xs text-os-grey">
                {ce.credits} of 1 required ·{" "}
                {ce.compliant ? (
                  "Nothing more needed this term."
                ) : (
                  <a href="/education" className="text-os-accent hover:underline">
                    Find a course or workshop
                  </a>
                )}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-os-grey">
            <FileSignature className="h-3 w-3" aria-hidden />
            Agreements signed
          </p>
          {agreements.length === 0 ? (
            <p className="text-sm text-os-muted italic">Nothing signed yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {agreements.map((a) => {
                const body = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        {a.documentName}
                      </span>
                      <span className="block truncate text-[11px] text-os-grey">
                        {a.context}
                      </span>
                    </span>
                    <time
                      dateTime={a.signedAt}
                      className="shrink-0 text-[11px] tabular-nums text-os-grey"
                    >
                      {new Date(a.signedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </time>
                  </>
                );
                return (
                  <li key={a.signatureId}>
                    {/* /sign/:bindingId shows the signed copy — but of the
                        *viewer's* signature, so it is only a link on your own
                        profile. Core reading someone else's sees the record. */}
                    {isSelf ? (
                      <Link
                        to={`/sign/${a.bindingId}`}
                        className={`${AGREEMENT_ROW} transition-colors hover:bg-os-container`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className={AGREEMENT_ROW}>{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {staffingForms.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-os-grey">
              <UserCheck className="h-3 w-3" aria-hidden />
              Staffing forms
            </p>
            <ul className="flex flex-col gap-1">
              {staffingForms.map((f) => (
                <li
                  key={f.slot}
                  className="flex items-baseline justify-between gap-2 rounded-os-item bg-os-well px-2.5 py-1.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{f.slotLabel}</span>
                    <span className="block truncate text-[11px] text-os-grey">
                      {f.submitted && f.submittedAt
                        ? `Submitted ${new Date(f.submittedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}`
                        : "Not submitted"}
                    </span>
                  </span>
                  {/* The fill link submits as whoever clicks it, so it is only
                      ever offered on your own profile; Core reading someone
                      else's sees the status alone. */}
                  {isSelf && (
                    <a
                      href={f.fillLink}
                      className="shrink-0 rounded-full border border-os-container px-3 py-1 text-[11px] font-semibold text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground"
                    >
                      {f.submitted ? "View / update" : "Open form"}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!ce && (
          // Staffed members get the CE line; everyone else gets a word on why
          // it's absent, so its absence doesn't read as "you're fine".
          <p className="inline-flex items-center gap-1.5 text-[11px] text-os-grey">
            <GraduationCap className="h-3 w-3 shrink-0" aria-hidden />
            No CE credit required — not staffed on a project this term.
          </p>
        )}
      </div>
    </section>
  );
}
