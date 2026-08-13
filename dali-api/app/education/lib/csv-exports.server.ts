import { defineCsvExport } from "~/lib/csv-export.server";
import { isCore } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { complianceForTerm } from "~/education/lib/ce-credits.server";

// Mirrors education.compliance.tsx loader: isCore-gated, term-scoped via the
// same resolveTermFilter + complianceForTerm the page itself renders from.

defineCsvExport({
  id: "education-compliance",
  filename: () => `ce-compliance-${new Date().toISOString().slice(0, 10)}.csv`,
  authorize: async (ctx) => isCore(ctx.user.sub),
  async rows(ctx) {
    const { terms, termId } = await resolveTermFilter(ctx.request);
    const effectiveTermId = termId ?? terms[0]?.id ?? null;
    const rows = effectiveTermId ? await complianceForTerm(effectiveTermId) : [];

    const out: unknown[][] = [["Member", "Credits", "Compliant"]];
    for (const r of rows) {
      out.push([r.name, r.credits, r.compliant ? "yes" : "no"]);
    }
    return out;
  },
});
