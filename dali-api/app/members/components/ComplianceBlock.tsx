import { Check, FileSignature, GraduationCap, TriangleAlert } from "lucide-react";
import type { ProfilePageData } from "~/members/lib/profile-page.server";

// The paperwork side of a profile: the CE credit the term requires, and the
// agreements this member has actually signed.
//
// Only rendered for the member themselves and for Core/Admin — the loader
// returns null for anyone else, so this component never has to decide who may
// look. It sits between Achievements and Pages because it's the same kind of
// thing as a medal (a fact about standing) but with an action attached when
// it's unmet.

export function ComplianceBlock({
  compliance,
}: {
  compliance: ProfilePageData["compliance"];
}) {
  if (!compliance) return null;
  const { ce, agreements } = compliance;
  // Nothing to say: not staffed this term and never signed anything.
  if (!ce && agreements.length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Standing</h2>

      {ce && (
        <div
          className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${
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
            <p className="text-sm font-medium text-foreground">
              {ce.compliant
                ? `CE credit met for ${ce.termCode}`
                : `CE credit outstanding for ${ce.termCode}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {ce.credits} of 1 required ·{" "}
              {ce.compliant ? (
                "Nothing more needed this term."
              ) : (
                <a href="/education" className="text-accent-coral hover:underline">
                  Find a course or workshop
                </a>
              )}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          <FileSignature className="h-3 w-3" aria-hidden />
          Agreements signed
        </p>
        {agreements.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nothing signed yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agreements.map((a) => (
              <li
                key={a.signatureId}
                className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{a.documentName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {a.context}
                  </span>
                </span>
                <time
                  dateTime={a.signedAt}
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                >
                  {new Date(a.signedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!ce && (
        // Staffed members get the CE line; everyone else gets a word on why
        // it's absent, so its absence doesn't read as "you're fine".
        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <GraduationCap className="h-3 w-3 shrink-0" aria-hidden />
          No CE credit required — not staffed on a project this term.
        </p>
      )}
    </section>
  );
}
