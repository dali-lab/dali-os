import type { ReactNode } from "react";
import { Check, GraduationCap } from "lucide-react";
import { Link } from "react-router";
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

  type Item = { key: string; done: boolean; title: ReactNode; note: ReactNode };
  const dateOf = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const items: Item[] = [];
  if (ce) {
    items.push({
      key: "ce",
      done: ce.compliant,
      title: `CE credit for ${ce.termCode}`,
      note: ce.compliant ? (
        `Earned ${ce.credits} of 1 required.`
      ) : (
        <>
          {ce.credits} of 1 required.{" "}
          <a href="/education" className="not-italic text-os-accent hover:underline">
            Find a course or workshop
          </a>
        </>
      ),
    });
  }
  for (const a of agreements) {
    const title = isSelf ? (
      <Link to={`/sign/${a.bindingId}`} className="hover:underline">
        {a.documentName}
      </Link>
    ) : (
      a.documentName
    );
    items.push({
      key: a.signatureId,
      done: true,
      title,
      note: `Signed ${dateOf(a.signedAt)} · ${a.context}`,
    });
  }
  for (const f of staffingForms) {
    items.push({
      key: f.slot,
      done: true,
      title: f.slotLabel,
      note: (
        <>
          {f.submittedAt ? `Submitted ${dateOf(f.submittedAt)}` : "Submitted"}
          {isSelf && (
            <>
              {" · "}
              <a href={f.fillLink} className="not-italic text-os-accent hover:underline">
                View / update
              </a>
            </>
          )}
        </>
      ),
    });
  }
  items.sort((x, y) => Number(y.done) - Number(x.done));

  const content = (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                i.done ? "border-os-green bg-os-green text-os-bg" : "border-os-container-hi",
              )}
            >
              {i.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="sr-only">{i.done ? "Complete:" : "Incomplete:"}</span>
            <div className="min-w-0">
              <p className="text-sm text-foreground">{i.title}</p>
              <p className="text-xs italic text-os-grey">{i.note}</p>
            </div>
          </li>
        ))}
      </ul>
      {!ce && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-os-grey">
          <GraduationCap className="h-3 w-3 shrink-0" aria-hidden />
          No CE credit required — not staffed on a project this term.
        </p>
      )}
    </>
  );

  return (
    <section className={sectionShell}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionTitle}>Standing</h2>
        {ce?.termCode && <span className="text-xs text-os-muted">{ce.termCode}</span>}
      </div>
      <div className={cn(panel, "p-5 flex flex-col gap-4")}>{content}</div>
    </section>
  );
}
